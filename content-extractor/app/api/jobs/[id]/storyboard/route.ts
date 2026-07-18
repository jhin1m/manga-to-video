import { NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';
import { composeStoryboard, skeletonBeats } from '@/lib/narration';
import {
  createStoryboard,
  getStoryboard,
  setBeats,
  setWorking,
  toStoryboardDTO,
  updateStoryboardProgress,
  type WorkingImage,
} from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Chạy nền: mỗi item của job (đã là band từ lúc upload) → 1 working image + 1 nhịp,
// rồi compose narration từ content Stage 1 (template thuần — không gọi vision).
// POST trả về ngay ở phase 'queued'; tiến độ theo dõi qua SSE/poll.
async function buildAndCompose(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  const working: WorkingImage[] = job.items.map((it, i) => ({
    sourceIndex: i,
    buffer: it.buffer,
    width: it.width,
    height: it.height,
    content: it.content,
  }));
  setWorking(jobId, working);
  setBeats(jobId, skeletonBeats(working.map((w) => ({ sourceIndex: w.sourceIndex }))));
  // Chapter mới upload chưa có content — beats đứng ở pending sạch chờ "Generate all",
  // compose template lúc này chỉ đẻ ra lỗi "Nội dung trống" hàng loạt.
  if (!job.items.some((it) => it.content != null)) {
    updateStoryboardProgress(jobId, { phase: 'done', currentIndex: null });
    return;
  }
  await composeStoryboard(jobId, { concurrency: 4 });
}

// Tạo storyboard từ job session: 1 band = 1 nhịp, narration pre-fill từ content Stage 1.
// Nhịp chưa có content dùng nút Generate (vision) hoặc điền tay ở trang storyboard.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  const existing = getStoryboard(id);
  if (
    existing &&
    (existing.progress.phase === 'queued' || existing.progress.phase === 'processing')
  ) {
    return NextResponse.json({ error: 'Storyboard đang xử lý' }, { status: 409 });
  }

  const state = createStoryboard({ jobId: id, sourceKind: 'pages', working: [], beats: [] });
  // Đánh dấu 'queued' đồng bộ trước fire-and-forget (mẫu run route Stage 1).
  updateStoryboardProgress(id, { phase: 'queued', currentIndex: null });
  buildAndCompose(id).catch((err) => {
    console.error('[storyboard] dựng storyboard thất bại:', err);
    updateStoryboardProgress(id, { phase: 'failed', currentIndex: null });
  });

  return NextResponse.json(toStoryboardDTO(state));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  return NextResponse.json(toStoryboardDTO(state));
}
