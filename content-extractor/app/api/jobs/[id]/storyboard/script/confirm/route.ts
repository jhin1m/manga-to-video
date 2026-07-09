import { NextResponse } from 'next/server';
import { getStoryboard, setScriptConfirmed, toScriptDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Chốt kịch bản: khoá bản duyệt, mở đường "Dựng video" (/video/[jobId]).
// Mọi mutator segment sau đó tự reset cờ này (bản duyệt cũ hết hiệu lực).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state || !state.script) {
    return NextResponse.json(
      { error: state ? 'Chưa có kịch bản cho job này' : 'Chưa có storyboard cho job này' },
      { status: 404 },
    );
  }
  if (state.scriptGenerating) {
    return NextResponse.json({ error: 'Đang tạo kịch bản, chờ xong đã' }, { status: 409 });
  }
  if (state.script.length === 0) {
    return NextResponse.json({ error: 'Kịch bản rỗng — tạo lại trước khi chốt' }, { status: 400 });
  }
  setScriptConfirmed(id, true);
  return NextResponse.json(toScriptDTO(getStoryboard(id)!));
}
