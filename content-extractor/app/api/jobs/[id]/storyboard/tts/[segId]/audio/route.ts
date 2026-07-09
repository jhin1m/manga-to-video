import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getSegmentAudio, getStoryboard } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Stream mp3 đã synth từ cache đĩa cho preview "có audio".
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; segId: string }> },
) {
  const { id, segId } = await params;
  if (!getStoryboard(id)) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  const audio = getSegmentAudio(id, segId);
  if (!audio) {
    return NextResponse.json(
      { error: 'Đoạn này chưa synth audio — gọi POST /storyboard/tts trước' },
      { status: 404 },
    );
  }
  try {
    const data = await readFile(audio.mp3Path);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'File audio trong cache không còn — synth lại' },
      { status: 404 },
    );
  }
}
