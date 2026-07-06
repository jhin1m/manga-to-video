import { NextResponse } from 'next/server';
import { getStoryboard, mergeBeatWithNext, toStoryboardDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Gộp một nhịp với nhịp kế sau (cùng ảnh nguồn). Body: { beatId: string }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getStoryboard(id)) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  let beatId: unknown;
  try {
    beatId = ((await req.json()) as { beatId?: unknown })?.beatId;
  } catch {
    // body thiếu → báo lỗi bên dưới
  }
  if (typeof beatId !== 'string') {
    return NextResponse.json({ error: 'Thiếu beatId' }, { status: 400 });
  }
  try {
    return NextResponse.json(toStoryboardDTO(mergeBeatWithNext(id, beatId)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không gộp được nhịp';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
