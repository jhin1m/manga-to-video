import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getJob } from '@/lib/jobs';
import { composeStoryboard, skeletonBeats } from '@/lib/narration';
import { classifySource } from '@/lib/source-kind';
import { detectBands } from '@/lib/smart-split';
import { stitchSlices } from '@/lib/stitch';
import {
  createStoryboard,
  getStoryboard,
  setBeats,
  setWorking,
  toStoryboardDTO,
  updateStoryboardProgress,
  type WorkingImage,
} from '@/lib/storyboard-store';
import { readVisionConfig } from '@/lib/vision';
import type { SourceKind } from '@/lib/schema';

export const runtime = 'nodejs';

const MAX_RPM = 600; // trần an toàn — như route run Stage 1

function resolveRpm(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.round(raw), MAX_RPM);
}

async function readDims(buffers: Buffer[]): Promise<Array<{ width: number; height: number }>> {
  return Promise.all(
    buffers.map(async (buf, i) => {
      const m = await sharp(buf, { limitInputPixels: false }).metadata();
      if (!m.width || !m.height) throw new Error(`Không đọc được kích thước ảnh thứ ${i + 1}`);
      return { width: m.width, height: m.height };
    }),
  );
}

// Chạy nền: dựng working image (stitch với strip) + khung nhịp, rồi compose narration.
// POST trả về ngay ở phase 'queued'; tiến độ theo dõi qua SSE/poll.
async function buildAndCompose(
  jobId: string,
  kind: SourceKind,
  opts: { concurrency: number; minIntervalMs: number },
): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  if (kind === 'strip') {
    const canvas = await stitchSlices(job.items.map((it) => it.buffer));
    const bands = await detectBands(canvas.buffer);
    setWorking(jobId, [
      { sourceIndex: 0, buffer: canvas.buffer, width: canvas.width, height: canvas.height },
    ]);
    setBeats(jobId, skeletonBeats('strip', [{ sourceIndex: 0, bands }]));
  } else {
    const dims = await readDims(job.items.map((it) => it.buffer));
    const working: WorkingImage[] = job.items.map((it, i) => ({
      sourceIndex: i,
      buffer: it.buffer,
      width: dims[i].width,
      height: dims[i].height,
      content: it.content,
    }));
    setWorking(jobId, working);
    setBeats(
      jobId,
      skeletonBeats('pages', working.map((w) => ({ sourceIndex: w.sourceIndex, bands: [] }))),
    );
  }
  await composeStoryboard(jobId, opts);
}

// Tạo storyboard từ job session: phân loại nguồn (override được) → stitch/banding + compose nền.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // Body tùy chọn { sourceKind?: 'pages'|'strip', rpm?: number }.
  let kindOverride: SourceKind | undefined;
  let rpmRaw: unknown;
  try {
    const body: unknown = await req.json();
    if (body && typeof body === 'object') {
      const b = body as { sourceKind?: unknown; rpm?: unknown };
      if (b.sourceKind === 'pages' || b.sourceKind === 'strip') kindOverride = b.sourceKind;
      rpmRaw = b.rpm;
    }
  } catch {
    // Không có body → auto toàn bộ.
  }

  let kind: SourceKind;
  try {
    kind = kindOverride ?? classifySource(await readDims(job.items.map((it) => it.buffer)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không phân loại được nguồn';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Strip cần vision (2A re-extract theo band) → đòi config ngay để fail sớm.
  // Pages là template thuần — không cần API key.
  let concurrency = 4;
  let minIntervalMs = 0;
  if (kind === 'strip') {
    try {
      const config = readVisionConfig();
      concurrency = config.concurrency;
      const rpm = resolveRpm(rpmRaw, config.rpm);
      minIntervalMs = rpm > 0 ? Math.ceil(60000 / rpm) : 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cấu hình vision không hợp lệ';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Re-check SAU các await (đọc body, readDims): hai POST sát nhau đều lọt check đầu —
  // khối dưới đây chạy đồng bộ nên chỉ một request giành được quyền tạo.
  const recheck = getStoryboard(id);
  if (recheck && (recheck.progress.phase === 'queued' || recheck.progress.phase === 'processing')) {
    return NextResponse.json({ error: 'Storyboard đang xử lý' }, { status: 409 });
  }
  const state = createStoryboard({ jobId: id, sourceKind: kind, working: [], beats: [] });
  // Đánh dấu 'queued' đồng bộ trước fire-and-forget (mẫu run route Stage 1).
  updateStoryboardProgress(id, { phase: 'queued', currentIndex: null });
  buildAndCompose(id, kind, { concurrency, minIntervalMs }).catch((err) => {
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
