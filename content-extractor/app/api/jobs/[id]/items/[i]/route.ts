import { NextResponse } from 'next/server';
import { deleteItem, getJob, toJobStatusDTO } from '@/lib/jobs';

export const runtime = 'nodejs';

// Hard-delete 1 band khỏi job: splice + re-index phần còn lại. Chỉ cho xoá khi job không
// đang chạy vision (queued/processing) — tránh lệch currentIndex/kết quả đang bay giữa chừng.
export async function DELETE(
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
  if (job.progress.phase === 'queued' || job.progress.phase === 'processing') {
    return NextResponse.json({ error: 'Job đang chạy' }, { status: 409 });
  }

  deleteItem(id, index);

  return NextResponse.json(toJobStatusDTO(getJob(id)!));
}
