import type { BeatRegion } from './schema';

// Bbox vùng "có mực" của một ảnh — module THUẦN (không sharp, không React) cho nút
// "Vừa khít nội dung" ở cropper: client vẽ ảnh vào canvas → getImageData → inkBBox →
// scale về px working. Thuần để test được bằng ảnh tổng hợp (mẫu verify-banding.mts).
//
// Thuật toán (đã calibrate trên corpus thật — spike 260717-1720):
//   1. Gray theo ĐÚNG công thức repo (299R+587G+114B)/1000 (smart-split.ts) — nhất quán
//      với ngưỡng 250; spike chứng minh đủ, không cần color-distance/Otsu.
//   2. Projection profile hàng + cột; hàng/cột "có nội dung" khi ≥ ROW_PCT pixel có
//      gray < INK_MAX. Ngưỡng TỈ LỆ, không phải "gặp pixel mực đầu tiên" (lỗi của
//      ImageMagick -trim mặc định: 1 pixel nhiễu JPEG là dừng trim ngay).
//   3. Padding PAD_PCT cạnh bbox, sàn PAD_MIN_PX (lấy max) — khung video cần "thở".
//   4. Clamp vào biên; bbox chạm cả 4 cạnh (không có gì để trim) → trả null.

export interface RawImage {
  data: Uint8Array | Uint8ClampedArray; // RGBA (canvas getImageData) hoặc RGB, row-major
  width: number;
  height: number;
  channels: 3 | 4;
}

export interface InkBBoxSettings {
  inkMax: number; // gray < inkMax = pixel mực
  rowPct: number; // tỉ lệ pixel mực tối thiểu để hàng/cột tính là "có nội dung"
  padPct: number; // padding theo % cạnh bbox
  padMinPx: number; // sàn padding tuyệt đối
}

export const INK_BBOX_DEFAULTS: InkBBoxSettings = {
  inkMax: 250,
  rowPct: 0.01,
  padPct: 0.04,
  padMinPx: 14,
};

export function inkBBox(img: RawImage, s?: Partial<InkBBoxSettings>): BeatRegion | null {
  const { inkMax, rowPct, padPct, padMinPx } = { ...INK_BBOX_DEFAULTS, ...s };
  const { data, width, height, channels } = img;
  if (width < 1 || height < 1) return null;

  // Projection profile: đếm pixel mực theo hàng và cột trong một lượt quét.
  const rowInk = new Uint32Array(height);
  const colInk = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    let p = y * width * channels;
    for (let x = 0; x < width; x++, p += channels) {
      const gray = Math.min(
        255,
        Math.floor((299 * data[p] + 587 * data[p + 1] + 114 * data[p + 2]) / 1000),
      );
      if (gray < inkMax) {
        rowInk[y]++;
        colInk[x]++;
      }
    }
  }

  const rowMin = Math.max(1, Math.ceil(width * rowPct));
  const colMin = Math.max(1, Math.ceil(height * rowPct));
  let top = 0;
  while (top < height && rowInk[top] < rowMin) top++;
  if (top === height) return null; // ảnh trắng hết — không có gì để trim
  let bottom = height - 1;
  while (bottom > top && rowInk[bottom] < rowMin) bottom--;
  let left = 0;
  while (left < width && colInk[left] < colMin) left++;
  // Có hàng đủ mực nhưng không cột nào đạt ngưỡng (vd một vạch ngang mảnh trên ảnh cao):
  // không có bbox nghĩa — trả null thay vì mẩu sliver sát mép phải.
  if (left >= width) return null;
  let right = width - 1;
  while (right > left && colInk[right] < colMin) right--;

  // Full-bleed (bbox chạm cả 4 cạnh) → không có lề, caller giữ nguyên region.
  if (top === 0 && left === 0 && bottom === height - 1 && right === width - 1) return null;

  const bw = right - left + 1;
  const bh = bottom - top + 1;
  const padX = Math.max(padMinPx, Math.round(bw * padPct));
  const padY = Math.max(padMinPx, Math.round(bh * padPct));
  const x = Math.max(0, left - padX);
  const y = Math.max(0, top - padY);
  return {
    x,
    y,
    w: Math.min(width, right + padX + 1) - x,
    h: Math.min(height, bottom + padY + 1) - y,
  };
}
