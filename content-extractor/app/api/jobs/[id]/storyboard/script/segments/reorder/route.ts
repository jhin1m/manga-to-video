import { NextResponse } from 'next/server';
import { getStoryboard, reorderSegment, toScriptDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Di chuyển đoạn tới vị trí order mới. Body: { segId: string, to: number } (mẫu beats/reorder).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let segId: unknown;
  let to: unknown;
  try {
    const body = (await req.json()) as { segId?: unknown; to?: unknown };
    segId = body?.segId;
    to = body?.to;
  } catch {
    // body thiếu → báo lỗi bên dưới
  }
  if (typeof segId !== 'string' || typeof to !== 'number' || !Number.isInteger(to) || to < 0) {
    return NextResponse.json({ error: 'Cần segId (chuỗi) và to (số nguyên ≥ 0)' }, { status: 400 });
  }

  try {
    reorderSegment(id, segId, to);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không đổi được thứ tự';
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return NextResponse.json(toScriptDTO(getStoryboard(id)!));
}
