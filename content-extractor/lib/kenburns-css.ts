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

// Style khung hình tại tiến độ p ∈ [0,1] của shot. zoom = hệ số zoom đích (mode 'zoom').
export function kenburnsFrameStyle(
  plan: KenburnsPlan,
  p: number,
  zoom: number,
): KenburnsFrameStyle {
  if (plan.mode === 'pan-v') {
    // Ảnh phủ bề rộng khung; chạy dọc từ đầu tới cuối phần dư.
    return {
      fgStyle: { width: '100%', height: 'auto' },
      imgTransformStyle: { transform: `translateY(calc((100cqh - 100%) * ${p.toFixed(4)}))` },
    };
  }
  if (plan.mode === 'pan-h') {
    return {
      fgStyle: { height: '100%', width: 'auto', maxWidth: 'none' },
      imgTransformStyle: { transform: `translateX(calc((100cqw - 100%) * ${p.toFixed(4)}))` },
    };
  }
  const scale = 1 + (Math.max(1, zoom) - 1) * p;
  return {
    fgStyle: { width: '100%', height: '100%', objectFit: 'contain' },
    imgTransformStyle: { transform: `scale(${scale.toFixed(4)})` },
  };
}

// Tiện lợi cho preview: tự planKenburns rồi suy style một lần.
export function kenburnsFrameFromInput(input: KenburnsInput, p: number): KenburnsFrameStyle {
  return kenburnsFrameStyle(planKenburns(input), p, input.zoom);
}

// Nhãn chuyển động tiếng Việt kèm hướng — hiển thị chip trên preview.
export function kenburnsModeLabel(mode: KenburnsPlan['mode']): string {
  switch (mode) {
    case 'pan-v':
      return 'Lia dọc ↓';
    case 'pan-h':
      return 'Lia ngang →';
    case 'zoom':
      return 'Zoom vào ⊙';
  }
}
