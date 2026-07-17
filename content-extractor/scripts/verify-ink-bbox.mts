// Test thuần lib/ink-bbox.ts bằng ảnh tổng hợp RGBA (không sharp, không ffmpeg — tức thời):
//   lề trắng biết trước → bbox đúng vùng mực + padding · full-bleed → null · trắng hết →
//   null · nhiễu JPEG lẻ tẻ dưới ngưỡng 1% → không phá bbox · scale ngược từ canvas hạ cỡ.
import { INK_BBOX_DEFAULTS, inkBBox, type RawImage } from '../lib/ink-bbox';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

// Ảnh RGBA trắng tinh, sau đó tô đen chữ nhật [x,y,w,h].
function makeImage(width: number, height: number, inkRects: Array<[number, number, number, number]>): RawImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [rx, ry, rw, rh] of inkRects) {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const p = (y * width + x) * 4;
        data[p] = data[p + 1] = data[p + 2] = 0;
      }
    }
  }
  return { data, width, height, channels: 4 };
}

console.log('Test 1: lề trắng biết trước → bbox = vùng mực + padding');
{
  // Ảnh 400×600, mực nằm ở [100,150 .. 300,450) — lề 100px mỗi bên ngang, 150px dọc.
  const img = makeImage(400, 600, [[100, 150, 200, 300]]);
  const r = inkBBox(img)!;
  ok(r !== null, 'có bbox');
  // padding = max(14, 4% cạnh bbox): ngang max(14, 8)=14, dọc max(14, 12)=14
  eq(r, { x: 86, y: 136, w: 228, h: 328 }, 'bbox = mực + pad 14px mỗi phía');
}

console.log('Test 2: full-bleed → null (không có lề để cắt)');
{
  const img = makeImage(400, 600, [[0, 0, 400, 600]]);
  eq(inkBBox(img), null, 'mực phủ kín → null');
  // Mực chạm cả 4 cạnh nhưng giữa trống (khung viền) — vẫn full-bleed → null
  const frame = makeImage(400, 600, [
    [0, 0, 400, 20], [0, 580, 400, 20], [0, 0, 20, 600], [380, 0, 20, 600],
  ]);
  eq(inkBBox(frame), null, 'viền chạm 4 cạnh (khoảng trắng ở GIỮA) → null');
}

console.log('Test 3: trắng hết → null');
{
  eq(inkBBox(makeImage(400, 600, [])), null, 'ảnh trắng tinh → null');
}

console.log('Test 3b: hàng đủ mực nhưng không cột nào đạt ngưỡng → null (không sliver)');
{
  // Vạch ngang mảnh 400×2 trên ảnh 400×600: hàng đạt (400 ≥ 4) nhưng mỗi cột chỉ 2px
  // mực < colMin 6 → không có bbox nghĩa.
  eq(inkBBox(makeImage(400, 600, [[0, 300, 400, 2]])), null, 'vạch ngang mảnh → null');
}

console.log('Test 4: nhiễu lẻ tẻ dưới ngưỡng 1% không phá bbox (khác ImageMagick -trim)');
{
  // Mực thật ở giữa + 1 pixel nhiễu sát góc (dưới 1% của hàng/cột) → bbox bỏ qua nhiễu.
  const img = makeImage(400, 600, [[100, 150, 200, 300], [2, 2, 1, 1]]);
  eq(inkBBox(img), { x: 86, y: 136, w: 228, h: 328 }, 'pixel nhiễu đơn lẻ bị ngưỡng tỉ lệ lọc');
}

console.log('Test 5: scale ngược từ canvas hạ cỡ ≈ bbox trên ảnh gốc (trong vài px)');
{
  // Mô phỏng luồng cropper: ảnh working 800×1200 có mực [200,300..600,900); canvas hạ cỡ
  // 1/2 → 400×600 mực [100,150..300,450) — bbox × 2 phải khớp bbox gốc (sai số ≤ pad).
  const full = inkBBox(makeImage(800, 1200, [[200, 300, 400, 600]]))!;
  const half = inkBBox(makeImage(400, 600, [[100, 150, 200, 300]]))!;
  const scaled = { x: half.x * 2, y: half.y * 2, w: half.w * 2, h: half.h * 2 };
  const near = (a: number, b: number) => Math.abs(a - b) <= INK_BBOX_DEFAULTS.padMinPx * 2;
  ok(
    near(scaled.x, full.x) && near(scaled.y, full.y) && near(scaled.w, full.w) && near(scaled.h, full.h),
    `bbox hạ cỡ × 2 ≈ bbox gốc (${JSON.stringify(scaled)} vs ${JSON.stringify(full)})`,
  );
}

console.log('Test 6: kênh RGB (3) cho cùng kết quả như RGBA (4)');
{
  const rgba = makeImage(400, 600, [[100, 150, 200, 300]]);
  const rgb = new Uint8ClampedArray(400 * 600 * 3);
  for (let i = 0, p = 0; i < 400 * 600; i++, p += 3) {
    rgb[p] = rgba.data[i * 4];
    rgb[p + 1] = rgba.data[i * 4 + 1];
    rgb[p + 2] = rgba.data[i * 4 + 2];
  }
  eq(
    inkBBox({ data: rgb, width: 400, height: 600, channels: 3 }),
    inkBBox(rgba),
    'RGB ≡ RGBA',
  );
}

if (failures > 0) {
  console.error(`verify-ink-bbox: ${failures} FAILED`);
  process.exit(1);
}
console.log('verify-ink-bbox: PASS');
