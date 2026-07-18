// Verify Stage 2 (unit, mock — không API thật, không tiền):
//   generateScript (mock model) · toScriptSegments biên · toScriptManifest shape/clone
//   buildTimeline/allocateShots · splitSentences/toSrt (caption tách câu) · bundle round-trip
//   kenburns (pan-v/pan-h/zoom/blur-fill) · TTS cache MISS/HIT (mock ElevenLabs, cần ffprobe)
//   TTS CapCut (mock: flow new→poll→audio, cache HIT, key prefix, task fail, timeout)
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBundle, writeBundle } from '../lib/bundle';
import { assertFfmpeg } from '../lib/ffmpeg';
import { availableModes, frameSize, kenburns, planKenburns } from '../lib/kenburns';
import type { ScriptSegment } from '../lib/schema';
import {
  defaultRenderConfig,
  estimateSeconds,
  SCRIPT_VERSION,
  toScriptManifest,
} from '../lib/schema';
import { buildPrompt, generateScript, toScriptSegments } from '../lib/script';
import { buildVisionPrompt } from '../lib/vision';
import {
  allocateCaptions,
  allocateShots,
  buildTimeline,
  splitSentences,
  toSrt,
  toTimelineJson,
} from '../lib/timeline';
import { synthSegment, ttsCacheKey } from '../lib/tts';
import { createMockElevenLabs } from './mock-elevenlabs.mjs';
import { createMockCapcut, CAPCUT_FAIL_VOICE, CAPCUT_QUEUE_VOICE } from './mock-capcut.mjs';
import { createMockScriptModel } from './mock-script-model.mjs';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);
const near = (a: number, e: number, tol: number, label: string) =>
  ok(Math.abs(a - e) <= tol, `${label} (${a} ≈ ${e} ±${tol})`);

function seg(init: Partial<ScriptSegment> & { id: string; order: number }): ScriptSegment {
  return {
    narration: '',
    shots: [{ sourceIndex: 0, region: null, weight: 1 }],
    ...init,
  } as ScriptSegment;
}

console.log('Test 1: toScriptSegments — validate biên shotIndices + region beat → shot');
{
  const regions = [null, { x: 5, y: 10, w: 100, h: 80 }, null];
  const motions = [undefined, { mode: 'static' as const }, undefined];
  const inputs = [0, 1, 2].map((i) => ({
    order: i,
    sourceIndex: i,
    beatId: `beat-${i}`,
    content: null,
    region: regions[i],
    motion: motions[i],
  }));
  const segments = toScriptSegments(
    [
      { narration: 'Gộp hai band.', shotIndices: [0, 1] },
      { narration: 'Band cuối.', shotIndices: [2] },
      { narration: 'Ngoài biên.', shotIndices: [99] },
    ],
    inputs,
  );
  eq(segments.length, 2, 'đoạn chỉ còn shot ngoài biên bị bỏ');
  eq(segments[0].shots.map((s) => s.sourceIndex), [0, 1], 'gộp: đoạn 1 phủ band 0+1');
  eq(segments[0].sourceBeatIds, ['beat-0', 'beat-1'], 'sourceBeatIds truy vết');
  eq(segments.map((s) => s.order), [0, 1], 'order tăng dần liền mạch');
  eq(
    segments[0].shots.map((s) => s.region),
    [null, { x: 5, y: 10, w: 100, h: 80 }],
    'region beat truyền vào shot (null giữ null, vùng vẽ giữ vùng vẽ)',
  );
  ok(segments[0].shots[1].region !== regions[1], 'region được clone — sửa beat sau này không lây sang shot');
  eq(
    segments[0].shots.map((s) => s.motion),
    [undefined, { mode: 'static' }],
    'motion beat truyền vào shot (undefined giữ vắng mặt)',
  );
  ok(segments[0].shots[1].motion !== motions[1], 'motion được clone — không rò tham chiếu beat');
  ok(segments[0].shots.every((s) => s.weight === 1), 'weight mặc định 1');
}

console.log('Test 1b: khối ngữ cảnh chương trong prompt (vision + biên kịch)');
{
  const inputs = [
    {
      order: 0,
      sourceIndex: 0,
      beatId: 'b0',
      content: { description: 'Cảnh mở đầu.', dialogue: [], note: '' },
      region: null,
    },
  ];
  const plain = buildPrompt(inputs);
  ok(!plain.includes('Ngữ cảnh chương'), 'biên kịch: không context → prompt y cũ');
  const withCtx = buildPrompt(inputs, '  Lâm Phong — nam chính.  ');
  ok(
    withCtx.includes('Ngữ cảnh chương') && withCtx.includes('Lâm Phong — nam chính.'),
    'biên kịch: context được chèn (đã trim)',
  );
  ok(
    withCtx.indexOf('Ngữ cảnh chương') < withCtx.indexOf('Nội dung các khung:'),
    'biên kịch: khối context đứng trước danh sách khung',
  );
  eq(buildVisionPrompt(), buildVisionPrompt(''), 'vision: undefined và rỗng cho cùng prompt gốc');
  ok(!buildVisionPrompt('   ').includes('Ngữ cảnh chương'), 'vision: context toàn khoảng trắng → prompt gốc');
  const vp = buildVisionPrompt('Tô Nhược — nữ.');
  ok(
    vp.includes('Tô Nhược — nữ.') && vp.includes('KHÔNG mô tả'),
    'vision: context kèm guardrail chống context-bleed',
  );
}

console.log('Test 2: generateScript qua mock model (fence ```json + index ngoài biên)');
{
  const mock = await createMockScriptModel();
  process.env.SCRIPT_API_KEY = 'mock-key';
  process.env.SCRIPT_BASE_URL = `http://localhost:${mock.port}/v1`;
  process.env.SCRIPT_MODEL = 'mock-script';
  const inputs = [0, 1, 2].map((i) => ({
    order: i,
    sourceIndex: i,
    beatId: `beat-${i}`,
    content: { description: `Cảnh ${i}.`, dialogue: [], note: '' },
    region: null,
  }));
  const segments = await generateScript(inputs);
  eq(segments.length, 2, 'mock 3 đoạn → 2 (đoạn index 99 bị loại)');
  ok(segments[0].narration.includes('Dừng lại'), 'narration giữ nguyên từ model');
  eq(segments[0].shots.length, 2, 'đoạn 1 gộp 2 shot');
  eq(segments[1].shots[0].sourceIndex, 2, 'đoạn 2 trỏ band 2');
  eq(segments[0].durationHint, estimateSeconds(segments[0].narration), 'durationHint ước từ narration');
  await mock.close();
}

console.log('Test 3: toScriptManifest — shape + clone');
{
  const source = [
    seg({
      id: 'b',
      order: 1,
      narration: 'Hai.',
      shots: [{
        sourceIndex: 1,
        region: { x: 0, y: 0, w: 10, h: 10 },
        motion: { mode: 'pan-v', reverse: true },
        weight: 2,
      }],
    }),
    seg({ id: 'a', order: 0, narration: 'Một.' }),
  ];
  const manifest = toScriptManifest({ jobId: 'j1', createdAt: 'now', segments: source });
  eq(manifest.version, SCRIPT_VERSION, 'version = SCRIPT_VERSION');
  eq(manifest.segmentCount, 2, 'segmentCount');
  eq(manifest.segments.map((s) => s.id), ['a', 'b'], 'sort theo order');
  manifest.segments[1].shots[0].region!.x = 999;
  manifest.segments[1].shots[0].weight = 999;
  eq(source[0].shots[0].region!.x, 0, 'region được clone (không rò tham chiếu)');
  eq(source[0].shots[0].weight, 2, 'shots được clone');
  eq(
    manifest.segments[1].shots[0].motion,
    { mode: 'pan-v', reverse: true },
    'motion sống sót qua toScriptManifest (map tường minh — chỗ dễ rớt im lặng nhất)',
  );
  manifest.segments[1].shots[0].motion!.mode = 'zoom';
  eq(source[0].shots[0].motion!.mode, 'pan-v', 'motion được clone (không rò tham chiếu)');
  eq(manifest.segments[0].shots[0].motion, undefined, 'shot không motion → manifest không thêm field');
}

console.log('Test 4: buildTimeline — audio nhạc trưởng, sàn, phân bổ weight');
{
  const segments = [
    seg({ id: 'A', order: 0, narration: 'x'.repeat(60), shots: [
      { sourceIndex: 0, region: null, weight: 1 },
      { sourceIndex: 1, region: null, weight: 3 },
    ] }),
    seg({ id: 'B', order: 1, narration: '' }),
    seg({ id: 'C', order: 2, narration: 'ngắn' }),
  ];
  const tl = buildTimeline(segments, { A: 3, C: 0.5 });
  near(tl.segments[0].end - tl.segments[0].start, 3.5, 0.001, 'A: audio 3s + pad 0.5 = 3.5s');
  eq(tl.segments[1].end - tl.segments[1].start, 2, 'B: narration rỗng → sàn 2s');
  eq(tl.segments[2].end - tl.segments[2].start, 2, 'C: audio quá ngắn → sàn 2s');
  eq(tl.totalSec, 7.5, 'Σ dur_seg = totalSec');
  eq(tl.segments[1].start, 3.5, 'start tích luỹ');
  near(tl.segments[0].shots[0].end - tl.segments[0].shots[0].start, 0.875, 0.01, 'shot weight 1/4 → 0.875s');
  near(tl.segments[0].shots[1].end - tl.segments[0].shots[1].start, 2.625, 0.01, 'shot weight 3/4 → 2.625s');
  eq(tl.segments[0].shots[1].end, tl.segments[0].end, 'shot cuối chạm đúng biên segment');

  const evenSplit = allocateShots([{ weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }], 2, 0.8);
  ok(evenSplit.every((d) => Math.abs(d - 0.5) < 1e-9), 'sàn không nhét vừa → chia đều');

  const tlOverride = buildTimeline(segments, { A: 3 }, { segmentOverrides: { A: { durationSec: 5 } } });
  eq(tlOverride.segments[0].end, 5, 'segmentOverrides đè thời lượng');
}

console.log('Test 5: splitSentences + allocateCaptions + toSrt (caption tách theo câu)');
{
  eq(
    splitSentences('Câu một. Câu hai! Câu ba?\nDòng mới…'),
    ['Câu một.', 'Câu hai!', 'Câu ba?', 'Dòng mới…'],
    'tách theo . ! ? … và xuống dòng',
  );
  const caps = allocateCaptions(['aaaa', 'aaaaaaaaaaaa'], 0, 4); // 4 vs 12 ký tự → 1s vs 3s
  eq(caps.map((c) => [c.start, c.end]), [[0, 1], [1, 4]], 'canh giờ tỉ lệ ký tự');

  const segments = [
    seg({ id: 'A', order: 0, narration: 'Câu một. Câu hai dài hơn hẳn nhé!' }),
    seg({ id: 'B', order: 1, narration: '' }),
  ];
  const tl = buildTimeline(segments, { A: 3 });
  const srt = toSrt(tl, segments);
  const blocks = srt.trim().split('\n\n');
  eq(blocks.length, 2, 'A 2 câu → 2 caption; B rỗng → 0');
  ok(blocks[0].includes('00:00:00,000 --> '), 'caption 1 bắt đầu tại start segment');
  ok(blocks[1].endsWith('Câu hai dài hơn hẳn nhé!'), 'caption 2 là câu 2');
  ok(blocks[1].includes(' --> 00:00:03,500'), 'caption cuối chạm end segment (3.5s)');
  const tj = toTimelineJson(tl, segments);
  eq(tj.segments.length, 2, 'timeline.json đủ segment');
  eq(tj.segments[0].narration, segments[0].narration, 'timeline.json mang narration review');
}

console.log('Test 6: bundle round-trip + validate');
{
  const manifest = toScriptManifest({
    jobId: 'j2',
    createdAt: 'now',
    segments: [
      seg({ id: 's1', order: 0, narration: 'Một.', shots: [
        { sourceIndex: 0, region: null, weight: 1 },
        { sourceIndex: 1, region: null, weight: 1 },
      ] }),
    ],
  });
  const config = defaultRenderConfig();
  const images = new Map([
    [0, Buffer.from('anh-band-0')],
    [1, Buffer.from('anh-band-1')],
  ]);
  const audio = new Map([['s1', Buffer.from('mp3-gia')]]);
  const bgm = { filename: 'nhac.mp3', data: Buffer.from('bgm-gia') };
  const zip = writeBundle({ scriptManifest: manifest, config, images, audio, bgm });
  const back = readBundle(zip);
  eq(back.scriptManifest, manifest, 'manifest nguyên vẹn');
  eq(back.config.bgm.path, 'bgm/nhac.mp3', 'config.bgm.path trỏ file trong zip');
  ok(back.images.get(0)!.equals(images.get(0)!) && back.images.get(1)!.equals(images.get(1)!), 'ảnh band nguyên vẹn');
  ok(back.audio!.get('s1')!.equals(audio.get('s1')!), 'audio nguyên vẹn');
  ok(back.bgm!.data.equals(bgm.data), 'bgm nguyên vẹn');

  const zipMissing = writeBundle({ scriptManifest: manifest, config, images: new Map([[0, Buffer.from('x')]]) });
  let threw = '';
  try {
    readBundle(zipMissing);
  } catch (err) {
    threw = err instanceof Error ? err.message : String(err);
  }
  ok(threw.includes('band-1'), 'thiếu band mà shot trỏ tới → lỗi rõ ràng');
}

console.log('Test 7: kenburns — hướng theo region + aspect, blur-fill');
{
  eq(frameSize('9:16'), { w: 1080, h: 1920 }, 'khung 9:16 = 1080×1920');
  const base = { imgW: 600, imgH: 2400, region: null, durationSec: 3, fps: 30, zoom: 1.12 };
  const tall916 = planKenburns({ ...base, aspect: '9:16' as const });
  eq(tall916.mode, 'pan-v', 'band dọc + 9:16 → pan dọc');
  ok(kenburns({ ...base, aspect: '9:16' }).includes('crop=1080:1920:0:'), 'filter pan-v crop theo t');
  const tall169 = planKenburns({ ...base, aspect: '16:9' as const });
  eq([tall169.mode, tall169.blurFill], ['zoom', true], 'band dọc + 16:9 → zoom + blur-fill (Validation S1)');
  ok(kenburns({ ...base, aspect: '16:9' }).includes('boxblur'), 'filter 16:9 có blur-fill nền');
  const wide = planKenburns({ ...base, imgW: 2400, imgH: 600, aspect: '16:9' as const });
  eq(wide.mode, 'pan-h', 'region rộng + 16:9 → pan ngang');
  const square916 = planKenburns({ ...base, imgW: 600, imgH: 600, aspect: '9:16' as const });
  eq([square916.mode, square916.blurFill], ['zoom', true], 'gần vuông + 9:16 → zoom + blur-fill');
  const square11 = planKenburns({ ...base, imgW: 600, imgH: 600, aspect: '1:1' as const });
  eq([square11.mode, square11.blurFill], ['zoom', false], 'vuông + 1:1 → zoom không cần blur');
  ok(kenburns({ ...base, imgW: 600, imgH: 600, aspect: '1:1' }).includes('zoompan'), 'filter zoom dùng zoompan');
  // Kẹp vận tốc pan: shot cực ngắn → quãng chạy bị giảm, không pan giật.
  const fast = planKenburns({ ...base, durationSec: 0.5, aspect: '9:16' as const });
  ok((fast.travelPx ?? 0) <= Math.round(0.35 * 1920 * 0.5), 'quãng pan bị kẹp theo vận tốc tối đa');
}

console.log('Test 7b: motion override — auto byte-identical, ép mode, reverse, static');
{
  const base = { imgW: 600, imgH: 2400, region: null, durationSec: 3, fps: 30, zoom: 1.12 };
  // GATE HỒI QUY QUAN TRỌNG NHẤT: motion undefined phải ra CHUỖI Y HỆT bản trước khi có
  // motion override — literal đóng đinh, đổi là vỡ mọi video cũ.
  const auto916 = kenburns({ ...base, aspect: '9:16' });
  eq(
    auto916,
    `[0:v]crop=600:2400:0:0,scale=1080:-2,crop=1080:1920:0:'192+2016*(t/3.000)',setsar=1[v]`,
    'auto byte-identical (literal đóng đinh trước plan motion)',
  );
  eq(
    kenburns({ ...base, aspect: '9:16' as const, motion: { mode: 'auto' as const } }),
    auto916,
    "{mode:'auto'} ≡ motion undefined",
  );
  eq(
    kenburns({ ...base, aspect: '9:16' as const, motion: { mode: 'auto' as const, reverse: true } }),
    auto916,
    'auto + reverse = no-op im lặng (hợp đồng)',
  );
  eq(
    kenburns({ ...base, aspect: '9:16' as const, motion: { mode: 'pan-v' as const, reverse: true } }),
    auto916.replace('(t/', '(1-t/'),
    'pan-v reverse: chỉ đảo frac (t/dur) → (1-t/dur), còn lại y hệt',
  );
  eq(
    kenburns({ ...base, aspect: '9:16' as const, motion: { mode: 'pan-h' as const } }),
    auto916,
    'ép pan-h bất khả thi (band dọc, coverH < 1.05) → rơi về suy luận auto',
  );
  const st = kenburns({
    ...base, imgW: 600, imgH: 600, aspect: '1:1' as const, motion: { mode: 'static' as const },
  });
  eq(st, '[0:v]crop=600:600:0:0,scale=1080:1080,setsar=1[v]', 'static khớp khung: scale thẳng, KHÔNG zoompan');
  const stBlur = kenburns({ ...base, aspect: '16:9' as const, motion: { mode: 'static' as const } });
  ok(
    stBlur.includes('boxblur') && !stBlur.includes('zoompan'),
    'static lệch tỉ lệ → blur-fill, fg tĩnh không zoompan/supersample',
  );
  const zr = kenburns({
    ...base, imgW: 600, imgH: 600, aspect: '1:1' as const,
    motion: { mode: 'zoom' as const, reverse: true },
  });
  ok(zr.includes(`z='1.1200-0.1200*on/`), 'zoom reverse dạng đóng Z-(Z-1)*on/(frames-1)');
  // Ép pan bỏ trần PAN_MAX_COVER: band cực cao (cover > 3) auto từ chối pan, ép thì vẫn pan.
  const veryTall = { ...base, imgW: 400, imgH: 4000, aspect: '9:16' as const };
  eq(planKenburns(veryTall).mode, 'zoom', 'đối chứng: auto từ chối pan khi cover > 3');
  eq(
    planKenburns({ ...veryTall, motion: { mode: 'pan-v' as const } }).mode,
    'pan-v',
    'ép pan-v bỏ trần cover 3× — tôn trọng lựa chọn người dùng',
  );
  eq(
    availableModes(null, 600, 2400, '9:16'),
    ['auto', 'pan-v', 'zoom', 'static'],
    'availableModes band dọc 9:16: có pan-v, không pan-h',
  );
  eq(
    availableModes(null, 600, 600, '1:1'),
    ['auto', 'zoom', 'static'],
    'availableModes vuông 1:1: pan nào cũng bất khả thi',
  );
}

console.log('Test 8: TTS cache — MISS gọi API 1 lần, HIT không fetch (mock ElevenLabs)');
{
  let hasFfmpeg = true;
  try {
    await assertFfmpeg();
  } catch {
    hasFfmpeg = false;
    console.log('  ~ SKIP: thiếu ffmpeg/ffprobe — bỏ qua test cache TTS (unit khác vẫn chạy)');
  }
  if (hasFfmpeg) {
    const mock = await createMockElevenLabs();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'tts-cache-'));
    const cfg = {
      apiKey: 'mock-key',
      baseUrl: `http://localhost:${mock.port}`,
      voiceId: 'voice-test',
      model: 'model-test',
      cacheDir,
    };
    const r1 = await synthSegment('Xin chào Stage 2.', cfg);
    eq(r1.cached, false, 'lần 1: MISS');
    eq(mock.requestCount(), 1, 'lần 1 gọi API đúng 1 lần');
    ok(r1.durationSec > 0.8 && r1.durationSec < 1.3, `độ dài mp3 mock ~1s (${r1.durationSec.toFixed(2)})`);
    ok(existsSync(r1.mp3Path), 'mp3 nằm trong cache đĩa');

    const r2 = await synthSegment('Xin chào Stage 2.', cfg);
    eq(r2.cached, true, 'lần 2: HIT');
    eq(mock.requestCount(), 1, 'HIT không fetch thêm');
    eq(r2.mp3Path, r1.mp3Path, 'cùng key → cùng file');
    eq(r2.durationSec, r1.durationSec, 'độ dài đọc từ metadata cache');

    const r3 = await synthSegment('   ', cfg);
    eq([r3.durationSec, mock.requestCount()], [0, 1], 'text rỗng → durationSec 0, không gọi API');

    const r4 = await synthSegment('Xin chào Stage 2.', { ...cfg, voiceId: 'voice-khac' });
    eq([r4.cached, mock.requestCount()], [false, 2], 'đổi voice → key khác → MISS');

    await rm(cacheDir, { recursive: true, force: true });
    await mock.close();
  }
}

console.log('Test 9: TTS CapCut — flow new→poll→audio, cache HIT, key prefix, fail, timeout (mock)');
{
  let hasFfmpeg = true;
  try {
    await assertFfmpeg();
  } catch {
    hasFfmpeg = false;
    console.log('  ~ SKIP: thiếu ffmpeg/ffprobe — bỏ qua test CapCut (unit khác vẫn chạy)');
  }
  if (hasFfmpeg) {
    const mock = await createMockCapcut();
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'capcut-cache-'));
    process.env.CAPCUT_BASE_URL = `http://127.0.0.1:${mock.port}`;
    process.env.CAPCUT_POLL_INTERVAL_MS = '10'; // poll nhanh cho test
    process.env.CAPCUT_TIMEOUT_MS = '2000';
    const cfg = {
      provider: 'capcut',
      apiKey: '',
      baseUrl: '',
      voiceId: 'BV074_streaming',
      model: '',
      cacheDir,
    };

    const r1 = await synthSegment('Xin chào CapCut.', cfg);
    eq(r1.cached, false, 'lần 1: MISS');
    eq(mock.newRequestCount(), 1, 'lần 1 tạo task đúng 1 lần');
    ok(r1.durationSec > 0.8 && r1.durationSec < 1.3, `mp3 mock ~1s (${r1.durationSec.toFixed(2)})`);
    ok(existsSync(r1.mp3Path), 'mp3 nằm trong cache đĩa');

    const r2 = await synthSegment('Xin chào CapCut.', cfg);
    eq([r2.cached, mock.newRequestCount()], [true, 1], 'lần 2: HIT, mock không tạo task mới');
    eq(r2.mp3Path, r1.mp3Path, 'cùng key → cùng file');

    const kc = ttsCacheKey('Xin chào CapCut.', 'BV074_streaming', '', 'capcut');
    const ke = ttsCacheKey('Xin chào CapCut.', 'BV074_streaming', '', 'elevenlabs');
    ok(kc !== ke, 'cache key capcut ≠ elevenlabs cùng text/voice/model (prefix provider)');
    eq(r1.key, kc, 'synthSegment dùng đúng key capcut');

    const r3 = await synthSegment('   ', cfg);
    eq([r3.durationSec, mock.newRequestCount()], [0, 1], 'text rỗng → duration 0, không tạo task');

    // H1: voiceId rỗng + đổi CAPCUT_VOICE (env) → key phản ánh giọng hiệu dụng, KHÔNG HIT nhầm.
    const cfgEnvVoice = { ...cfg, voiceId: '' };
    process.env.CAPCUT_VOICE = 'BV074_streaming';
    const e1 = await synthSegment('Giọng mặc định env.', cfgEnvVoice);
    const newAfterE1 = mock.newRequestCount();
    process.env.CAPCUT_VOICE = 'BV075_streaming';
    const e2 = await synthSegment('Giọng mặc định env.', cfgEnvVoice);
    ok(e1.key !== e2.key, 'đổi CAPCUT_VOICE khi voiceId rỗng → key khác (không HIT nhầm giọng cũ)');
    eq([e2.cached, mock.newRequestCount() > newAfterE1], [false, true], 'giọng env mới → MISS, tạo task mới');
    delete process.env.CAPCUT_VOICE;

    let failMsg = '';
    try {
      await synthSegment('Lỗi giọng.', { ...cfg, voiceId: CAPCUT_FAIL_VOICE });
    } catch (err) {
      failMsg = err instanceof Error ? err.message : String(err);
    }
    ok(failMsg.includes('TTS_PROVIDER=elevenlabs'), 'task fail → message gợi ý đổi elevenlabs');
    ok(!/token/i.test(failMsg), 'message lỗi task fail không lộ token');

    let toMsg = '';
    try {
      await synthSegment('Chờ mãi.', { ...cfg, voiceId: CAPCUT_QUEUE_VOICE });
    } catch (err) {
      toMsg = err instanceof Error ? err.message : String(err);
    }
    ok(
      toMsg.includes('quá thời gian chờ') && toMsg.includes('TTS_PROVIDER=elevenlabs'),
      'poll timeout → message gợi ý đổi elevenlabs',
    );

    delete process.env.CAPCUT_BASE_URL;
    delete process.env.CAPCUT_POLL_INTERVAL_MS;
    delete process.env.CAPCUT_TIMEOUT_MS;
    await rm(cacheDir, { recursive: true, force: true });
    await mock.close();
  }
}

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
