import { NextResponse } from 'next/server';
import { getJob, toJobStatusDTO, updateProgress } from '@/lib/jobs';
import { processChapter } from '@/lib/pipeline';
import { readVisionConfig, type VisionConfig } from '@/lib/vision';

export const runtime = 'nodejs';

const MAX_RPM = 600; // trần an toàn (10 req/giây) — chặn giá trị vô lý từ client

// rpm hợp lệ (số dương) → làm tròn + kẹp trần; ngược lại dùng mặc định từ ENV.
function resolveRpm(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.round(raw), MAX_RPM);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  if (job.progress.phase === 'queued' || job.progress.phase === 'processing') {
    return NextResponse.json({ error: 'Job đang chạy' }, { status: 409 });
  }

  let config: VisionConfig;
  try {
    config = readVisionConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cấu hình vision không hợp lệ';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Body tùy chọn { rpm?: number }: override nhịp cho lượt chạy này; thiếu/không hợp lệ → dùng ENV.
  let rpm = config.rpm;
  try {
    const body: unknown = await req.json();
    if (body && typeof body === 'object') {
      rpm = resolveRpm((body as { rpm?: unknown }).rpm, config.rpm);
    }
  } catch {
    // Không có body / không phải JSON → giữ nhịp mặc định theo ENV.
  }
  const minIntervalMs = rpm > 0 ? Math.ceil(60000 / rpm) : 0;

  // Đánh dấu 'queued' đồng bộ trước khi fire-and-forget để snapshot SSE ngay không lọt phase 'ready'.
  updateProgress(id, { phase: 'queued', currentIndex: null });
  processChapter(id, { concurrency: config.concurrency, minIntervalMs }).catch((err) => {
    console.error('[pipeline] job thất bại:', err);
    updateProgress(id, { phase: 'failed', currentIndex: null });
  });

  return NextResponse.json(toJobStatusDTO(job));
}
