import { EventEmitter } from 'node:events';
import type {
  Beat,
  BeatDTO,
  ItemStatus,
  JobProgress,
  SceneContent,
  SourceKind,
  StoryboardDTO,
} from './schema';
import { estimateSeconds } from './schema';

// Store in-memory cho storyboard (Stage 1.5) — tách khỏi lib/jobs.ts để không phình
// vòng đời Job. Storyboard treo trên cùng jobId với Job (cùng session) hoặc đứng độc lập
// khi nạp lại từ manifest (job mới do import tạo).

// Ảnh làm việc của storyboard: strip = canvas đã stitch, pages = từng trang.
// Cùng session: buffer THAM CHIẾU StoredItem.buffer của Job (không copy).
// Nạp lại từ manifest: buffer riêng do import cấp.
export interface WorkingImage {
  sourceIndex: number;
  buffer: Buffer;
  width: number;
  height: number;
  // Nội dung Stage 1 của trang (nhánh pages) — nguồn cho narration template + retry.
  // Strip: canvas không có content (2A re-extract theo band).
  content?: SceneContent | null;
}

// Kiểu nội bộ store — status phục vụ tiến độ compose + retry, KHÔNG xuất ra manifest.
// rev tăng mỗi lần người dùng sửa beat: compose/Generate đang bay (await vision) so rev
// trước-sau để KHÔNG ghi đè bản sửa tay (bản tay luôn thắng).
export interface StoredBeat extends Beat {
  status: ItemStatus;
  rev: number;
}

export interface StoryboardState {
  jobId: string;
  createdAt: string;
  sourceKind: SourceKind;
  working: WorkingImage[];
  beats: StoredBeat[];
  progress: JobProgress; // tiến độ compose (2A) — tái dùng shape Stage 1
}

// Singleton trên globalThis — sống sót qua HMR của dev server (mẫu lib/jobs.ts).
const g = globalThis as unknown as {
  __mrs_storyboards?: Map<string, StoryboardState>;
  __mrs_sb_bus?: EventEmitter;
};
const store: Map<string, StoryboardState> = (g.__mrs_storyboards ??= new Map());
const bus: EventEmitter = (g.__mrs_sb_bus ??= (() => {
  const b = new EventEmitter();
  b.setMaxListeners(0);
  return b;
})());

export function createStoryboard(args: {
  jobId: string;
  sourceKind: SourceKind;
  working: WorkingImage[];
  beats?: StoredBeat[];
}): StoryboardState {
  const beats = args.beats ?? [];
  const state: StoryboardState = {
    jobId: args.jobId,
    createdAt: new Date().toISOString(),
    sourceKind: args.sourceKind,
    working: args.working,
    beats,
    progress: { done: 0, total: beats.length, currentIndex: null, phase: 'ready' },
  };
  store.set(args.jobId, state);
  return state;
}

export function getStoryboard(jobId: string): StoryboardState | undefined {
  return store.get(jobId);
}

export function deleteStoryboard(jobId: string): void {
  store.delete(jobId);
}

export function getWorkingImage(jobId: string, sourceIndex: number): WorkingImage | undefined {
  return store.get(jobId)?.working.find((w) => w.sourceIndex === sourceIndex);
}

export function updateStoryboardProgress(jobId: string, patch: Partial<JobProgress>): void {
  const state = store.get(jobId);
  if (!state) return;
  state.progress = { ...state.progress, ...patch };
  bus.emit(`sb:${jobId}`, state.progress);
}

// done = số beat đã compose xong một lượt (thành công HOẶC lỗi) — suy từ status
// thay vì đếm cộng dồn, để retry/PATCH tự khớp lại (mẫu Stage 1).
function recomputeDone(state: StoryboardState): number {
  return state.beats.filter((b) => b.status !== 'pending').length;
}

// Thay toàn bộ beats (sau bước banding tạo khung nhịp) — reset tiến độ theo danh sách mới.
export function setBeats(jobId: string, beats: StoredBeat[]): void {
  const state = store.get(jobId);
  if (!state) return;
  state.beats = beats;
  updateStoryboardProgress(jobId, {
    done: recomputeDone(state),
    total: beats.length,
    currentIndex: null,
  });
}

export function getBeat(jobId: string, beatId: string): StoredBeat | undefined {
  return store.get(jobId)?.beats.find((b) => b.id === beatId);
}

// Sửa tay từ UI: narration/region/order. Narration đổi → durationHint tính lại,
// xoá cờ lỗi (người đã tự điền nội dung là chốt).
export function updateBeat(
  jobId: string,
  beatId: string,
  patch: Partial<Pick<Beat, 'narration' | 'region' | 'order'>>,
): StoredBeat | undefined {
  const state = store.get(jobId);
  const beat = state?.beats.find((b) => b.id === beatId);
  if (!state || !beat) return undefined;
  beat.rev += 1; // vô hiệu compose đang bay trên nội dung/vùng cũ
  if (patch.region !== undefined) beat.region = patch.region;
  if (patch.order !== undefined) beat.order = patch.order;
  if (patch.narration !== undefined) {
    beat.narration = patch.narration;
    beat.durationHint = estimateSeconds(patch.narration);
    delete beat.error;
    beat.status = 'done';
    updateStoryboardProgress(jobId, { done: recomputeDone(state) });
  }
  return beat;
}

// Hard-delete 1 nhịp: splice theo id + gán lại order 0..n-1 (route enforce chỉ gọi khi
// phase không đang chạy). Working image để orphan (KISS, không GC). beatId lạ → no-op,
// trả state nguyên; jobId lạ → undefined.
export function deleteBeat(jobId: string, beatId: string): StoryboardState | undefined {
  const state = store.get(jobId);
  if (!state) return undefined;
  const idx = state.beats.findIndex((b) => b.id === beatId);
  if (idx === -1) return state;
  state.beats.splice(idx, 1);
  state.beats.forEach((b, i) => {
    b.order = i;
  });
  updateStoryboardProgress(jobId, {
    total: state.beats.length,
    done: recomputeDone(state),
    currentIndex: null,
  });
  return state;
}

// Kết quả compose (Phase 3) cho một beat.
export function setBeatResult(
  jobId: string,
  beatId: string,
  result: { narration: string; sourceDialogue?: string[] },
): void {
  const state = store.get(jobId);
  const beat = state?.beats.find((b) => b.id === beatId);
  if (!state || !beat) return;
  beat.narration = result.narration;
  if (result.sourceDialogue !== undefined) beat.sourceDialogue = result.sourceDialogue;
  beat.durationHint = estimateSeconds(result.narration);
  beat.status = 'done';
  delete beat.error;
  updateStoryboardProgress(jobId, { done: recomputeDone(state) });
}

export function setBeatError(jobId: string, beatId: string, message: string): void {
  const state = store.get(jobId);
  const beat = state?.beats.find((b) => b.id === beatId);
  if (!state || !beat) return;
  beat.error = message;
  beat.status = 'error';
  updateStoryboardProgress(jobId, { done: recomputeDone(state) });
}

// Cấp working images sau bước ingest/stitch chạy nền (POST tạo storyboard trả về trước
// khi canvas dựng xong).
export function setWorking(jobId: string, working: WorkingImage[]): void {
  const state = store.get(jobId);
  if (!state) return;
  state.working = working;
}

function requireBeatIndex(state: StoryboardState, beatId: string): number {
  const idx = state.beats.findIndex((b) => b.id === beatId);
  if (idx === -1) throw new Error('Không tìm thấy nhịp trong storyboard');
  return idx;
}

// Di chuyển beat tới vị trí order mới (clamp vào [0, n-1]), giữ dãy liền mạch.
export function reorderBeat(jobId: string, beatId: string, to: number): StoryboardState {
  const state = store.get(jobId);
  if (!state) throw new Error('Không tìm thấy storyboard');
  const idx = requireBeatIndex(state, beatId);
  const target = Math.max(0, Math.min(Math.trunc(to), state.beats.length - 1));
  const [beat] = state.beats.splice(idx, 1);
  state.beats.splice(target, 0, beat);
  state.beats.forEach((b, i) => {
    b.order = i;
  });
  updateStoryboardProgress(jobId, {}); // emit cho SSE/poll biết có thay đổi
  return state;
}

export function subscribeStoryboard(jobId: string, cb: (p: JobProgress) => void): () => void {
  const event = `sb:${jobId}`;
  bus.on(event, cb);
  return () => bus.off(event, cb);
}

// Beat DTO (không status nội bộ) — dùng cho manifest/API.
export function toBeat(sb: StoredBeat): Beat {
  return {
    id: sb.id,
    order: sb.order,
    sourceIndex: sb.sourceIndex,
    region: sb.region,
    narration: sb.narration,
    ...(sb.sourceDialogue !== undefined ? { sourceDialogue: sb.sourceDialogue } : {}),
    ...(sb.durationHint !== undefined ? { durationHint: sb.durationHint } : {}),
    ...(sb.error !== undefined ? { error: sb.error } : {}),
  };
}

export function toBeatDTO(jobId: string, sb: StoredBeat): BeatDTO {
  return {
    ...toBeat(sb),
    cropUrl: `/api/jobs/${jobId}/storyboard/beats/${sb.id}/crop`,
  };
}

export function toStoryboardDTO(state: StoryboardState): StoryboardDTO {
  return {
    jobId: state.jobId,
    createdAt: state.createdAt,
    sourceKind: state.sourceKind,
    progress: state.progress,
    working: state.working.map((w) => ({
      sourceIndex: w.sourceIndex,
      width: w.width,
      height: w.height,
      imageUrl: `/api/jobs/${state.jobId}/storyboard/working/${w.sourceIndex}/image`,
    })),
    beats: state.beats.map((b) => toBeatDTO(state.jobId, b)),
  };
}
