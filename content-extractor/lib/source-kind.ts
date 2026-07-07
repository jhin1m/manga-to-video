// Ngưỡng nhận diện ảnh dải dọc (webtoon/manhua slice, PDF cắt dải) theo tỉ lệ cao/rộng.
// Dùng ở bước downscale ingest: ảnh vượt ngưỡng chỉ kẹp BỀ RỘNG, giữ nguyên chiều cao
// để stitch + smart-split không mất chữ.

export function readStripRatio(): number {
  const v = Number.parseFloat(process.env.STRIP_RATIO ?? '');
  return Number.isFinite(v) && v > 0 ? v : 2.5;
}
