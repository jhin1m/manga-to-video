import { NextResponse } from 'next/server';
import { composeBeat } from '@/lib/narration';
import { getBeat, getStoryboard, toBeatDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Chạy lại compose cho MỘT nhịp (strip: crop band → vision; pages: template từ content Stage 1).
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

  await composeBeat(id, beatId); // lỗi được cô lập vào beat.error bên trong

  return NextResponse.json(toBeatDTO(id, getBeat(id, beatId)!));
}
