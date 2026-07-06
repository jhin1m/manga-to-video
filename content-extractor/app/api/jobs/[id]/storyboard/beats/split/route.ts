import { NextResponse } from 'next/server';
import { getStoryboard, splitBeat, toStoryboardDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Tách đôi một nhịp theo trục y. Body: { beatId: string }.
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
    return NextResponse.json(toStoryboardDTO(splitBeat(id, beatId)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không tách được nhịp';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
