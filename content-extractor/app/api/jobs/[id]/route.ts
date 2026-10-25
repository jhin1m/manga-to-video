import { NextResponse } from 'next/server';
import { getJob, setJobContext, setJobOutputLanguage, toJobStatusDTO } from '@/lib/jobs';
import { isOutputLanguage, OUTPUT_LANGUAGES } from '@/lib/output-language';

export const runtime = 'nodejs';

// Trần độ dài ngữ cảnh chương — phải chứa vừa series context nạp từ file: bible cap 2000 từ
// (~10-12k ký tự tiếng Việt) + 2 recap ~500 từ + lề. Chỉ chặn payload vô lý.
const MAX_CONTEXT_LENGTH = 16000;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  return NextResponse.json(toJobStatusDTO(job));
}

// Cập nhật ngữ cảnh chương và/hoặc ngôn ngữ đầu ra. Cho phép cả khi job đang chạy: mỗi task
// vision đọc job.context/outputLanguage tại thời điểm chạy, nên task đã bay giữ giá trị cũ còn
// task chưa chạy (kể cả đang xếp hàng trong cùng lượt) dùng giá trị mới. Với context cả hai đều
// hợp lệ; với ngôn ngữ thì content có thể trộn hai thứ tiếng — UI chỉ cho đổi trước "Tạo
// storyboard" nên không xảy ra. Validate hết TRƯỚC khi ghi: body hỏng một field thì không ăn gì.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  let body: { context?: unknown; outputLanguage?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || (body.context === undefined && body.outputLanguage === undefined)) {
    return NextResponse.json(
      { error: 'Body phải là JSON { context?: string, outputLanguage?: string } (ít nhất một field)' },
      { status: 400 },
    );
  }
  const { context, outputLanguage } = body;
  if (context !== undefined) {
    if (typeof context !== 'string') {
      return NextResponse.json({ error: 'context phải là chuỗi' }, { status: 400 });
    }
    if (context.length > MAX_CONTEXT_LENGTH) {
      return NextResponse.json(
        { error: `context tối đa ${MAX_CONTEXT_LENGTH} ký tự` },
        { status: 400 },
      );
    }
  }
  // Giá trị lạ là lỗi, KHÔNG normalize về 'vi': client gửi 'ja' mà âm thầm chạy tiếng Việt
  // thì người dùng chỉ phát hiện sau khi đã tốn cả lượt vision.
  if (outputLanguage !== undefined && !isOutputLanguage(outputLanguage)) {
    const valid = OUTPUT_LANGUAGES.map((l) => l.id).join(', ');
    return NextResponse.json(
      { error: `outputLanguage không hợp lệ — chọn một trong: ${valid}` },
      { status: 400 },
    );
  }
  if (typeof context === 'string') setJobContext(id, context);
  if (outputLanguage !== undefined) setJobOutputLanguage(id, outputLanguage);
  return NextResponse.json(toJobStatusDTO(job));
}
