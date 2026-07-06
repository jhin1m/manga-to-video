import { NextResponse } from 'next/server';
import { getWorkingImage } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Working image của storyboard (strip: canvas đã stitch — PNG; pages: trang JPEG).
export async function GET(
  _req: Request,
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
  return new Response(new Uint8Array(working.buffer), {
    headers: {
      'Content-Type': isPng ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'no-store',
    },
  });
}
