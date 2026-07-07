// Verify banding: smart-split (cắt tại gutter dày, ngữ cảnh) + stitch + ingest band + PDF expand.
// Settings test-local `S` độc lập process.env (không phụ thuộc .env.local của máy chạy).
import sharp from 'sharp';
import {
  chooseCuts,
  computeSafeRuns,
  detectBands,
  isSafeLine,
  mergeLowInkBands,
  regionsFromCuts,
  toGray,
  type GrayImage,
  type SplitSettings,
} from '../lib/smart-split';
import type { BeatRegion } from '../lib/schema';
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

// Canvas trắng + "block" đen (rect không tràn hết bề ngang → hàng cắt ngang block là unsafe).
// Dùng để dựng nhân vật/bong bóng/nội dung giả — vùng còn lại là "gutter" (khoảng trắng).
async function makeStrip(
  width: number,
  height: number,
  blocks: Array<{ x: number; y: number; w: number; h: number }>,
): Promise<Buffer> {
  const composites = await Promise.all(
    blocks.map(async (b) => ({
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
  lineTolerance: 25,
  ignorableBorder: 5,
  minGutterHeight: 24,
  minBandHeight: 300,
  maxBandHeight: 700,
  minInkDensity: 0.02,
};

// ---- T1: giữ nhân vật + bong bóng — bỏ qua khe hẹp, cắt tại gutter dày ----
console.log('T1: khối A (nhân vật, y100-300) + khe hẹp 10px + khối B (bong bóng, y310-400) + gutter dày (y400-460)');
{
  const strip = await makeStrip(400, 1000, [
    { x: 100, y: 100, w: 200, h: 200 }, // khối A
    { x: 100, y: 310, w: 200, h: 90 }, // khối B — cách A 10px (< minGutterHeight 24)
    { x: 100, y: 460, w: 200, h: 10 }, // khối C — chặn cuối gutter dày (400-460, 60px)
  ]);
  const gray = await toGray(strip);
  const runs = computeSafeRuns(gray, S);
  assertEq(
    runs,
    [
      { start: 0, end: 100 },
      { start: 300, end: 310 },
      { start: 400, end: 460 },
      { start: 470, end: 1000 },
    ],
    'safe run khớp bố cục: trước A, khe A-B, gutter dày, phần còn lại',
  );
  const cuts = chooseCuts(runs, gray.height, S);
  assertEq(cuts, [430], 'cắt duy nhất tại tâm gutter dày (400-460 → 430)');
  assertOk(
    cuts.every((y) => !(y >= 300 && y < 310)),
    'không điểm cắt nào rơi vào khe hẹp nhân vật↔bong bóng (300-310)',
  );
}

// ---- T2: chọn gutter dày nhất trong cửa sổ khi có nhiều ứng viên hợp lệ ----
console.log('T2: 2 gutter cùng đạt minGutterHeight trong cửa sổ — chọn gutter dày hơn (600) thay vì gutter mỏng hơn (365)');
{
  const strip = await makeStrip(400, 1000, [
    { x: 100, y: 0, w: 200, h: 350 }, // khối trước gutter1
    { x: 100, y: 380, w: 200, h: 170 }, // khối giữa gutter1 (350-380, 30px) và gutter2 (550-650, 100px)
    { x: 100, y: 650, w: 200, h: 350 }, // khối sau gutter2
  ]);
  const gray = await toGray(strip);
  const runs = computeSafeRuns(gray, S);
  assertEq(
    runs,
    [
      { start: 350, end: 380 }, // gutter1: thickness 30, center 365
      { start: 550, end: 650 }, // gutter2: thickness 100, center 600
    ],
    'safe run khớp 2 gutter (cả hai ≥ minGutterHeight)',
  );
  const cuts = chooseCuts(runs, gray.height, S);
  assertEq(cuts, [600], 'chọn gutter dày nhất (600, thickness 100) thay vì gutter mỏng hơn (365, thickness 30)');
}

// ---- T3: canvas nhiễu (mọi hàng unsafe) vượt maxBandHeight → force-cut, không văng ----
console.log('T3: canvas 400x900 sọc dọc đen/trắng — mọi hàng unsafe, không có gutter nào');
{
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
    .resize(400, 900, { kernel: 'nearest', fit: 'fill' })
    .png()
    .toBuffer();
  const gray = await toGray(noisy);
  assertOk(!isSafeLine(gray, 450, S), 'hàng bất kỳ là unsafe (sọc dọc)');
  const runs = computeSafeRuns(gray, S);
  assertEq(runs, [], 'không có run an toàn nào');
  const cuts = chooseCuts(runs, gray.height, S);
  assertEq(cuts, [700], 'force-cut tại maxBandHeight (700) khi không có gutter, không văng lỗi');
}

// ---- T4: mọi band ∈ [minBandHeight, maxBandHeight] trừ band cuối ----
console.log('T4: chuỗi 8 khối cách đều (250px khối + 26px gutter) — mọi band trừ cuối nằm trong [300,700]');
{
  const unitBlockH = 250;
  const unitGutterH = 26;
  const units = 8;
  const blocks: Array<{ x: number; y: number; w: number; h: number }> = [];
  let y = 0;
  for (let i = 0; i < units; i++) {
    blocks.push({ x: 100, y, w: 200, h: unitBlockH });
    y += unitBlockH + unitGutterH;
  }
  const height = y; // canvas kết thúc ngay sau gutter cuối cùng
  const strip = await makeStrip(400, height, blocks);
  const gray = await toGray(strip);
  const runs = computeSafeRuns(gray, S);
  const cuts = chooseCuts(runs, height, S);
  const regions = regionsFromCuts(cuts, 400, height);
  assertOk(cuts.length > 1, 'chuỗi đủ dài tạo nhiều hơn 1 điểm cắt');
  assertOk(
    regions.slice(0, -1).every((r) => r.h >= S.minBandHeight && r.h <= S.maxBandHeight),
    'mọi band trừ band cuối nằm trong [minBandHeight, maxBandHeight]',
  );
}

// ---- T5: contiguity — regionsFromCuts phủ kín, liền mạch ----
console.log('T5: regionsFromCuts trên cuts [539,1091,1643] / height 2208 (tái dùng bố cục T4)');
{
  const cuts = [539, 1091, 1643];
  const height = 2208;
  const regions = regionsFromCuts(cuts, 400, height);
  assertEq(
    regions,
    [
      { x: 0, y: 0, w: 400, h: 539 },
      { x: 0, y: 539, w: 400, h: 552 },
      { x: 0, y: 1091, w: 400, h: 552 },
      { x: 0, y: 1643, w: 400, h: 565 },
    ],
    'regions liền mạch, phủ kín [0,height)',
  );
  assertOk(regions.every((r) => r.w === 400 && r.h > 0), 'mọi band w=width, h>0');
  assertEq(regions.reduce((sum, r) => sum + r.h, 0), height, 'Σh = height');
  assertOk(
    regions.every((r, i) => i === 0 || r.y === regions[i - 1].y + regions[i - 1].h),
    'contiguous: y_i = y_{i-1} + h_{i-1}',
  );
}

// ---- T6: gộp band mật độ mực thấp (gần trắng) ----
console.log('T6: mergeLowInkBands — band giữa/đầu gần trắng gộp vào hàng xóm; band cuối < minBandHeight luôn gộp');
{
  // (a) band giữa mật độ thấp → gộp vào band liền TRƯỚC.
  const width = 400;
  const height = 1000;
  const data = new Uint8Array(width * height).fill(255);
  for (let py = 0; py < 400; py++) for (let px = 0; px < 40; px++) data[py * width + px] = 0; // region1: density 0.1
  for (let py = 400; py < 500; py++) for (let px = 0; px < 4; px++) data[py * width + px] = 0; // region2: density 0.01 < 0.02
  for (let py = 500; py < 1000; py++) for (let px = 0; px < 40; px++) data[py * width + px] = 0; // region3: density 0.1
  const img: GrayImage = { data, width, height };
  const regions: BeatRegion[] = [
    { x: 0, y: 0, w: width, h: 400 },
    { x: 0, y: 400, w: width, h: 100 },
    { x: 0, y: 500, w: width, h: 500 },
  ];
  const merged = mergeLowInkBands(regions, img, S);
  assertEq(
    merged,
    [
      { x: 0, y: 0, w: width, h: 500 },
      { x: 0, y: 500, w: width, h: 500 },
    ],
    'band giữa gần trắng gộp vào band trước — còn 2 band liền mạch',
  );
  assertOk(
    merged.every((r) => regionInkDensity(img, r) >= S.minInkDensity),
    'không band nào density < minInkDensity trong output',
  );
}
{
  // (b) band ĐẦU mật độ thấp (chưa có "trước") → gộp về band liền SAU.
  const width = 400;
  const height = 600;
  const data = new Uint8Array(width * height).fill(255);
  for (let py = 0; py < 100; py++) for (let px = 0; px < 2; px++) data[py * width + px] = 0; // region1: density 0.005
  for (let py = 100; py < 600; py++) for (let px = 0; px < 40; px++) data[py * width + px] = 0; // region2: density 0.1
  const img: GrayImage = { data, width, height };
  const regions: BeatRegion[] = [
    { x: 0, y: 0, w: width, h: 100 },
    { x: 0, y: 100, w: width, h: 500 },
  ];
  const merged = mergeLowInkBands(regions, img, S);
  assertEq(merged, [{ x: 0, y: 0, w: width, h: 600 }], 'band đầu gần trắng gộp về sau — còn 1 band trọn canvas');
}
{
  // (c) band CUỐI ngắn hơn minBandHeight → luôn gộp vào band trước, bất kể mật độ mực.
  const width = 400;
  const height = 700;
  const data = new Uint8Array(width * height).fill(255);
  for (let py = 0; py < 700; py++) for (let px = 0; px < 40; px++) data[py * width + px] = 0; // mật độ bình thường khắp canvas
  const img: GrayImage = { data, width, height };
  const regions: BeatRegion[] = [
    { x: 0, y: 0, w: width, h: 500 },
    { x: 0, y: 500, w: width, h: 200 }, // 200 < minBandHeight (300)
  ];
  const merged = mergeLowInkBands(regions, img, S);
  assertEq(merged, [{ x: 0, y: 0, w: width, h: 700 }], 'band cuối < minBandHeight gộp vào band trước dù mật độ mực bình thường');
}

function regionInkDensity(img: GrayImage, r: BeatRegion): number {
  let ink = 0;
  for (let py = r.y; py < r.y + r.h; py++) {
    const row = py * img.width;
    for (let px = r.x; px < r.x + r.w; px++) {
      if (img.data[row + px] < 250) ink++;
    }
  }
  return ink / (r.w * r.h);
}

// ---- Test stitch ----
console.log('Test stitch: 3 slice khác bề rộng');
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

// ---- Test ingest: ingestBandItems với default mới (SPLIT_HEIGHT 1600 → min 960 / max 2240) ----
console.log('Test ingest: ingestBandItems — 3 trang 600×900 màu phẳng → canvas 600×2700 → 1 gutter liên tục → cắt tại tâm (1350)');
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
  // Mỗi trang màu phẳng → mọi hàng đồng nhất theo chiều ngang trên toàn canvas 2700px
  // → CẢ canvas là một gutter liên tục (≥ minGutterHeight) → chooseCuts cắt đúng 1 lần
  // tại tâm gutter (1350), không còn theo SPLIT_HEIGHT cố định như thuật toán cũ.
  assertEq(items.map((it) => it.filename), ['band-1.jpg', 'band-2.jpg'], 'tên band đánh số theo thứ tự');
  assertEq(
    items.map((it) => ({ w: it.width, h: it.height, mime: it.mime })),
    [
      { w: 600, h: 1350, mime: 'image/jpeg' },
      { w: 600, h: 1350, mime: 'image/jpeg' },
    ],
    'band phủ kín canvas: 1350 + 1350 = 2700 (cắt tại tâm gutter)',
  );
  const metas = await Promise.all(items.map((it) => sharp(it.buffer).metadata()));
  assertOk(
    metas.every((m, i) => m.width === items[i].width && m.height === items[i].height),
    'buffer band decode đúng kích thước khai báo',
  );
}

// ---- Test PDF expand vào pipeline ----
console.log('Test PDF: expandPdfs — PDF 2 trang → 2 RawImage đúng thứ tự');
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

// ---- Regression: detectBands end-to-end vẫn giữ bất biến trên bố cục T1 ----
console.log('Regression: detectBands (full pipeline) trên bố cục T1 — vẫn liền mạch, không cắt xuyên khối');
{
  const strip = await makeStrip(400, 1000, [
    { x: 100, y: 100, w: 200, h: 200 },
    { x: 100, y: 310, w: 200, h: 90 },
    { x: 100, y: 460, w: 200, h: 10 },
  ]);
  const bands = await detectBands(strip, S);
  assertOk(bands.every((b) => b.w === 400 && b.h > 0), 'mọi band w=400, h>0');
  assertEq(bands.reduce((sum, b) => sum + b.h, 0), 1000, 'Σh = height (1000)');
  assertOk(
    bands.every((b, i) => i === 0 || b.y === bands[i - 1].y + bands[i - 1].h),
    'contiguous',
  );
}

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
