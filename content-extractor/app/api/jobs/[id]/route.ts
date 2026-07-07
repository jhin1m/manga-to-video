import { NextResponse } from 'next/server';
import { getJob, toJobStatusDTO } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  return NextResponse.json(toJobStatusDTO(job));
}
