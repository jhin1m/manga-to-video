import { NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; i: string }> },
) {
  const { id, i } = await params;
  const job = getJob(id);
  const index = Number.parseInt(i, 10);
  const item = job && Number.isInteger(index) ? job.items[index] : undefined;
  if (!item) {
    return NextResponse.json({ error: 'Không tìm thấy ảnh' }, { status: 404 });
  }
  return new Response(new Uint8Array(item.buffer), {
    headers: {
      'Content-Type': item.mime,
      'Cache-Control': 'no-store',
    },
  });
}
