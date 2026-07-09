import { EventEmitter } from 'node:events';
import type {
  Beat,
  BeatDTO,
  ItemStatus,
  JobProgress,
  SceneContent,
  ScriptDTO,
  ScriptSegment,
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

// Audio TTS đã synth cho một segment (Stage 2): path file trong cache đĩa + độ dài đo được.
// text = narration tại thời điểm synth — export-bundle so với narration hiện tại để loại
// audio cũ (người dùng sửa narration sau khi synth).
export interface SegmentAudio {
  mp3Path: string;
  durationSec: number;
  text: string;
}

export interface StoryboardState {
  jobId: string;
  createdAt: string;
  sourceKind: SourceKind;
  working: WorkingImage[];
  beats: StoredBeat[];
  progress: JobProgress; // tiến độ compose (2A) — tái dùng shape Stage 1
  // ==== Stage 2: kịch bản AI ====
  script?: ScriptSegment[];
  scriptConfirmed?: boolean; // người duyệt chốt — mở đường "Dựng video"
  scriptGenerating?: boolean; // đang gọi model biên kịch — route trả 409 khi trùng
  ttsAudio?: Map<string, SegmentAudio>; // segId → audio đã synth (preview "có audio")
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

// ==== Stage 2: mutators kịch bản (script) ====
// Mọi mutator dưới đây thao tác trên state.script (in-memory, mẫu beats). Sửa bất kỳ
// segment nào → scriptConfirmed reset (bản duyệt cũ hết hiệu lực).

function requireScript(jobId: string): { state: StoryboardState; script: ScriptSegment[] } {
  const state = store.get(jobId);
  if (!state || !state.script) throw new Error('Chưa có kịch bản cho job này');
  return { state, script: state.script };
}

function resequence(script: ScriptSegment[]): void {
  script.forEach((seg, i) => {
    seg.order = i;
  });
}

// Thay toàn bộ kịch bản (sau khi generate) — reset cờ duyệt + audio đã synth cho bản cũ.
export function setScript(jobId: string, segments: ScriptSegment[]): void {
  const state = store.get(jobId);
  if (!state) return;
  state.script = [...segments].sort((a, b) => a.order - b.order);
  resequence(state.script);
  state.scriptConfirmed = false;
  state.ttsAudio = undefined;
}

export function getScript(jobId: string): ScriptSegment[] | undefined {
  return store.get(jobId)?.script;
}

export function getSegment(jobId: string, segId: string): ScriptSegment | undefined {
  return store.get(jobId)?.script?.find((s) => s.id === segId);
}

export function setScriptGenerating(jobId: string, on: boolean): void {
  const state = store.get(jobId);
  if (state) state.scriptGenerating = on;
}

export function setScriptConfirmed(jobId: string, confirmed: boolean): void {
  const state = store.get(jobId);
  if (state) state.scriptConfirmed = confirmed;
}

// Sửa tay narration → edited=true, durationHint tính lại, bản duyệt cũ hết hiệu lực.
export function updateSegment(
  jobId: string,
  segId: string,
  patch: { narration?: string },
): ScriptSegment {
  const { state, script } = requireScript(jobId);
  const seg = script.find((s) => s.id === segId);
  if (!seg) throw new Error('Không tìm thấy đoạn kịch bản');
  if (patch.narration !== undefined) {
    seg.narration = patch.narration;
    seg.durationHint = estimateSeconds(patch.narration);
    seg.edited = true;
  }
  state.scriptConfirmed = false;
  return seg;
}

// Xoá 1 đoạn + re-sequence order (mẫu deleteBeat). segId lạ → throw (route trả 404 trước).
export function deleteSegment(jobId: string, segId: string): ScriptSegment[] {
  const { state, script } = requireScript(jobId);
  const idx = script.findIndex((s) => s.id === segId);
  if (idx === -1) throw new Error('Không tìm thấy đoạn kịch bản');
  script.splice(idx, 1);
  resequence(script);
  state.scriptConfirmed = false;
  return script;
}

// Gộp 2 đoạn LIỀN KỀ: shots nối theo thứ tự, narration nối bằng khoảng trắng (người sửa lại).
export function mergeSegments(jobId: string, segIdA: string, segIdB: string): ScriptSegment[] {
  const { state, script } = requireScript(jobId);
  const ia = script.findIndex((s) => s.id === segIdA);
  const ib = script.findIndex((s) => s.id === segIdB);
  if (ia === -1 || ib === -1) throw new Error('Không tìm thấy đoạn kịch bản');
  if (Math.abs(ia - ib) !== 1) throw new Error('Chỉ gộp được hai đoạn liền kề');
  const [first, second] = ia < ib ? [script[ia], script[ib]] : [script[ib], script[ia]];
  first.narration = [first.narration, second.narration].filter(Boolean).join(' ');
  first.shots = [...first.shots, ...second.shots];
  if (first.sourceBeatIds || second.sourceBeatIds) {
    first.sourceBeatIds = [...(first.sourceBeatIds ?? []), ...(second.sourceBeatIds ?? [])];
  }
  first.durationHint = estimateSeconds(first.narration);
  first.edited = true;
  script.splice(script.indexOf(second), 1);
  resequence(script);
  state.scriptConfirmed = false;
  return script;
}

// Tách 1 đoạn tại biên shot: shots[0..at) giữ ở đoạn đầu (kèm narration), shots[at..] sang
// đoạn mới narration rỗng (người điền). Đoạn 1 shot không tách được.
export function splitSegment(jobId: string, segId: string, atShotIndex: number): ScriptSegment[] {
  const { state, script } = requireScript(jobId);
  const idx = script.findIndex((s) => s.id === segId);
  if (idx === -1) throw new Error('Không tìm thấy đoạn kịch bản');
  const seg = script[idx];
  if (!Number.isInteger(atShotIndex) || atShotIndex < 1 || atShotIndex >= seg.shots.length) {
    throw new Error('Vị trí tách phải nằm giữa hai shot của đoạn');
  }
  const movedShots = seg.shots.splice(atShotIndex);
  // sourceBeatIds chỉ tách kèm khi còn song song 1:1 với shots (sau merge lệch thì thôi —
  // metadata truy vết, không load-bearing).
  const beatIdsAligned =
    seg.sourceBeatIds !== undefined &&
    seg.sourceBeatIds.length === seg.shots.length + movedShots.length;
  const movedBeatIds = beatIdsAligned ? seg.sourceBeatIds!.splice(atShotIndex) : undefined;
  seg.edited = true;
  const next: ScriptSegment = {
    id: crypto.randomUUID(),
    order: seg.order + 1,
    narration: '',
    shots: movedShots,
    ...(movedBeatIds !== undefined ? { sourceBeatIds: movedBeatIds } : {}),
    durationHint: 0,
    edited: true,
  };
  script.splice(idx + 1, 0, next);
  resequence(script);
  state.scriptConfirmed = false;
  return script;
}

// Di chuyển đoạn tới vị trí order mới (clamp, mẫu reorderBeat).
export function reorderSegment(jobId: string, segId: string, to: number): ScriptSegment[] {
  const { state, script } = requireScript(jobId);
  const idx = script.findIndex((s) => s.id === segId);
  if (idx === -1) throw new Error('Không tìm thấy đoạn kịch bản');
  const target = Math.max(0, Math.min(Math.trunc(to), script.length - 1));
  const [seg] = script.splice(idx, 1);
  script.splice(target, 0, seg);
  resequence(script);
  state.scriptConfirmed = false;
  return script;
}

export function setSegmentAudio(jobId: string, segId: string, audio: SegmentAudio): void {
  const state = store.get(jobId);
  if (!state) return;
  (state.ttsAudio ??= new Map()).set(segId, audio);
}

export function getSegmentAudio(jobId: string, segId: string): SegmentAudio | undefined {
  return store.get(jobId)?.ttsAudio?.get(segId);
}

export function toScriptDTO(state: StoryboardState): ScriptDTO {
  return {
    jobId: state.jobId,
    confirmed: state.scriptConfirmed === true,
    segments: (state.script ?? []).map((seg) => ({
      ...seg,
      shots: seg.shots.map((sh) => ({ ...sh, region: sh.region ? { ...sh.region } : null })),
      ...(seg.sourceBeatIds !== undefined ? { sourceBeatIds: [...seg.sourceBeatIds] } : {}),
    })),
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
