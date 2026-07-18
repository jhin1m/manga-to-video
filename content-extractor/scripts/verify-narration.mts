// Verify narration: fillNarration template + skeletonBeats + composeStoryboard (template)
// + nhánh vision batch (Generate all): mock OpenAI in-process đếm call, assert scene persist
// vào working.content (bước Kịch bản reuse — không double-vision) và beat done không bị đè.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import {
  composeStoryboard,
  fillNarration,
  skeletonBeats,
} from '../lib/narration';
import {
  createStoryboard,
  getStoryboard,
} from '../lib/storyboard-store';
import { estimateSeconds } from '../lib/schema';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

console.log('Test 1: fillNarration template');
eq(
  fillNarration({ description: 'Hai người đối đầu.', dialogue: ['Dừng lại!', 'Không bao giờ.'], note: '' }),
  'Hai người đối đầu.\n"Dừng lại!"\n"Không bao giờ."',
  'mô tả + thoại trong ngoặc kép, mỗi dòng một',
);
eq(fillNarration({ description: '', dialogue: ['A'], note: '' }), '"A"', 'không mô tả → chỉ thoại');
eq(fillNarration({ description: '', dialogue: [], note: '' }), '', 'content rỗng → chuỗi rỗng');

console.log('Test 2: skeletonBeats');
{
  const beats = skeletonBeats([{ sourceIndex: 0 }, { sourceIndex: 1 }, { sourceIndex: 2 }]);
  eq(beats.length, 3, 'mỗi band 1 beat');
  eq(beats.map((b) => b.order), [0, 1, 2], 'order tăng dần');
  ok(beats.every((b) => b.region === null), 'region = null (trọn ảnh band)');
  eq(beats[0].status, 'pending', 'beat khởi tạo pending');
}

console.log('Test 3: composeStoryboard (template từ content Stage 1, không mạng)');
{
  const page = await sharp({
    create: { width: 600, height: 900, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  const working = [
    {
      sourceIndex: 0,
      buffer: page,
      width: 600,
      height: 900,
      content: { description: 'Trang mở đầu.', dialogue: ['Chào.'], note: '' },
    },
    { sourceIndex: 1, buffer: page, width: 600, height: 900, content: null }, // trang lỗi Stage 1
  ];
  const beats = skeletonBeats(working.map((w) => ({ sourceIndex: w.sourceIndex })));
  createStoryboard({ jobId: 'test-p3', sourceKind: 'pages', working, beats });
  await composeStoryboard('test-p3', { concurrency: 4 });
  const state = getStoryboard('test-p3')!;
  eq(state.beats[0].narration, 'Trang mở đầu.\n"Chào."', 'beat 0: narration template');
  eq(state.beats[0].sourceDialogue, ['Chào.'], 'beat 0: sourceDialogue truy vết');
  eq(state.beats[0].durationHint, estimateSeconds('Trang mở đầu.\n"Chào."'), 'beat 0: durationHint theo narration');
  eq(state.beats[0].status, 'done', 'beat 0: done');
  ok(!!state.beats[1].error && state.beats[1].status === 'error', 'beat 1 (content null): mang cờ error, không sập job');
  eq(state.beats[1].narration, '', 'beat 1: narration để trống chờ người điền');
  eq(state.progress, { done: 2, total: 2, currentIndex: null, phase: 'done' }, 'progress done 2/2, phase done');
}

console.log('Test 4: durationHint tỉ lệ độ dài');
ok(estimateSeconds('x'.repeat(150)) === 10 && estimateSeconds('x'.repeat(300)) === 20, '150 ký tự → 10s, 300 → 20s');
eq(estimateSeconds(''), 0, 'rỗng → 0');

console.log('Test 5: composeStoryboard vision:true — Generate all + persist working.content');
{
  process.env.SETTINGS_FILE = '/dev/null'; // ENV thuần, không ăn .settings.json của dev
  process.env.OPENAI_API_KEY = 'mock-key';
  process.env.VISION_MODEL = 'mock-vision';
  let visionCalls = 0;
  const scene = { description: 'Cảnh mock.', dialogue: ['Thoại mock.'], note: '' };
  const server = http.createServer((_req, res) => {
    visionCalls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(scene) } }] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  const page = await sharp({
    create: { width: 600, height: 900, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  const working = [
    { sourceIndex: 0, buffer: page, width: 600, height: 900, content: null },
    { sourceIndex: 1, buffer: page, width: 600, height: 900, content: null },
  ];
  const beats = skeletonBeats(working.map((w) => ({ sourceIndex: w.sourceIndex })));
  createStoryboard({ jobId: 'test-v5', sourceKind: 'pages', working, beats });
  await composeStoryboard('test-v5', { concurrency: 2, vision: true });
  const state = getStoryboard('test-v5')!;
  eq(visionCalls, 2, 'vision gọi đúng 1 lần cho mỗi beat pending');
  ok(
    state.beats.every((b) => b.status === 'done' && b.narration === 'Cảnh mock.\n"Thoại mock."'),
    'narration fill từ vision, mọi beat done',
  );
  eq(
    state.working.map((w) => w.content),
    [scene, scene],
    'scene persist vào working.content — bước Kịch bản reuse, không double-vision',
  );

  // Chạy lại Generate all: không còn beat pending/error → vision không bị gọi thêm,
  // narration hiện có không bị đè.
  await composeStoryboard('test-v5', { concurrency: 2, vision: true });
  eq(visionCalls, 2, 'Generate all lần 2 trên beat done → 0 call vision thêm');
  server.close();
}

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
