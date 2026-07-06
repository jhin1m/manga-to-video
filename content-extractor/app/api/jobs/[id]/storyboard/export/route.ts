import { NextResponse } from 'next/server';
import { toStoryboardManifest } from '@/lib/schema';
import { getStoryboard, toBeat } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Export StoryboardManifest — hợp đồng versioned cho Stage 2 (TTS + video Ken Burns).
// Đây cũng là bản lưu của storyboard (store in-memory mất khi restart → nạp lại qua import).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  const manifest = toStoryboardManifest({
    jobId: state.jobId,
    createdAt: state.createdAt,
    sourceKind: state.sourceKind,
    beats: state.beats.map(toBeat),
  });
  return NextResponse.json(manifest, {
    headers: {
      'Content-Disposition': `attachment; filename="storyboard-${state.jobId}.json"`,
    },
  });
}
