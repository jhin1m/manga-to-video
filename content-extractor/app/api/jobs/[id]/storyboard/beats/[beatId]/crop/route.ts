import { NextResponse } from 'next/server';
import { cropRegion } from '@/lib/narration';
import { getBeat, getStoryboard } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Ảnh preview vùng band của một nhịp — crop từ working image theo region (null = cả ảnh).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; beatId: string }> },
) {
  const { id, beatId } = await params;
  const state = getStoryboard(id);
  const beat = state ? getBeat(id, beatId) : undefined;
  if (!state || !beat) {
    return NextResponse.json({ error: 'Không tìm thấy nhịp' }, { status: 404 });
  }
  const working = state.working.find((w) => w.sourceIndex === beat.sourceIndex);
  if (!working) {
    return NextResponse.json(
      { error: `Không tìm thấy ảnh nguồn cho sourceIndex ${beat.sourceIndex}` },
      { status: 404 },
    );
  }
  const region = beat.region ?? { x: 0, y: 0, w: working.width, h: working.height };
  try {
    const jpeg = await cropRegion(working, region);
    return new Response(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Không cắt được ảnh preview cho nhịp này' }, { status: 500 });
  }
}
