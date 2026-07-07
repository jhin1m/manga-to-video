// Verify banding: smart-split (port SmartStitch) + stitch + ingest band + PDF expand.
// Kỳ vọng smart-split tính tay từ thuật toán gốc (lib.rs) — cùng settings, cùng ảnh
// tổng hợp thì hành vi phải khớp từng pixel.
import sharp from 'sharp';
import {
  detectBands,
  findSplitPosition,
  isSafeLine,
  toGray,
  type SplitSettings,
} from '../lib/smart-split';
import { stitchSlices } from '../lib/stitch';
import { expandPdfs, ingestBandItems } from '../lib/pipeline';

let failures = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function assertOk(cond: boolean, label: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

// Canvas trắng + "bubble" đen (rect không tràn hết bề ngang → hàng cắt ngang bubble là unsafe).
async function makeStrip(
  width: number,
  height: number,
  bubbles: Array<{ x: number; y: number; w: number; h: number }>,
): Promise<Buffer> {
  const composites = await Promise.all(
    bubbles.map(async (b) => ({
      input: await sharp({
        create: { width: b.w, height: b.h, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
      left: b.x,
      top: b.y,
    })),
  );
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
    limitInputPixels: false,
  })
    .composite(composites)
    .png()
    .toBuffer();
}

const S: SplitSettings = {
  splitHeight: 5000,
  scanLineStep: 5,
  lineTolerance: 25,
  minDistancePct: 40,
  ignorableBorder: 5,
};

// ---- Test 1: bidirectional search né bubble ----
console.log('Test 1: strip 800x12000, bubble [4800,5300) và [9600,9900)');
{
  const strip = await makeStrip(800, 12000, [
    { x: 200, y: 4800, w: 400, h: 500 },
    { x: 200, y: 9600, w: 400, h: 300 },
  ]);
  const gray = await toGray(strip);
  assertOk(!isSafeLine(gray, 5000, S), 'hàng 5000 (giữa bubble) là unsafe');
  assertOk(isSafeLine(gray, 4795, S), 'hàng 4795 (trên bubble) là safe');
  const bands = await detectBands(strip, S);
  // Tính tay: target 5000 unsafe → dò lên từng 5px → 4795 (safe đầu tiên < 4800).
  // Band 2: target 4795+5000=9795 unsafe → dò lên → 9595. Band 3: phần còn lại.
  assertEq(bands, [
    { x: 0, y: 0, w: 800, h: 4795 },
    { x: 0, y: 4795, w: 800, h: 4800 },
    { x: 0, y: 9595, w: 800, h: 2405 },
  ], 'bands khớp kỳ vọng tính tay');
  const cuts = bands.slice(1).map((b) => b.y);
  assertOk(
    cuts.every((y) => !(y >= 4800 && y < 5300) && !(y >= 9600 && y < 9900)),
    'không điểm cắt nào xuyên bubble',
  );
}

// ---- Test 2: min-distance chặn band nhỏ → reset dò xuống ----
console.log('Test 2: min-distance — bubble [500,2100), splitHeight 2000');
{
  const s2: SplitSettings = { ...S, splitHeight: 2000 };
  const strip = await makeStrip(800, 3000, [{ x: 200, y: 500, w: 400, h: 1600 }]);
  const bands = await detectBands(strip, s2);
  // Tính tay: safe đầu tiên phía trên = 495 < minDistance 800 → reset về 2000 dò xuống → 2100.
  assertEq(bands, [
    { x: 0, y: 0, w: 800, h: 2100 },
    { x: 0, y: 2100, w: 800, h: 900 },
  ], 'reset dò xuống, band ≥ 40% splitHeight');
  assertOk(bands.every((b) => b.h >= 800), 'mọi band ≥ minDistance (800px)');
}

// ---- Test 3: không có safe-line → fallback target_y ----
console.log('Test 3: fallback — canvas nhiễu toàn phần (sọc dọc đen/trắng)');
{
  // Sọc dọc 1px đen/trắng xen kẽ → mọi hàng đều unsafe (diff 255 > tolerance).
  const stripe = await sharp({
    create: { width: 2, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .png()
          .toBuffer(),
        left: 1,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const noisy = await sharp(stripe, { limitInputPixels: false })
    .resize(800, 7000, { kernel: 'nearest', fit: 'fill' })
    .png()
    .toBuffer();
  const gray = await toGray(noisy);
  assertOk(!isSafeLine(gray, 3500, S), 'hàng bất kỳ là unsafe');
  const bands = await detectBands(noisy, S);
  assertEq(bands, [
    { x: 0, y: 0, w: 800, h: 5000 },
    { x: 0, y: 5000, w: 800, h: 2000 },
  ], 'fallback cắt đúng target_y=5000, không văng');
  assertEq(findSplitPosition(gray, 5000, 0, S), 5000, 'findSplitPosition fallback = target_y');
}

// ---- Test 4: canvas thấp hơn splitHeight → 1 band ----
console.log('Test 4: canvas 800x1200 → 1 band cả canvas');
{
  const short = await makeStrip(800, 1200, []);
  const bands = await detectBands(short, S);
  assertEq(bands, [{ x: 0, y: 0, w: 800, h: 1200 }], '1 band trọn canvas');
}

// ---- Test 5: stitch ----
console.log('Test 5: stitch 3 slice khác bề rộng');
{
  const slice = (w: number, h: number, c: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r: c, g: c, b: c } } })
      .png()
      .toBuffer();
  const canvas = await stitchSlices([await slice(400, 500, 10), await slice(300, 600, 120), await slice(400, 400, 240)]);
  assertEq({ w: canvas.width, h: canvas.height }, { w: 400, h: 1500 }, 'canvas = maxW x sumH');
  const raw = await sharp(canvas.buffer).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => raw.data[(y * 400 + x) * raw.info.channels];
  assertEq(px(200, 250), 10, 'slice 1 tại (200,250)');
  assertEq(px(25, 800), 255, 'slice 2 hẹp → mép trái là nền trắng');
  assertEq(px(200, 800), 120, 'slice 2 căn giữa (x 50-349)');
  assertEq(px(200, 1300), 240, 'slice 3 tại (200,1300)');
}

// ---- Test 6: ingestBandItems — upload gộp ảnh dài rồi chia lại thành band ----
console.log('Test 6: ingestBandItems — 3 trang 600×900 → canvas 2700 → 2 band (SPLIT_HEIGHT 1600)');
{
  const page = (c: number) =>
    sharp({ create: { width: 600, height: 900, channels: 3, background: { r: c, g: c, b: c } } })
      .png()
      .toBuffer();
  const items = await ingestBandItems(
    [
      { filename: '1.png', buffer: await page(100) },
      { filename: '2.png', buffer: await page(150) },
      { filename: '3.png', buffer: await page(200) },
    ],
    1568,
  );
  // Trang trơn → mọi hàng đều safe → cắt đúng target 1600; canvas 600×2700 → 2 band.
  assertEq(items.map((it) => it.filename), ['band-1.jpg', 'band-2.jpg'], 'tên band đánh số theo thứ tự');
  assertEq(
    items.map((it) => ({ w: it.width, h: it.height, mime: it.mime })),
    [
      { w: 600, h: 1600, mime: 'image/jpeg' },
      { w: 600, h: 1100, mime: 'image/jpeg' },
    ],
    'band phủ kín canvas: 1600 + 1100 = 2700',
  );
  const metas = await Promise.all(items.map((it) => sharp(it.buffer).metadata()));
  assertOk(
    metas.every((m, i) => m.width === items[i].width && m.height === items[i].height),
    'buffer band decode đúng kích thước khai báo',
  );
}

// ---- Test 7: PDF expand vào pipeline ----
console.log('Test 7: expandPdfs — PDF 2 trang → 2 RawImage đúng thứ tự');
{
  // PDF 2 trang tự dựng (xref offset thật) — như smoke test đã pass.
  const objects: string[] = [];
  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [];
  let pos = chunks[0].length;
  const push = (s: string) => {
    chunks.push(s);
    pos += s.length;
  };
  const addObj = (num: number, body: string) => {
    offsets[num] = pos;
    push(`${num} 0 obj\n${body}\nendobj\n`);
  };
  const s1 = '0 0 0 rg 20 20 100 100 re f';
  const s2 = '1 0 0 rg 50 150 80 80 re f';
  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObj(2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  addObj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>');
  addObj(4, `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`);
  addObj(5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 6 0 R >>');
  addObj(6, `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`);
  const xrefPos = pos;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  void objects;
  const pdfBuffer = Buffer.from(chunks.join(''), 'latin1');

  const out = await expandPdfs([
    { filename: 'chapter.pdf', buffer: pdfBuffer },
    { filename: 'cover.jpg', buffer: Buffer.alloc(0) },
  ]);
  assertEq(
    out.map((r) => r.filename),
    ['chapter-p1.png', 'chapter-p2.png', 'cover.jpg'],
    'tên trang PDF + ảnh thường giữ nguyên',
  );
  const m1 = await sharp(out[0].buffer).metadata();
  assertEq({ w: m1.width, h: m1.height, f: m1.format }, { w: 400, h: 600, f: 'png' }, 'trang 1 render 400x600 png (scale 2)');
}

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
