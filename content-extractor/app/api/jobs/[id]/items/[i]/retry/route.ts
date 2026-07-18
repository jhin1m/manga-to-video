import { NextResponse } from 'next/server';
import { getJob, setItemError, setItemResult, toItemDTO } from '@/lib/jobs';
import { classifyError, describeImage } from '@/lib/vision';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; i: string }> },
) {
  const { id, i } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  const index = Number.parseInt(i, 10);
  const item = Number.isInteger(index) ? job.items[index] : undefined;
  if (!item) {
    return NextResponse.json({ error: 'Không tìm thấy ảnh trong job' }, { status: 404 });
  }

  try {
    const content = await describeImage(item.buffer, item.filename, job.context);
    setItemResult(id, index, content); // đồng thời khớp lại progress.done + emit
  } catch (err) {
    setItemError(id, index, classifyError(err));
  }

  return NextResponse.json(toItemDTO(id, item));
}
