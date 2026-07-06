// Verify narration: fillNarration template + skeletonBeats + composeStoryboard (nhánh pages).
// Nhánh strip (2A vision) verify ở e2e (scripts/e2e-storyboard.mts) qua mock OpenAI server.
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
  const strip = skeletonBeats('strip', [
    { sourceIndex: 0, bands: [{ x: 0, y: 0, w: 800, h: 4795 }, { x: 0, y: 4795, w: 800, h: 4800 }] },
  ]);
  eq(strip.length, 2, 'strip: mỗi band 1 beat');
  eq(strip.map((b) => b.order), [0, 1], 'order tăng dần');
  eq(strip[1].region, { x: 0, y: 4795, w: 800, h: 4800 }, 'region gắn đúng band');
  eq(strip[0].status, 'pending', 'beat khởi tạo pending');
  const pages = skeletonBeats('pages', [
    { sourceIndex: 0, bands: [] },
    { sourceIndex: 1, bands: [] },
    { sourceIndex: 2, bands: [] },
  ]);
  eq(pages.length, 3, 'pages: mỗi trang 1 beat');
  ok(pages.every((b) => b.region === null), 'pages: region = null (cả trang)');
}

console.log('Test 3: composeStoryboard nhánh pages (template, không mạng)');
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
  const beats = skeletonBeats('pages', working.map((w) => ({ sourceIndex: w.sourceIndex, bands: [] })));
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

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
