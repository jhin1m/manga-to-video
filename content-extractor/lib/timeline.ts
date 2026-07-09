import type { BeatRegion, RenderConfig, ScriptSegment } from './schema';
import { estimateSeconds } from './schema';

// Timeline thuần (không import Node) — dùng chung cho CLI render (P5/P6) và Preview UI (P4).
// Bất biến sync: audio TTS là nhạc trưởng — narration khớp cứng với SEGMENT; audio segment
// phân bổ cho các shot của nó theo weight → timeline.json ≡ timeline video.

export interface TimelineShot {
  sourceIndex: number;
  region: BeatRegion | null;
  start: number;
  end: number;
}

export interface TimelineSegment {
  segId: string;
  start: number;
  end: number;
  shots: TimelineShot[];
}

export interface Timeline {
  segments: TimelineSegment[];
  totalSec: number;
}

export interface TimelineOpts {
  padHeadSec?: number; // đệm trước narration
  padTailSec?: number; // đệm sau narration (thở giữa hai đoạn)
  floorSec?: number; // sàn thời lượng segment (narration rỗng/quá ngắn)
  shotFloorSec?: number; // sàn thời lượng một shot
}

export const TIMELINE_DEFAULTS: Required<TimelineOpts> = {
  padHeadSec: 0.15,
  padTailSec: 0.35,
  floorSec: 2,
  shotFloorSec: 0.8,
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Chia dur cho các shot theo weight (chuẩn hoá), mỗi shot ≥ shotFloorSec.
// Sàn không nhét vừa (quá nhiều shot cho đoạn quá ngắn) → chia đều.
export function allocateShots(
  shots: Array<{ weight: number }>,
  durationSec: number,
  shotFloorSec: number,
): number[] {
  if (shots.length === 0) return [];
  if (shots.length * shotFloorSec >= durationSec) {
    return shots.map(() => durationSec / shots.length);
  }
  const totalWeight = shots.reduce((s, sh) => s + Math.max(0, sh.weight), 0);
  // Mọi weight ≤ 0 → coi như đều.
  const weights =
    totalWeight > 0 ? shots.map((sh) => Math.max(0, sh.weight) / totalWeight) : shots.map(() => 1 / shots.length);
  let durations = weights.map((w) => w * durationSec);
  // Áp sàn: shot hụt kéo lên sàn, phần dư trừ tỉ lệ vào các shot còn dư địa.
  for (let pass = 0; pass < shots.length; pass++) {
    const deficit = durations.reduce((s, d) => s + Math.max(0, shotFloorSec - d), 0);
    if (deficit <= 1e-9) break;
    const donors = durations.filter((d) => d > shotFloorSec);
    const donorTotal = donors.reduce((s, d) => s + (d - shotFloorSec), 0);
    durations = durations.map((d) => {
      if (d < shotFloorSec) return shotFloorSec;
      if (donorTotal <= 0) return d;
      return d - ((d - shotFloorSec) / donorTotal) * deficit;
    });
  }
  return durations;
}

// segDurations: segId → giây audio TTS đo được (0 = chưa/không có audio → dùng
// durationHint nếu có, cuối cùng áp sàn floorSec).
export function buildTimeline(
  segments: ScriptSegment[],
  segDurations: Record<string, number>,
  config?: Pick<RenderConfig, 'segmentOverrides'>,
  opts?: TimelineOpts,
): Timeline {
  const o = { ...TIMELINE_DEFAULTS, ...opts };
  const sorted = [...segments].sort((a, b) => a.order - b.order);
  const out: TimelineSegment[] = [];
  let cursor = 0;
  for (const seg of sorted) {
    const override = config?.segmentOverrides?.[seg.id]?.durationSec;
    const audioSec = segDurations[seg.id] ?? 0;
    let dur: number;
    if (override !== undefined && override > 0) {
      // Audio là nhạc trưởng: override không được ngắn hơn audio + pad — narration tràn
      // sang segment sau sẽ phá bất biến sync (audio track chỉ adelay, không cắt).
      dur =
        audioSec > 0 ? Math.max(override, audioSec + o.padHeadSec + o.padTailSec) : override;
    } else if (audioSec > 0) {
      dur = Math.max(audioSec + o.padHeadSec + o.padTailSec, o.floorSec);
    } else {
      const hint = seg.durationHint ?? estimateSeconds(seg.narration);
      dur = Math.max(hint, o.floorSec);
    }
    dur = round3(dur);
    const shotDurations = allocateShots(seg.shots, dur, o.shotFloorSec);
    const shots: TimelineShot[] = [];
    let shotCursor = cursor;
    seg.shots.forEach((shot, i) => {
      const end = i === seg.shots.length - 1 ? cursor + dur : shotCursor + shotDurations[i];
      shots.push({
        sourceIndex: shot.sourceIndex,
        region: shot.region ? { ...shot.region } : null,
        start: round3(shotCursor),
        end: round3(end),
      });
      shotCursor = end;
    });
    out.push({ segId: seg.id, start: round3(cursor), end: round3(cursor + dur), shots });
    cursor = round3(cursor + dur);
  }
  return { segments: out, totalSec: round3(cursor) };
}

// Tách văn bản thành câu: dấu kết câu (. ! ? …) + xuống dòng. Giữ nguyên dấu cuối câu.
// Dùng chung cho toSrt (CLI) và caption overlay (Preview UI).
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function srtTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Canh giờ các câu trong một khoảng [start, end] tỉ lệ theo số ký tự (naive, không thêm API).
// Dùng chung cho toSrt và caption preview.
export function allocateCaptions(
  sentences: string[],
  startSec: number,
  endSec: number,
): Array<{ text: string; start: number; end: number }> {
  if (sentences.length === 0) return [];
  const totalChars = sentences.reduce((s, t) => s + t.length, 0);
  const span = Math.max(0, endSec - startSec);
  const out: Array<{ text: string; start: number; end: number }> = [];
  let cursor = startSec;
  sentences.forEach((text, i) => {
    const share = totalChars > 0 ? text.length / totalChars : 1 / sentences.length;
    const end = i === sentences.length - 1 ? endSec : cursor + share * span;
    out.push({ text, start: round3(cursor), end: round3(end) });
    cursor = end;
  });
  return out;
}

// Caption tách theo CÂU trong từng segment (Validation S1) — không đổ cả khối narration.
// Mọi caption nằm gọn trong [start_seg, end_seg] của segment nó thuộc về.
export function toSrt(timeline: Timeline, segments: ScriptSegment[]): string {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const blocks: string[] = [];
  let index = 1;
  for (const tseg of timeline.segments) {
    const seg = byId.get(tseg.segId);
    if (!seg || !seg.narration.trim()) continue;
    for (const cap of allocateCaptions(splitSentences(seg.narration), tseg.start, tseg.end)) {
      blocks.push(`${index}\n${srtTime(cap.start)} --> ${srtTime(cap.end)}\n${cap.text}\n`);
      index++;
    }
  }
  return blocks.join('\n');
}

// Bảng review timeline (seg # | narration | shots | start | end) — xuất timeline.json.
export function toTimelineJson(
  timeline: Timeline,
  segments: ScriptSegment[],
): {
  totalSec: number;
  segments: Array<{
    order: number;
    segId: string;
    narration: string;
    start: number;
    end: number;
    shots: TimelineShot[];
  }>;
} {
  const byId = new Map(segments.map((s) => [s.id, s]));
  return {
    totalSec: timeline.totalSec,
    segments: timeline.segments.map((tseg, i) => ({
      order: byId.get(tseg.segId)?.order ?? i,
      segId: tseg.segId,
      narration: byId.get(tseg.segId)?.narration ?? '',
      start: tseg.start,
      end: tseg.end,
      shots: tseg.shots,
    })),
  };
}
