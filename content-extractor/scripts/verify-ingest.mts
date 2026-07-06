// Verify ingest downscale: ảnh dải dọc (ratio ≥ STRIP_RATIO) chỉ kẹp bề rộng,
// giữ nguyên chiều cao (không nghiền chữ trước khi stitch/cắt band);
// ảnh thường vẫn fit-inside MAX_EDGE như Stage 1.
import sharp from 'sharp';
import { downscale } from '../lib/pipeline';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .png()
    .toBuffer();
const dims = async (buf: Buffer) => {
  const m = await sharp(buf, { limitInputPixels: false }).metadata();
  return { w: m.width, h: m.height };
};

console.log('Ingest downscale theo loại ảnh (MAX_EDGE=1568, STRIP_RATIO mặc định 2.5)');
// Slice webtoon cao: giữ nguyên (width 800 ≤ 1568, height không bị ép)
eq(await dims(await downscale(await png(800, 6000), 1568)), { w: 800, h: 6000 }, 'slice 800×6000 giữ nguyên chiều cao');
// Slice cao rộng hơn ngưỡng: kẹp width về 1568, height theo tỉ lệ
eq(await dims(await downscale(await png(2000, 12000), 1568)), { w: 1568, h: 9408 }, 'slice 2000×12000 → kẹp width 1568');
// Trang manga thường: fit-inside như Stage 1
eq(await dims(await downscale(await png(3000, 2000), 1568)), { w: 1568, h: 1045 }, 'ảnh ngang fit-inside');
eq(await dims(await downscale(await png(600, 900), 1568)), { w: 600, h: 900 }, 'ảnh nhỏ không phóng to');
// Sát ngưỡng ratio 2.5: 800×2000 (2.5 đúng ngưỡng → tall), 800×1999 (dưới ngưỡng → fit-inside)
eq(await dims(await downscale(await png(800, 2000), 1568)), { w: 800, h: 2000 }, 'ratio = 2.5 → nhánh dải dọc');
eq(await dims(await downscale(await png(800, 1999), 1568)), { w: 628, h: 1568 }, 'ratio < 2.5 → fit-inside');

console.log(failures === 0 ? '\nALL_PASS' : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
