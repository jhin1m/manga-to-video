import type { CSSProperties } from 'react';
import type { Aspect } from './schema';
import { planKenburns, type KenburnsInput, type KenburnsPlan } from './kenburns';

// Ken Burns XẤP XỈ bằng CSS — module THUẦN dùng chung cho trang video và preview
// Storyboard (bản chuẩn vẫn là CLI render, xem kenburns.ts). Container phải có
// containerType:'size' vì transform tính theo 100cqw/100cqh.

export const ASPECT_CSS: Record<Aspect, string> = {
  '9:16': '9 / 16',
  '16:9': '16 / 9',
  '1:1': '1 / 1',
};

export interface KenburnsFrameStyle {
  fgStyle: CSSProperties;
  imgTransformStyle: CSSProperties;
}

// Vị trí pan tại tiến độ q, tính theo TỈ LỆ của toàn bộ phần dư — vì `(100cqh - 100%)`
// trong transform chính là phần dư đó (âm), đo bằng đơn vị container.
//
// ffmpeg KHÔNG lia hết phần dư: nó chạy travelPx (đã bị MAX_PAN_FRAME_PER_SEC kẹp) và
// khởi điểm từ basePx (căn giữa quãng còn lại), nên preview chạy trọn phần dư sẽ quét xa
// hơn video thật — với slice 720×2240 trong khung 16:9 là gấp 4.6×. travelFull suy ngược
// từ chính plan (2×basePx + travelPx) nên không cần biết kích thước khung; sai số ≤1px do
// làm tròn, vô hình ở preview.
function panOffsetRatio(plan: KenburnsPlan, q: number): string {
  const base = plan.basePx ?? 0;
  const travel = plan.travelPx ?? 0;
  const travelFull = 2 * base + travel;
  const ratio = travelFull > 0 ? (base + travel * q) / travelFull : 0;
  return ratio.toFixed(4);
}

// Style khung hình tại tiến độ p ∈ [0,1] của shot. zoom = hệ số zoom đích (mode 'zoom').
export function kenburnsFrameStyle(
  plan: KenburnsPlan,
  p: number,
  zoom: number,
): KenburnsFrameStyle {
  // reverse đọc từ plan (cùng nguồn với ffmpeg): tiến độ đảo 1→0 cho pan lẫn zoom
  // (Z-(Z-1)p ≡ 1+(Z-1)(1-p)).
  const q = plan.reverse ? 1 - p : p;
  if (plan.mode === 'pan-v') {
    // Ảnh phủ bề rộng khung; chạy dọc theo ĐÚNG quãng ffmpeg lia (xem panOffsetRatio).
    return {
      fgStyle: { width: '100%', height: 'auto' },
      imgTransformStyle: {
        transform: `translateY(calc((100cqh - 100%) * ${panOffsetRatio(plan, q)}))`,
      },
    };
  }
  if (plan.mode === 'pan-h') {
    return {
      fgStyle: { height: '100%', width: 'auto', maxWidth: 'none' },
      imgTransformStyle: {
        transform: `translateX(calc((100cqw - 100%) * ${panOffsetRatio(plan, q)}))`,
      },
    };
  }
  // coverFill: ảnh phủ kín khung (che luôn lớp nền blur), khớp scale-cover + crop giữa của ffmpeg.
  const objectFit = plan.coverFill ? 'cover' : 'contain';
  if (plan.mode === 'static') {
    // Khung đứng yên — cùng cách lấp khung như zoom nhưng không transform.
    return {
      fgStyle: { width: '100%', height: '100%', objectFit },
      imgTransformStyle: {},
    };
  }
  const scale = 1 + (Math.max(1, zoom) - 1) * q;
  return {
    fgStyle: { width: '100%', height: '100%', objectFit },
    imgTransformStyle: { transform: `scale(${scale.toFixed(4)})` },
  };
}

// Tiện lợi cho preview: tự planKenburns rồi suy style một lần.
export function kenburnsFrameFromInput(input: KenburnsInput, p: number): KenburnsFrameStyle {
  return kenburnsFrameStyle(planKenburns(input), p, input.zoom);
}

// Nhãn chuyển động tiếng Việt kèm hướng — hiển thị chip trên preview.
export function kenburnsModeLabel(mode: KenburnsPlan['mode'], reverse = false): string {
  switch (mode) {
    case 'pan-v':
      return reverse ? 'Lia dọc ↑' : 'Lia dọc ↓';
    case 'pan-h':
      return reverse ? 'Lia ngang ←' : 'Lia ngang →';
    case 'zoom':
      return reverse ? 'Zoom ra ⊙' : 'Zoom vào ⊙';
    case 'static':
      return 'Tĩnh';
  }
}
