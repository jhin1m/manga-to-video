// Verify Stage 2 (unit, mock — không API thật, không tiền):
//   generateScript (mock model) · toScriptSegments biên · toScriptManifest shape/clone
//   buildTimeline/allocateShots · splitSentences/toSrt (caption tách câu) · bundle round-trip
//   kenburns (pan-v/pan-h/zoom/blur-fill) · TTS cache MISS/HIT (mock ElevenLabs, cần ffprobe)
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBundle, writeBundle } from '../lib/bundle';
import { assertFfmpeg } from '../lib/ffmpeg';
import { frameSize, kenburns, planKenburns } from '../lib/kenburns';
import type { ScriptSegment } from '../lib/schema';
import {
  defaultRenderConfig,
  estimateSeconds,
  SCRIPT_VERSION,
  toScriptManifest,
} from '../lib/schema';
import { generateScript, toScriptSegments } from '../lib/script';
import {
  allocateCaptions,
  allocateShots,
  buildTimeline,
  splitSentences,
  toSrt,
  toTimelineJson,
} from '../lib/timeline';
import { synthSegment } from '../lib/tts';
import { createMockElevenLabs } from './mock-elevenlabs.mjs';
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

console.log('Test 1: toScriptSegments — validate biên shotIndices');
{
  const inputs = [0, 1, 2].map((i) => ({
    order: i,
    sourceIndex: i,
    beatId: `beat-${i}`,
    content: null,
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
  ok(segments[0].shots.every((s) => s.region === null && s.weight === 1), 'shot mặc định region null, weight 1');
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
    seg({ id: 'b', order: 1, narration: 'Hai.', shots: [{ sourceIndex: 1, region: { x: 0, y: 0, w: 10, h: 10 }, weight: 2 }] }),
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

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
