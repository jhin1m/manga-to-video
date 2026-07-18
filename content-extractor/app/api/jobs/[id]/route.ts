import { NextResponse } from 'next/server';
import { getJob, setJobContext, toJobStatusDTO } from '@/lib/jobs';

export const runtime = 'nodejs';

// Trần độ dài ngữ cảnh chương — đủ cho danh sách nhân vật + tóm tắt, chặn payload vô lý.
const MAX_CONTEXT_LENGTH = 4000;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  return NextResponse.json(toJobStatusDTO(job));
}

// Cập nhật ngữ cảnh chương. Cho phép cả khi job đang chạy: mỗi task vision đọc job.context
// tại thời điểm chạy, nên task đã bay giữ giá trị cũ còn task chưa chạy (kể cả đang xếp hàng
// trong cùng lượt) dùng giá trị mới — cả hai đều là ngữ cảnh hợp lệ, không hỏng dữ liệu.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  let context: unknown;
  try {
    context = ((await req.json()) as { context?: unknown })?.context;
  } catch {
    return NextResponse.json({ error: 'Body phải là JSON { context: string }' }, { status: 400 });
  }
  if (typeof context !== 'string') {
    return NextResponse.json({ error: 'context phải là chuỗi' }, { status: 400 });
  }
  if (context.length > MAX_CONTEXT_LENGTH) {
    return NextResponse.json(
      { error: `context tối đa ${MAX_CONTEXT_LENGTH} ký tự` },
      { status: 400 },
    );
  }
  setJobContext(id, context);
  return NextResponse.json(toJobStatusDTO(job));
}
