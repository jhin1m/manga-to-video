import { NextResponse } from 'next/server';
import {
  deleteSegment,
  getSegment,
  getStoryboard,
  toScriptDTO,
  updateSegment,
} from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Guard chung cho mutator segment: cần storyboard + script tồn tại, không đang generate.
function guard(id: string, segId?: string): NextResponse | null {
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  if (!state.script) {
    return NextResponse.json({ error: 'Chưa có kịch bản cho job này' }, { status: 404 });
  }
  if (state.scriptGenerating) {
    return NextResponse.json({ error: 'Đang tạo kịch bản, chờ xong đã' }, { status: 409 });
  }
  if (segId !== undefined && !getSegment(id, segId)) {
    return NextResponse.json({ error: 'Không tìm thấy đoạn kịch bản' }, { status: 404 });
  }
  return null;
}

// Sửa tay narration một đoạn → edited=true, durationHint tính lại.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; segId: string }> },
) {
  const { id, segId } = await params;
  const blocked = guard(id, segId);
  if (blocked) return blocked;

  let narration: unknown;
  try {
    narration = ((await req.json()) as { narration?: unknown })?.narration;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }
  if (typeof narration !== 'string') {
    return NextResponse.json({ error: 'narration phải là chuỗi' }, { status: 400 });
  }

  updateSegment(id, segId, { narration });
  return NextResponse.json(toScriptDTO(getStoryboard(id)!));
}

// Xoá 1 đoạn + re-sequence order.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; segId: string }> },
) {
  const { id, segId } = await params;
  const blocked = guard(id, segId);
  if (blocked) return blocked;

  deleteSegment(id, segId);
  return NextResponse.json(toScriptDTO(getStoryboard(id)!));
}
