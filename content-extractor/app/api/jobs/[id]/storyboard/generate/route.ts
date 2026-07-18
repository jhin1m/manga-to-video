import { NextResponse } from 'next/server';
import { composeStoryboard } from '@/lib/narration';
import {
  getStoryboard,
  toStoryboardDTO,
  updateStoryboardProgress,
} from '@/lib/storyboard-store';
import { readVisionConfig, type VisionConfig } from '@/lib/vision';

export const runtime = 'nodejs';

const MAX_RPM = 600; // trần an toàn (10 req/giây) — chặn giá trị vô lý từ client

// rpm hợp lệ (số dương) → làm tròn + kẹp trần; ngược lại dùng mặc định từ ENV.
function resolveRpm(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.round(raw), MAX_RPM);
}

// Batch vision cho storyboard ("Generate all"): chạy describeImage cho mọi beat
// pending/error, tiến độ phát qua SSE sb:{jobId}. Beat done (đã sửa tay) không bị đè.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  if (state.progress.phase === 'queued' || state.progress.phase === 'processing') {
    return NextResponse.json({ error: 'Storyboard đang xử lý' }, { status: 409 });
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

  // Đánh dấu 'queued' đồng bộ trước fire-and-forget để snapshot SSE ngay không lọt phase cũ.
  updateStoryboardProgress(id, { phase: 'queued', currentIndex: null });
  composeStoryboard(id, {
    concurrency: config.concurrency,
    minIntervalMs,
    vision: true,
  }).catch((err) => {
    console.error('[storyboard] generate-all thất bại:', err);
    updateStoryboardProgress(id, { phase: 'failed', currentIndex: null });
  });

  return NextResponse.json(toStoryboardDTO(getStoryboard(id)!));
}
