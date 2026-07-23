// Khóa 1-render/job: chỉ một render được chạy cho mỗi jobId tại một thời điểm (đổi aspect
// phải đợi). Map<jobId, AbortController> trên globalThis — sống sót qua HMR dev server
// (mẫu lib/jobs.ts / storyboard-store.ts). AbortController lưu kèm để hủy render đang chạy
// (stream cancel → route gọi ac.abort() → kill ffmpeg).

const g = globalThis as unknown as { __mrs_render_locks?: Map<string, AbortController> };
const locks: Map<string, AbortController> = (g.__mrs_render_locks ??= new Map());

export function isRendering(jobId: string): boolean {
  return locks.has(jobId);
}

export function markRendering(jobId: string, ac: AbortController): void {
  locks.set(jobId, ac);
}

export function clearRendering(jobId: string): void {
  locks.delete(jobId);
}

// Hủy render đang chạy của job (nếu có) — no-op khi không có.
export function abortRendering(jobId: string): void {
  locks.get(jobId)?.abort();
}
