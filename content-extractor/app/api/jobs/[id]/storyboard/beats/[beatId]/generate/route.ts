import { NextResponse } from 'next/server';
import { composeBeat } from '@/lib/narration';
import { getBeat, getStoryboard, toBeatDTO } from '@/lib/storyboard-store';
import { readVisionConfig } from '@/lib/vision';

export const runtime = 'nodejs';

// Generate lời đọc cho MỘT nhịp bằng vision: crop vùng nhịp từ ảnh làm việc → describeImage
// → template narration. Khác retry (đọc lại content Stage 1), Generate luôn gọi vision.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; beatId: string }> },
) {
  const { id, beatId } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  const beat = getBeat(id, beatId);
  if (!beat) {
    return NextResponse.json({ error: 'Không tìm thấy nhịp trong storyboard' }, { status: 404 });
  }
  // Đòi config vision ngay để fail sớm với thông điệp rõ, thay vì lỗi chôn trong beat.
  try {
    readVisionConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cấu hình vision không hợp lệ';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await composeBeat(id, beatId, { vision: true }); // lỗi được cô lập vào beat.error bên trong

  return NextResponse.json(toBeatDTO(id, getBeat(id, beatId)!));
}
