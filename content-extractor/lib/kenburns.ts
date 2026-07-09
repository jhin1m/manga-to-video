import type { Aspect, BeatRegion } from './schema';

// Ken Burns per shot — module THUẦN trả chuỗi filtergraph ffmpeg (không spawn, dễ test).
// Suy hướng chuyển động từ hình dáng region: cao/hẹp → pan dọc, rộng → pan ngang,
// gần vuông → zoom vào tâm. Aspect lệch band-ratio → blur-fill (nền scale-cover + boxblur,
// lớp trên fit-inside + zoompan). Pan dùng crop theo t (mượt, không jitter như zoompan).

export interface KenburnsInput {
  imgW: number;
  imgH: number;
  region: BeatRegion | null; // null = cả band
  aspect: Aspect;
  durationSec: number;
  fps: number;
  zoom: number; // hệ số zoom đích cho mode zoom (1 = tĩnh)
}

export function frameSize(aspect: Aspect): { w: number; h: number } {
  switch (aspect) {
    case '9:16':
      return { w: 1080, h: 1920 };
    case '16:9':
      return { w: 1920, h: 1080 };
    case '1:1':
      return { w: 1080, h: 1080 };
  }
}

export interface KenburnsPlan {
  mode: 'pan-v' | 'pan-h' | 'zoom';
  blurFill: boolean;
  // pan: quãng chạy (px trên trục pan, sau kẹp vận tốc) + offset khởi điểm căn giữa phần dư.
  travelPx?: number;
  basePx?: number;
}

// Region coi là "dải" khi cạnh này gấp ≥1.6 cạnh kia; pan chỉ khả thi khi scale-phủ-trục
// còn lại cho quãng chạy hợp lý (1.05×..3× so với fit) — vượt 3× phóng đại quá đà
// (vd band dọc trong khung 16:9, Validation S1) → rơi về zoom + blur-fill.
const STRIP_SHAPE = 1.6;
const PAN_MIN_COVER = 1.05;
const PAN_MAX_COVER = 3;
// Kẹp vận tốc pan: quãng chạy ≤ 35% chiều khung hình mỗi giây (chống pan giật khi band
// quá cao mà shot ngắn).
const MAX_PAN_FRAME_PER_SEC = 0.35;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function planKenburns(input: KenburnsInput): KenburnsPlan {
  const { w: W, h: H } = frameSize(input.aspect);
  const r = input.region ?? { x: 0, y: 0, w: input.imgW, h: input.imgH };
  const tallness = r.h / r.w;
  const wideness = r.w / r.h;
  const frameRatio = W / H;

  // pan dọc: scale bề rộng region → W, chiều cao dư ra làm quãng chạy.
  const coverV = tallness * frameRatio; // = scaledH / H
  if (tallness >= STRIP_SHAPE && coverV >= PAN_MIN_COVER && coverV <= PAN_MAX_COVER) {
    const scaledH = even((r.h * W) / r.w);
    const travelFull = scaledH - H;
    const travel = Math.round(
      Math.min(travelFull, MAX_PAN_FRAME_PER_SEC * H * input.durationSec),
    );
    return {
      mode: 'pan-v',
      blurFill: false,
      travelPx: travel,
      basePx: Math.round((travelFull - travel) / 2),
    };
  }

  // pan ngang: scale chiều cao region → H, bề rộng dư ra làm quãng chạy.
  const coverH = wideness / frameRatio; // = scaledW / W
  if (wideness >= STRIP_SHAPE && coverH >= PAN_MIN_COVER && coverH <= PAN_MAX_COVER) {
    const scaledW = even((r.w * H) / r.h);
    const travelFull = scaledW - W;
    const travel = Math.round(
      Math.min(travelFull, MAX_PAN_FRAME_PER_SEC * W * input.durationSec),
    );
    return {
      mode: 'pan-h',
      blurFill: false,
      travelPx: travel,
      basePx: Math.round((travelFull - travel) / 2),
    };
  }

  // zoom vào tâm region; blur-fill khi tỉ lệ region lệch khung (fit-inside không phủ kín).
  const blurFill = Math.abs(wideness - frameRatio) / frameRatio > 0.02;
  return { mode: 'zoom', blurFill };
}

// Filtergraph cho renderShot — luôn kết thúc ở nhãn [v], kích thước ra đúng khung,
// setsar=1 để concat demuxer nối các shot không phàn nàn.
export function kenburns(input: KenburnsInput): string {
  const { w: W, h: H } = frameSize(input.aspect);
  const r = input.region ?? { x: 0, y: 0, w: input.imgW, h: input.imgH };
  const plan = planKenburns(input);
  const dur = Math.max(0.1, input.durationSec);
  const cropReg = `crop=${r.w}:${r.h}:${r.x}:${r.y}`;

  if (plan.mode === 'pan-v') {
    const y =
      (plan.travelPx ?? 0) > 0
        ? `'${plan.basePx}+${plan.travelPx}*(t/${dur.toFixed(3)})'`
        : String(plan.basePx ?? 0);
    return `[0:v]${cropReg},scale=${W}:-2,crop=${W}:${H}:0:${y},setsar=1[v]`;
  }

  if (plan.mode === 'pan-h') {
    const x =
      (plan.travelPx ?? 0) > 0
        ? `'${plan.basePx}+${plan.travelPx}*(t/${dur.toFixed(3)})'`
        : String(plan.basePx ?? 0);
    return `[0:v]${cropReg},scale=-2:${H},crop=${W}:${H}:${x}:0,setsar=1[v]`;
  }

  // mode zoom: zoompan tuyến tính 1 → zoom vào tâm; supersample ×2 trước zoompan giảm jitter.
  const frames = Math.max(2, Math.round(dur * input.fps));
  const zoomTarget = Math.max(1, input.zoom);
  const zExpr = `'1+${(zoomTarget - 1).toFixed(4)}*on/${frames - 1}'`;
  const zoomCenter = `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`;

  if (!plan.blurFill) {
    return (
      `[0:v]${cropReg},scale=${W * 2}:${H * 2},` +
      `zoompan=z=${zExpr}:${zoomCenter}:d=1:s=${W}x${H},setsar=1[v]`
    );
  }

  // blur-fill: nền = region scale-cover + boxblur; lớp trên = region fit-inside + zoompan.
  const fitScale = Math.min(W / r.w, H / r.h);
  const fw = even(r.w * fitScale);
  const fh = even(r.h * fitScale);
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]${cropReg},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:1[bgb];` +
    `[fg]${cropReg},scale=${fw * 2}:${fh * 2},` +
    `zoompan=z=${zExpr}:${zoomCenter}:d=1:s=${fw}x${fh}[fgz];` +
    `[bgb][fgz]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`
  );
}
