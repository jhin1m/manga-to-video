import type { Aspect, BeatRegion, MotionMode, MotionOverride } from './schema';

// Ken Burns per shot — module THUẦN trả chuỗi filtergraph ffmpeg (không spawn, dễ test).
// Mặc định (auto) suy hướng chuyển động từ hình dáng region: cao/hẹp → pan dọc, rộng →
// pan ngang, gần vuông → zoom vào tâm. `motion` ghi đè per-shot: ép mode + đảo hướng.
// Aspect lệch band-ratio → blur-fill (nền scale-cover + boxblur, lớp trên fit-inside).
//
// Chống shake: crop lẫn zoompan đều lượng tử hoá toạ độ về integer pixel MỖI FRAME, mà
// chuyển động Ken Burns < 1px/frame → thành "đứng yên vài frame rồi giật ~1px" (preview
// CSS dùng transform số thực nên mượt — chỉ bản render bị). Sai số giảm tuyến tính theo
// hệ số supersample (đo thực nghiệm ×2→×4: giật 0.88px→0.43px), nên mọi nhánh có chuyển
// động đều dựng ở SUPERSAMPLE× rồi downscale về khung; riêng zoom thêm tmix 2 frame
// (motion < 0.5px/frame nên không ghost) triệt phần dư còn 0.14px. Pan KHÔNG tmix —
// motion ~9px/frame sẽ thành bóng ma thấy rõ.

export interface KenburnsInput {
  imgW: number;
  imgH: number;
  region: BeatRegion | null; // null = cả band
  aspect: Aspect;
  durationSec: number;
  fps: number;
  zoom: number; // hệ số zoom đích cho mode zoom (1 = tĩnh)
  motion?: MotionOverride; // ghi đè per-shot — undefined hoặc mode 'auto' = tự suy như cũ
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
  mode: 'pan-v' | 'pan-h' | 'zoom' | 'static';
  blurFill: boolean;
  // pan: quãng chạy (px trên trục pan, sau kẹp vận tốc) + offset khởi điểm căn giữa phần dư.
  travelPx?: number;
  basePx?: number;
  // Đảo hướng (lia ↑/←, zoom-out) — nguồn duy nhất cho cả ffmpeg (kenburns) lẫn CSS
  // (kenburns-css). Chỉ được set khi motion ép mode có hướng.
  reverse?: boolean;
}

// Region coi là "dải" khi cạnh này gấp ≥1.6 cạnh kia; pan (auto) chỉ khả thi khi
// scale-phủ-trục còn lại cho quãng chạy hợp lý (1.05×..3× so với fit) — vượt 3× phóng đại
// quá đà (vd band dọc trong khung 16:9, Validation S1) → rơi về zoom + blur-fill.
const STRIP_SHAPE = 1.6;
const PAN_MIN_COVER = 1.05;
const PAN_MAX_COVER = 3;
// Kẹp vận tốc pan: quãng chạy ≤ 35% chiều khung hình mỗi giây (chống pan giật khi band
// quá cao mà shot ngắn).
const MAX_PAN_FRAME_PER_SEC = 0.35;
// Hệ số supersample chống lượng tử hoá integer của crop/zoompan (xem header). Pan chỉ
// nhân theo trục pan (trục kia không có toạ độ động); zoom nhân cả hai chiều fg.
const SUPERSAMPLE = 4;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// pan dọc: scale bề rộng region → W, chiều cao dư ra làm quãng chạy (dùng chung auto + ép).
function panVPlan(
  r: BeatRegion,
  W: number,
  H: number,
  durationSec: number,
  reverse?: boolean,
): KenburnsPlan {
  const scaledH = even((r.h * W) / r.w);
  const travelFull = scaledH - H;
  const travel = Math.round(Math.min(travelFull, MAX_PAN_FRAME_PER_SEC * H * durationSec));
  return {
    mode: 'pan-v',
    blurFill: false,
    travelPx: travel,
    basePx: Math.round((travelFull - travel) / 2),
    ...(reverse ? { reverse: true } : {}),
  };
}

// pan ngang: scale chiều cao region → H, bề rộng dư ra làm quãng chạy.
function panHPlan(
  r: BeatRegion,
  W: number,
  H: number,
  durationSec: number,
  reverse?: boolean,
): KenburnsPlan {
  const scaledW = even((r.w * H) / r.h);
  const travelFull = scaledW - W;
  const travel = Math.round(Math.min(travelFull, MAX_PAN_FRAME_PER_SEC * W * durationSec));
  return {
    mode: 'pan-h',
    blurFill: false,
    travelPx: travel,
    basePx: Math.round((travelFull - travel) / 2),
    ...(reverse ? { reverse: true } : {}),
  };
}

export function planKenburns(input: KenburnsInput): KenburnsPlan {
  const { w: W, h: H } = frameSize(input.aspect);
  const r = input.region ?? { x: 0, y: 0, w: input.imgW, h: input.imgH };
  const tallness = r.h / r.w;
  const wideness = r.w / r.h;
  const frameRatio = W / H;
  const coverV = tallness * frameRatio; // = scaledH / H
  const coverH = wideness / frameRatio; // = scaledW / W
  // blur-fill khi tỉ lệ region lệch khung (fit-inside không phủ kín).
  const aspectMismatch = Math.abs(wideness - frameRatio) / frameRatio > 0.02;

  // ==== Ghi đè per-shot (mode ≠ auto) ====
  const forced = input.motion !== undefined && input.motion.mode !== 'auto' ? input.motion : undefined;
  if (forced) {
    // `reverse` chỉ có nghĩa với mode có hướng (pan/zoom); với 'static' và 'auto' là
    // NO-OP IM LẶNG — không ném lỗi, vì UI có thể dựng ra tổ hợp đó khi người dùng đổi
    // mode qua lại. Đây là quyết định chủ ý, không phải bug.
    const reverse = forced.reverse === true;
    // Ép pan CỐ Ý bỏ trần PAN_MAX_COVER: trần đó tồn tại để auto không tự chọn cú pan
    // phóng đại quá đà; người dùng chủ động ép thì tôn trọng lựa chọn —
    // MAX_PAN_FRAME_PER_SEC vẫn kẹp vận tốc nên không giật.
    if (forced.mode === 'pan-v' && coverV >= PAN_MIN_COVER) {
      return panVPlan(r, W, H, input.durationSec, reverse);
    }
    if (forced.mode === 'pan-h' && coverH >= PAN_MIN_COVER) {
      return panHPlan(r, W, H, input.durationSec, reverse);
    }
    if (forced.mode === 'zoom') {
      return { mode: 'zoom', blurFill: aspectMismatch, ...(reverse ? { reverse: true } : {}) };
    }
    if (forced.mode === 'static') {
      return { mode: 'static', blurFill: aspectMismatch };
    }
    // Ép pan nhưng vùng không đủ phần dư trên trục đó (UI đã disable — chỉ tới đây khi
    // .mtvproj bị sửa tay hoặc dữ liệu lệch): rơi về suy luận auto phía dưới — an toàn,
    // không dựng filter crop vượt biên ảnh đã scale.
  }

  // ==== auto: suy từ hình dáng region (hành vi gốc, giữ nguyên) ====
  if (tallness >= STRIP_SHAPE && coverV >= PAN_MIN_COVER && coverV <= PAN_MAX_COVER) {
    return panVPlan(r, W, H, input.durationSec);
  }
  if (wideness >= STRIP_SHAPE && coverH >= PAN_MIN_COVER && coverH <= PAN_MAX_COVER) {
    return panHPlan(r, W, H, input.durationSec);
  }
  // zoom vào tâm region; blur-fill khi tỉ lệ region lệch khung.
  return { mode: 'zoom', blurFill: aspectMismatch };
}

// Mode khả thi cho vùng hiện tại — nguồn cho UI disable + tooltip. auto/zoom/static LUÔN
// khả thi (blur-fill lo phần lệch tỉ lệ); pan cần phần dư ≥ PAN_MIN_COVER trên trục đó.
// Khác nhánh auto: KHÔNG áp trần PAN_MAX_COVER — người dùng ép thủ công thì tôn trọng
// (xem comment trong planKenburns), nên danh sách này rộng hơn những gì auto tự chọn.
export function availableModes(
  region: BeatRegion | null,
  imgW: number,
  imgH: number,
  aspect: Aspect,
): MotionMode[] {
  const { w: W, h: H } = frameSize(aspect);
  const r = region ?? { x: 0, y: 0, w: imgW, h: imgH };
  const frameRatio = W / H;
  const modes: MotionMode[] = ['auto'];
  if ((r.h / r.w) * frameRatio >= PAN_MIN_COVER) modes.push('pan-v');
  if (r.w / r.h / frameRatio >= PAN_MIN_COVER) modes.push('pan-h');
  modes.push('zoom', 'static');
  return modes;
}

// Filtergraph cho renderShot — luôn kết thúc ở nhãn [v], kích thước ra đúng khung,
// setsar=1 để concat demuxer nối các shot không phàn nàn.
export function kenburns(input: KenburnsInput): string {
  const { w: W, h: H } = frameSize(input.aspect);
  const r = input.region ?? { x: 0, y: 0, w: input.imgW, h: input.imgH };
  const plan = planKenburns(input);
  const dur = Math.max(0.1, input.durationSec);
  const cropReg = `crop=${r.w}:${r.h}:${r.x}:${r.y}`;
  // Tiến độ pan theo t: reverse chạy 1→0. Chuỗi forward giữ NGUYÊN BYTE so với bản trước
  // (gate hồi quy: motion undefined → filtergraph byte-identical).
  const frac = plan.reverse ? `(1-t/${dur.toFixed(3)})` : `(t/${dur.toFixed(3)})`;

  // Pan chạy ở SUPERSAMPLE× theo trục pan (base/travel nhân theo, trục kia giữ nguyên)
  // rồi downscale về khung — bước crop từ 1px còn 1/SS px.
  const S = SUPERSAMPLE;
  if (plan.mode === 'pan-v') {
    const scaledH = even((r.h * W) / r.w) * S;
    const y =
      (plan.travelPx ?? 0) > 0
        ? `'${(plan.basePx ?? 0) * S}+${(plan.travelPx ?? 0) * S}*${frac}'`
        : String((plan.basePx ?? 0) * S);
    return `[0:v]${cropReg},scale=${W}:${scaledH},crop=${W}:${H * S}:0:${y},scale=${W}:${H},setsar=1[v]`;
  }

  if (plan.mode === 'pan-h') {
    const scaledW = even((r.w * H) / r.h) * S;
    const x =
      (plan.travelPx ?? 0) > 0
        ? `'${(plan.basePx ?? 0) * S}+${(plan.travelPx ?? 0) * S}*${frac}'`
        : String((plan.basePx ?? 0) * S);
    return `[0:v]${cropReg},scale=${scaledW}:${H},crop=${W * S}:${H}:${x}:0,scale=${W}:${H},setsar=1[v]`;
  }

  if (plan.mode === 'static') {
    // static BỎ HẲN zoompan: zoompan tồn tại trong file này chỉ để animate z — không
    // animate thì đừng gọi nó (z=1 qua .toFixed vẫn có thể thành micro-zoom ngoài ý muốn).
    if (!plan.blurFill) {
      // Scale thẳng về khung: lệch tỉ lệ ≤2% — đúng dung sai nhánh zoom đang chấp nhận
      // (zoompan s=WxH cũng ép về đúng khung như vậy).
      return `[0:v]${cropReg},scale=${W}:${H},setsar=1[v]`;
    }
    // blur-fill: nền scale-cover + boxblur; fg fit-inside TĨNH — không supersample
    // (không có gì đổi giữa các frame thì không có rounding drift để mà jitter).
    const fitScale = Math.min(W / r.w, H / r.h);
    const fw = even(r.w * fitScale);
    const fh = even(r.h * fitScale);
    return (
      `[0:v]split=2[bg][fg];` +
      `[bg]${cropReg},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:1[bgb];` +
      `[fg]${cropReg},scale=${fw}:${fh}[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`
    );
  }

  // mode zoom: zoompan tuyến tính → zoom vào tâm; supersample trước zoompan + tmix 2 frame
  // sau (xem header — jitter direction-agnostic nên che luôn cả zoom-out).
  const frames = Math.max(2, Math.round(dur * input.fps));
  const zoomTarget = Math.max(1, input.zoom);
  // reverse dùng dạng đóng Z-(Z-1)*on/(frames-1) — CẤM idiom `if(eq(on,1),Z,zoom-step)`
  // tự tham chiếu frame trước (tích luỹ sai số FP). `on` 0-indexed nên /(frames-1) đúng
  // cho cả hai chiều.
  const zExpr = plan.reverse
    ? `'${zoomTarget.toFixed(4)}-${(zoomTarget - 1).toFixed(4)}*on/${frames - 1}'`
    : `'1+${(zoomTarget - 1).toFixed(4)}*on/${frames - 1}'`;
  const zoomCenter = `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`;

  if (!plan.blurFill) {
    return (
      `[0:v]${cropReg},scale=${W * S}:${H * S},` +
      `zoompan=z=${zExpr}:${zoomCenter}:d=1:s=${W}x${H},tmix=frames=2,setsar=1[v]`
    );
  }

  // blur-fill: nền = region scale-cover + boxblur; lớp trên = region fit-inside + zoompan.
  const fitScale = Math.min(W / r.w, H / r.h);
  const fw = even(r.w * fitScale);
  const fh = even(r.h * fitScale);
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]${cropReg},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:1[bgb];` +
    `[fg]${cropReg},scale=${fw * S}:${fh * S},` +
    `zoompan=z=${zExpr}:${zoomCenter}:d=1:s=${fw}x${fh},tmix=frames=2[fgz];` +
    `[bgb][fgz]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`
  );
}
