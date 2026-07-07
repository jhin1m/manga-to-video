// Hợp đồng dữ liệu dùng chung cho toàn app (và các consumer tương lai: CLI/TTS/video).
// KHÔNG import kiểu Node (Buffer…) vào file này — kiểu nội bộ có Buffer nằm ở lib/jobs.ts.

export interface SceneContent {
  description: string;
  dialogue: string[];
  note: string;
}

export type ItemStatus = 'pending' | 'done' | 'error';
// 'ready' = đã upload + downscale xong, đang xem trước, CHƯA gọi vision (chờ bấm Chạy).
export type JobPhase = 'ready' | 'queued' | 'processing' | 'done' | 'failed';

// DTO trả về qua API — không chứa buffer.
export interface ItemDTO {
  index: number;
  filename: string;
  imageUrl: string;
  content: SceneContent | null;
  error?: string;
}

export interface JobProgress {
  done: number;
  total: number;
  currentIndex: number | null;
  phase: JobPhase;
}

export interface JobStatusDTO {
  jobId: string;
  progress: JobProgress;
  items: ItemDTO[];
}

export interface ManifestItem {
  index: number;
  filename: string;
  content: SceneContent | null;
  error?: string;
}

export interface Manifest {
  version: number;
  jobId: string;
  createdAt: string;
  itemCount: number;
  items: ManifestItem[];
}

export const MANIFEST_VERSION = 1;

export function emptyContent(): SceneContent {
  return { description: '', dialogue: [], note: '' };
}

// ==== Stage 1.5: Storyboard ====

// Bbox pixel trên "working image" (strip = canvas đã stitch, pages = trang gốc).
export interface BeatRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SourceKind = 'pages' | 'strip';

// Một nhịp của storyboard: lời đọc + vùng hình. Hợp đồng cho Stage 2 (TTS + Ken Burns).
// Manifest region-only: hướng pan/zoom do Stage 2 tự suy từ region.
export interface Beat {
  id: string;
  order: number;
  sourceIndex: number; // trỏ working image (canvas stitch với strip / trang với pages)
  region: BeatRegion | null; // null = cả trang
  narration: string; // lời đọc cuối — template pre-fill, người biên tập sửa tay
  sourceDialogue?: string[]; // truy vết thoại gốc đã ghép vào narration
  durationHint?: number; // giây, ước lượng từ độ dài narration
  error?: string;
}

export interface StoryboardManifest {
  version: number;
  jobId: string;
  createdAt: string;
  sourceKind: SourceKind;
  beatCount: number;
  beats: Beat[];
}

export const STORYBOARD_VERSION = 1;

// DTO storyboard trả qua API — không chứa buffer (mẫu ItemDTO/JobStatusDTO).
export interface BeatDTO extends Beat {
  cropUrl: string;
}

export interface StoryboardWorkingDTO {
  sourceIndex: number;
  width: number;
  height: number;
  imageUrl: string;
}

export interface StoryboardDTO {
  jobId: string;
  createdAt: string;
  sourceKind: SourceKind;
  progress: JobProgress;
  working: StoryboardWorkingDTO[];
  beats: BeatDTO[];
}

// TTS tiếng Việt đọc ~15 ký tự/giây — đủ cho durationHint v1, Stage 2 tinh chỉnh sau.
export function estimateSeconds(narration: string): number {
  const chars = narration.trim().length;
  return chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 15));
}

export function emptyBeat(init: {
  order: number;
  sourceIndex: number;
  region?: BeatRegion | null;
}): Beat {
  return {
    id: crypto.randomUUID(),
    order: init.order,
    sourceIndex: init.sourceIndex,
    region: init.region ?? null,
    narration: '',
  };
}

export function toStoryboardManifest(s: {
  jobId: string;
  createdAt: string;
  sourceKind: SourceKind;
  beats: Beat[];
}): StoryboardManifest {
  return {
    version: STORYBOARD_VERSION,
    jobId: s.jobId,
    createdAt: s.createdAt,
    sourceKind: s.sourceKind,
    beatCount: s.beats.length,
    beats: [...s.beats]
      .sort((a, b) => a.order - b.order)
      .map((b) => ({
        id: b.id,
        order: b.order,
        sourceIndex: b.sourceIndex,
        region: b.region ? { ...b.region } : null,
        narration: b.narration,
        ...(b.sourceDialogue !== undefined ? { sourceDialogue: [...b.sourceDialogue] } : {}),
        ...(b.durationHint !== undefined ? { durationHint: b.durationHint } : {}),
        ...(b.error !== undefined ? { error: b.error } : {}),
      })),
  };
}

// Nhận shape cấu trúc tối thiểu (Job nội bộ thỏa mãn về mặt structural typing)
// để schema.ts không phụ thuộc kiểu Node.
export function toManifest(job: {
  id: string;
  createdAt: string;
  items: Array<{ index: number; filename: string; content: SceneContent | null; error?: string }>;
}): Manifest {
  return {
    version: MANIFEST_VERSION,
    jobId: job.id,
    createdAt: job.createdAt,
    itemCount: job.items.length,
    items: job.items.map((it) => ({
      index: it.index,
      filename: it.filename,
      content: it.content,
      ...(it.error !== undefined ? { error: it.error } : {}),
    })),
  };
}
