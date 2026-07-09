import { NextResponse } from 'next/server';
import { getStoryboard, splitSegment, toScriptDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Tách 1 đoạn tại biên shot. Body: { segId, atShotIndex } — shots[atShotIndex..] sang đoạn mới.
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
  let atShotIndex: unknown;
  try {
    const body = (await req.json()) as { segId?: unknown; atShotIndex?: unknown };
    segId = body?.segId;
    atShotIndex = body?.atShotIndex;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }
  if (typeof segId !== 'string' || typeof atShotIndex !== 'number') {
    return NextResponse.json(
      { error: 'Cần segId (chuỗi) và atShotIndex (số nguyên ≥ 1)' },
      { status: 400 },
    );
  }

  try {
    splitSegment(id, segId, atShotIndex);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không tách được';
    const status = message.includes('Không tìm thấy') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(toScriptDTO(getStoryboard(id)!));
}
