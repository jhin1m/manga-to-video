import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getWorkingImage } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Đọc hộp crop từ query — chỉ nhận khi ĐỦ 4 số, nguyên, không âm và nằm trọn trong ảnh.
// Thiếu/lệch → trả null, caller phát ảnh nguyên (không đoán, không kẹp im lặng).
function readCrop(
  url: string,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  const q = new URL(url).searchParams;
  const nums = ['x', 'y', 'w', 'h'].map((k) => Number.parseInt(q.get(k) ?? '', 10));
  if (!nums.every(Number.isInteger)) return null;
  const [x, y, w, h] = nums;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  if (x + w > width || y + h > height) return null;
  return { left: x, top: y, width: w, height: h };
}

// Working image của storyboard (strip: canvas đã stitch — PNG; pages: trang JPEG).
// Query ?x&y&w&h cắt về đúng region của shot: preview cần intrinsic size = region thì
// fgStyle/objectFit của kenburns-css mới áp đúng như lúc render (mẫu canvas region-cropper).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; i: string }> },
) {
  const { id, i } = await params;
  const sourceIndex = Number.parseInt(i, 10);
  const working = Number.isInteger(sourceIndex) ? getWorkingImage(id, sourceIndex) : undefined;
  if (!working) {
    return NextResponse.json({ error: 'Không tìm thấy ảnh làm việc' }, { status: 404 });
  }
  // PNG bắt đầu bằng 0x89 'P' — canvas stitch là PNG, buffer trang Stage 1 là JPEG.
  const isPng = working.buffer[0] === 0x89;
  const crop = readCrop(req.url, working.width, working.height);
  if (crop) {
    const out = await sharp(working.buffer).extract(crop).toBuffer();
    return new Response(new Uint8Array(out), {
      headers: { 'Content-Type': isPng ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(new Uint8Array(working.buffer), {
    headers: {
      'Content-Type': isPng ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'no-store',
    },
  });
}
