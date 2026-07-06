import { NextResponse } from 'next/server';
import { getStoryboard, reorderBeat, toStoryboardDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Di chuyển nhịp tới vị trí mới. Body: { beatId: string, to: number }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getStoryboard(id)) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  let beatId: unknown;
  let to: unknown;
  try {
    const body = (await req.json()) as { beatId?: unknown; to?: unknown };
    beatId = body?.beatId;
    to = body?.to;
  } catch {
    // body thiếu → báo lỗi bên dưới
  }
  if (typeof beatId !== 'string' || typeof to !== 'number' || !Number.isInteger(to) || to < 0) {
    return NextResponse.json({ error: 'Cần beatId (chuỗi) và to (số nguyên ≥ 0)' }, { status: 400 });
  }
  try {
    return NextResponse.json(toStoryboardDTO(reorderBeat(id, beatId, to)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không đổi được thứ tự';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
