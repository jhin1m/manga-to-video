// Hợp đồng dữ liệu dùng chung cho toàn app (và các consumer tương lai: CLI/TTS/video).
// KHÔNG import kiểu Node (Buffer…) vào file này — kiểu nội bộ có Buffer nằm ở lib/jobs.ts.
import type { OutputLanguage } from './output-language';

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
  outputLanguage: OutputLanguage;
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

// TTS đọc ~15 ký tự/giây — đúng cho cả vi/en/id (đo giọng CapCut en/id: 14-17 ký tự/giây);
// đủ cho durationHint v1, Stage 2 tinh chỉnh sau.
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
  // Ngôn ngữ của lời kể — CLI render đọc để chọn giọng TTS đúng ngôn ngữ. Chỉ ghi khi khác
  // 'vi' (vắng mặt = 'vi'): bundle vi giữ nguyên shape cũ, không cần bump SCRIPT_VERSION.
  outputLanguage?: OutputLanguage;
}

export const SCRIPT_VERSION = 1;

export function toScriptManifest(s: {
  jobId: string;
  createdAt: string;
  segments: ScriptSegment[];
  outputLanguage?: OutputLanguage;
}): ScriptManifest {
  return {
    version: SCRIPT_VERSION,
    jobId: s.jobId,
    createdAt: s.createdAt,
    ...(s.outputLanguage && s.outputLanguage !== 'vi' ? { outputLanguage: s.outputLanguage } : {}),
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

// Kiểu viền/nền của chữ — map thẳng sang BorderStyle của ASS:
// 'outline' = BorderStyle 1 có viền · 'none' = BorderStyle 1 với Outline 0 · 'box' = BorderStyle 3.
export type SubtitleBorder = 'none' | 'outline' | 'box';

export interface SubtitleStyle {
  export: boolean; // luôn xuất .srt rời
  burnIn: boolean; // cháy chữ vào video
  font: string; // family name (khớp tên bên trong file font — libass match theo family)
  sizePct: number; // % chiều cao khung hình
  color: string; // hex #rrggbb
  opacity: number; // 0..1 — độ đục của chữ
  bold: boolean;
  italic: boolean;
  underline: boolean;
  uppercase: boolean; // biến đổi lúc sinh cue (không có field ASS tương ứng)
  letterSpacing: number; // giãn ký tự, đơn vị theo PlayResY 288
  border: SubtitleBorder;
  outlineWidth: number; // 0..4 — độ dày viền; ở mode 'box' là phần đệm quanh chữ
  // LƯU Ý (đã đo bằng libass): OutlineColour vừa là màu VIỀN (BorderStyle 1) vừa là màu HỘP
  // (BorderStyle 3). Vì vậy chỉ có MỘT cặp màu/độ mờ dùng cho cả hai mode.
  outlineColor: string;
  outlineOpacity: number; // 0..1
  shadowDepth: number; // 0..4 — độ lệch bóng
  shadowColor: string; // BackColour
  position: 'top' | 'middle' | 'bottom';
  marginPct: number; // % chiều cao khung tính từ mép theo position
  sideMarginPct: number; // % chiều RỘNG khung, áp cho cả lề trái lẫn phải
  maxCharsPerLine: number; // 0 = không ngắt dòng thủ công
}

// Cách lấp khung khi region lệch tỉ lệ: 'blur' = ảnh fit-inside trên nền blur · 'cover' = phóng
// lấp kín khung, cắt phần thừa ở hai mép.
export type FillMode = 'blur' | 'cover';
// Hiệu ứng mặc định cho shot KHÔNG có ghi đè: 'static' = đứng yên · 'auto' = pan/zoom tự suy.
export type DefaultMotion = 'static' | 'auto';

export interface RenderConfig {
  version: number;
  aspect: Aspect;
  fps: number;
  subtitles: SubtitleStyle;
  // bgm.path: đường dẫn TRONG bundle (bgm/<file>) hoặc đường dẫn đĩa khi chạy CLI trực tiếp.
  bgm: { path: string | null; volume: number; duckDb: number };
  // provider: rỗng = lấy ENV TTS_PROVIDER lúc synth (mặc định elevenlabs); 'elevenlabs' | 'capcut'.
  tts: { provider: string; voiceId: string; model: string };
  // zoom: hệ số zoom đích cho shot gần vuông (1 = tĩnh). motion: hiệu ứng cho shot không có
  // ghi đè per-beat. fill: undefined = theo aspect (defaultFill trong lib/kenburns.ts).
  kenburns: { zoom: number; motion: DefaultMotion; fill?: FillMode };
  segmentOverrides?: Record<string, { durationSec?: number }>;
}

// v2: SubtitleStyle mở rộng (viền/bóng/nền hộp/kiểu chữ/lề ngang/wrap). Config v1 vẫn đọc
// được — migrateSubtitleStyle trong lib/subtitle-style.ts quy đổi `outline: boolean` sang
// `border` + `outlineWidth`.
export const RENDER_CONFIG_VERSION = 2;

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
      opacity: 1,
      bold: false,
      italic: false,
      underline: false,
      uppercase: false,
      letterSpacing: 0,
      border: 'outline',
      outlineWidth: 2,
      outlineColor: '#000000',
      outlineOpacity: 1,
      shadowDepth: 0,
      shadowColor: '#000000',
      position: 'bottom',
      marginPct: 8,
      sideMarginPct: 6,
      maxCharsPerLine: 0,
    },
    bgm: { path: null, volume: 0.3, duckDb: -12 },
    tts: { provider: '', voiceId: '', model: '' }, // rỗng = lấy từ ENV (TTS_PROVIDER + ELEVENLABS_*) lúc synth
    kenburns: { zoom: 1.12, motion: 'static' },
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
  // Ngôn ngữ đầu ra — optional cùng lý do; vắng mặt = 'vi'. Chỉ ghi khi khác 'vi'.
  outputLanguage?: OutputLanguage;
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
