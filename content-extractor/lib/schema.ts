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
  // Ngữ cảnh chương (nhân vật/xưng hô/bối cảnh) — tiêm vào mọi call vision + prompt biên kịch.
  context: string;
}

// Tiến trình ingest phát dần qua NDJSON stream POST /api/jobs (pha-2 upload). Kiểu dùng CHUNG
// client+server → đặt ở schema (không import Buffer). done/total optional: bước gộp/dò band là
// thao tác đơn khối, không đếm được.
export type IngestStage = 'pdf' | 'downscale' | 'stitch' | 'detect' | 'extract';

export interface IngestProgress {
  stage: IngestStage;
  done?: number;
  total?: number;
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

// Ghi đè hiệu ứng camera per-nhịp/per-shot. `undefined` = 'auto' (planKenburns tự suy từ
// hình dáng region) — KHÔNG đặt default {mode:'auto'} để Beat/Shot/.mtvproj cũ tự khớp
// mà không cần migration.
export type MotionMode = 'auto' | 'pan-v' | 'pan-h' | 'zoom' | 'static';

export interface MotionOverride {
  mode: MotionMode;
  reverse?: boolean; // lia ↑ / lia ← / zoom-out — VÔ NGHĨA (no-op im lặng) với 'static' và 'auto'
}

// Một nhịp của storyboard: lời đọc + vùng hình. Hợp đồng cho Stage 2 (TTS + Ken Burns).
// Manifest region-only: hướng pan/zoom do Stage 2 tự suy từ region.
export interface Beat {
  id: string;
  order: number;
  sourceIndex: number; // trỏ working image (canvas stitch với strip / trang với pages)
  region: BeatRegion | null; // null = cả trang
  motion?: MotionOverride; // ghi đè hiệu ứng — undefined = auto
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
        ...(b.motion !== undefined ? { motion: { ...b.motion } } : {}),
        narration: b.narration,
        ...(b.sourceDialogue !== undefined ? { sourceDialogue: [...b.sourceDialogue] } : {}),
        ...(b.durationHint !== undefined ? { durationHint: b.durationHint } : {}),
        ...(b.error !== undefined ? { error: b.error } : {}),
      })),
  };
}

// ==== Stage 2: Kịch bản AI (script layer) ====

// Một shot của segment: trỏ working image theo index (không pixel-copy). region null = cả band.
// weight quyết định tỉ lệ thời lượng shot trong segment (chuẩn hoá khi dựng timeline).
export interface Shot {
  sourceIndex: number;
  region: BeatRegion | null;
  motion?: MotionOverride; // ghi đè hiệu ứng — undefined = auto (copy 1 chiều từ Beat lúc generate)
  weight: number;
}

// Một đoạn kể của kịch bản: 1 narration ↔ 1+ shot (gộp = nhiều shot; tách = nhiều segment
// cùng sourceIndex). Hợp đồng cho Preview UI (P4) + CLI render (P5/P6).
export interface ScriptSegment {
  id: string;
  order: number;
  narration: string;
  shots: Shot[];
  sourceBeatIds?: string[]; // truy vết beat gốc
  durationHint?: number; // giây — chỉ dùng cho preview im lặng; audio TTS là nhạc trưởng
  edited?: boolean; // người dùng đã duyệt/sửa
}

export interface ScriptManifest {
  version: number;
  jobId: string;
  createdAt: string;
  segmentCount: number;
  segments: ScriptSegment[];
}

export const SCRIPT_VERSION = 1;

export function toScriptManifest(s: {
  jobId: string;
  createdAt: string;
  segments: ScriptSegment[];
}): ScriptManifest {
  return {
    version: SCRIPT_VERSION,
    jobId: s.jobId,
    createdAt: s.createdAt,
    segmentCount: s.segments.length,
    segments: [...s.segments]
      .sort((a, b) => a.order - b.order)
      .map((seg) => ({
        id: seg.id,
        order: seg.order,
        narration: seg.narration,
        shots: seg.shots.map((sh) => ({
          sourceIndex: sh.sourceIndex,
          region: sh.region ? { ...sh.region } : null,
          ...(sh.motion !== undefined ? { motion: { ...sh.motion } } : {}),
          weight: sh.weight,
        })),
        ...(seg.sourceBeatIds !== undefined ? { sourceBeatIds: [...seg.sourceBeatIds] } : {}),
        durationHint: seg.durationHint ?? estimateSeconds(seg.narration),
        ...(seg.edited !== undefined ? { edited: seg.edited } : {}),
      })),
  };
}

// DTO kịch bản trả qua API — kèm cờ confirmed (khoá duyệt, mở đường "Dựng video").
export interface ScriptDTO {
  jobId: string;
  confirmed: boolean;
  segments: ScriptSegment[];
}

// ==== Stage 2: RenderConfig (tham số render — Preview UI ↔ CLI) ====

export type Aspect = '9:16' | '16:9' | '1:1';

export interface SubtitleStyle {
  export: boolean; // luôn xuất .srt rời
  burnIn: boolean; // cháy chữ vào video
  font: string;
  sizePct: number; // % chiều cao khung hình
  color: string; // hex #rrggbb
  outline: boolean;
  position: 'top' | 'middle' | 'bottom';
  marginPct: number; // % chiều cao khung tính từ mép theo position
}

export interface RenderConfig {
  version: number;
  aspect: Aspect;
  fps: number;
  subtitles: SubtitleStyle;
  // bgm.path: đường dẫn TRONG bundle (bgm/<file>) hoặc đường dẫn đĩa khi chạy CLI trực tiếp.
  bgm: { path: string | null; volume: number; duckDb: number };
  // provider: rỗng = lấy ENV TTS_PROVIDER lúc synth (mặc định elevenlabs); 'elevenlabs' | 'capcut'.
  tts: { provider: string; voiceId: string; model: string };
  kenburns: { zoom: number }; // hệ số zoom đích cho shot gần vuông (1 = tĩnh)
  segmentOverrides?: Record<string, { durationSec?: number }>;
}

export const RENDER_CONFIG_VERSION = 1;

export function defaultRenderConfig(): RenderConfig {
  return {
    version: RENDER_CONFIG_VERSION,
    aspect: '9:16',
    fps: 30,
    subtitles: {
      export: true,
      burnIn: true,
      font: 'Be Vietnam Pro',
      sizePct: 4.5,
      color: '#ffffff',
      outline: true,
      position: 'bottom',
      marginPct: 8,
    },
    bgm: { path: null, volume: 0.3, duckDb: -12 },
    tts: { provider: '', voiceId: '', model: '' }, // rỗng = lấy từ ENV (TTS_PROVIDER + ELEVENLABS_*) lúc synth
    kenburns: { zoom: 1.12 },
  };
}

// ==== File project .mtvproj (bản lưu cả phiên làm việc) ====
// Zip tự chứa: project.json (meta dưới đây) + manifest.json (Stage 1) + storyboard.json
// + script.json (tuỳ) + working/<sourceIndex>.jpg + items/band-<index>.jpg
// + audio/seg-<segId>.mp3 (tuỳ). Mở lại = hydrate store, KHÔNG re-ingest → không phụ
// thuộc env (MAX_EDGE/SPLIT_HEIGHT), toạ độ region khớp tuyệt đối.

export const PROJECT_VERSION = 1;

// Kích thước ảnh working — bytes nằm ở working/<sourceIndex>.jpg trong zip.
export interface ProjectWorkingMeta {
  sourceIndex: number;
  width: number;
  height: number;
}

// Metadata band Stage 1 — filename/content/error nằm ở manifest.json (song song theo index).
export interface ProjectItemMeta {
  index: number;
  mime: string;
  width: number;
  height: number;
}

// Audio TTS đã synth cho một segment: bytes ở audio/seg-<segId>.mp3. key = tên file trong
// cache đĩa (sha256 của text+voice+model) — import ghi lại đúng <TTS_CACHE_DIR>/<key>.mp3
// để preview/CLI tiếp tục HIT cache, không gọi lại ElevenLabs.
export interface ProjectAudioMeta {
  key: string;
  durationSec: number;
  text: string;
}

export interface ProjectFile {
  version: number;
  jobId: string;
  createdAt: string;
  sourceKind: SourceKind;
  working: ProjectWorkingMeta[];
  items: ProjectItemMeta[];
  scriptConfirmed?: boolean;
  audio?: Record<string, ProjectAudioMeta>; // segId → meta
  // Ngữ cảnh chương người dùng nhập — optional để .mtvproj cũ mở được không cần migration.
  context?: string;
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
