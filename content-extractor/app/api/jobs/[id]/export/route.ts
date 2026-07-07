import { NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';
import { toManifest } from '@/lib/schema';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  return NextResponse.json(toManifest(job), {
    headers: {
      'Content-Disposition': `attachment; filename="manifest-${job.id}.json"`,
    },
  });
}
