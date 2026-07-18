import { EventEmitter } from 'node:events';
import type { ItemDTO, ItemStatus, JobProgress, JobStatusDTO, SceneContent } from './schema';

// Kiểu nội bộ (có Buffer) — tách khỏi schema.ts để schema không phụ thuộc Node.
// Item là MỘT band cắt từ canvas gộp lúc ingest; kích thước biết sẵn từ vùng cắt
// nên lưu luôn — storyboard khỏi decode lại buffer chỉ để đọc metadata.
export interface StoredItem {
  index: number;
  filename: string;
  buffer: Buffer; // JPEG đã downscale từ lúc ingest — dùng chung cho vision, thumbnail, retry
  mime: string;
  width: number;
  height: number;
  content: SceneContent | null;
  error?: string;
  status: ItemStatus;
}

export interface Job {
  id: string;
  createdAt: string;
  items: StoredItem[];
  progress: JobProgress;
  // Ngữ cảnh chương người dùng nhập (nhân vật/xưng hô/bối cảnh) — nguồn duy nhất cho mọi
  // đường gọi vision (batch, retry, generate beat, script fallback) + prompt biên kịch.
  context: string;
}

// Singleton trên globalThis — sống sót qua HMR của dev server.
const g = globalThis as unknown as {
  __mrs_jobs?: Map<string, Job>;
  __mrs_bus?: EventEmitter;
};
const store: Map<string, Job> = (g.__mrs_jobs ??= new Map());
const bus: EventEmitter = (g.__mrs_bus ??= (() => {
  const b = new EventEmitter();
  b.setMaxListeners(0);
  return b;
})());

export function createJob(
  items: Array<{ filename: string; buffer: Buffer; mime: string; width: number; height: number }>,
  context = '',
): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    context,
    items: items.map((it, index) => ({
      index,
      filename: it.filename,
      buffer: it.buffer,
      mime: it.mime,
      width: it.width,
      height: it.height,
      content: null,
      status: 'pending',
    })),
    progress: { done: 0, total: items.length, currentIndex: null, phase: 'ready' },
  };
  store.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.get(id);
}

export function setJobContext(id: string, context: string): void {
  const job = store.get(id);
  if (!job) return;
  job.context = context;
}

export function updateProgress(id: string, patch: Partial<JobProgress>): void {
  const job = store.get(id);
  if (!job) return;
  job.progress = { ...job.progress, ...patch };
  bus.emit(`p:${id}`, job.progress);
}

// done = số item đã xử lý xong một lượt (thành công HOẶC lỗi) — suy ra từ trạng thái item
// thay vì đếm cộng dồn, để retry/PATCH tự khớp lại.
function recomputeDone(job: Job): number {
  return job.items.filter((it) => it.status !== 'pending').length;
}

export function setItemResult(id: string, index: number, content: SceneContent): void {
  const job = store.get(id);
  const item = job?.items[index];
  if (!job || !item) return;
  item.content = content;
  item.status = 'done';
  delete item.error;
  updateProgress(id, { done: recomputeDone(job) });
}

export function setItemError(id: string, index: number, message: string): void {
  const job = store.get(id);
  const item = job?.items[index];
  if (!job || !item) return;
  item.error = message;
  item.status = 'error';
  updateProgress(id, { done: recomputeDone(job) });
}

// Hard-delete 1 band khỏi job: splice + gán lại .index cho phần còn lại (route enforce
// chỉ gọi khi phase không đang chạy). index ngoài biên → no-op, trả job nguyên (không throw)
// để route tự quyết 404; jobId lạ → undefined.
export function deleteItem(id: string, index: number): Job | undefined {
  const job = store.get(id);
  if (!job) return undefined;
  if (!Number.isInteger(index) || index < 0 || index >= job.items.length) return job;
  job.items.splice(index, 1);
  job.items.forEach((it, i) => {
    it.index = i;
  });
  updateProgress(id, { total: job.items.length, done: recomputeDone(job), currentIndex: null });
  return job;
}

export function subscribe(id: string, cb: (p: JobProgress) => void): () => void {
  const event = `p:${id}`;
  bus.on(event, cb);
  return () => bus.off(event, cb);
}

export function toItemDTO(jobId: string, item: StoredItem): ItemDTO {
  return {
    index: item.index,
    filename: item.filename,
    // ?v=filename định danh band vào URL: sau khi deleteItem re-index, đường dẫn theo vị trí
    // /items/{index}/image bị TÁI DÙNG cho band khác — trình duyệt giữ ảnh đã decode của URL cũ
    // và hiện lại (dù server trả bytes mới, dù Cache-Control: no-store), gây ảnh trùng/kẹt. Gắn
    // filename (duy nhất & ổn định mỗi band) khiến mỗi band có URL riêng, không bao giờ đụng ảnh cũ.
    imageUrl: `/api/jobs/${jobId}/items/${item.index}/image?v=${encodeURIComponent(item.filename)}`,
    content: item.content,
    ...(item.error !== undefined ? { error: item.error } : {}),
  };
}

export function toJobStatusDTO(job: Job): JobStatusDTO {
  return {
    jobId: job.id,
    progress: job.progress,
    items: job.items.map((it) => toItemDTO(job.id, it)),
    context: job.context,
  };
}
