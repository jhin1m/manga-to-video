import type { BeatRegion } from './schema';
import type { RawImage } from './ink-bbox';

// Auto-crop "né bubble" v2.1 — port Python skill mtv/auto_region.py (đồng bộ 2 nơi).
// Manhwa dọc: GIỮ FULL WIDTH, chọn cửa sổ dọc bubble-mean thấp nhất. Không cắt ngang.

export interface AutoRegionSettings {
  maxEdge: number;
  brightThr: number;
  minBubbleAreaFrac: number;
  maxBubbleAreaFrac: number;
  minBubbleSide: number;
  minFill: number;
  minDarkInBubble: number;
  bgWidthFrac: number;
  bgHeightFrac: number;
  minKeepHFrac: number;
  minKeepWFrac: number;
  minTrimFrac: number;
  minBubbleReduce: number;
  padPct: number;
  padMinPx: number;
}

export const AUTO_REGION_DEFAULTS: AutoRegionSettings = {
  maxEdge: 480,
  brightThr: 244,
  minBubbleAreaFrac: 0.003,
  maxBubbleAreaFrac: 0.2,
  minBubbleSide: 10,
  minFill: 0.38,
  minDarkInBubble: 0.015,
  bgWidthFrac: 0.85,
  bgHeightFrac: 0.28,
  minKeepHFrac: 0.78,
  minKeepWFrac: 0.92,
  minTrimFrac: 0.05,
  minBubbleReduce: 0.18,
  padPct: 0.02,
  padMinPx: 8,
};

function grayAt(img: RawImage, x: number, y: number): number {
  const p = (y * img.width + x) * img.channels;
  return Math.min(
    255,
    Math.floor((299 * img.data[p] + 587 * img.data[p + 1] + 114 * img.data[p + 2]) / 1000),
  );
}

function toGray(img: RawImage): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) out[y * img.width + x] = grayAt(img, x, y);
  }
  return out;
}

function downscaleGray(
  gray: Uint8Array,
  width: number,
  height: number,
  maxEdge: number,
): { data: Uint8Array; width: number; height: number; scale: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale >= 1) return { data: gray, width, height, scale: 1 };
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      data[y * w + x] = gray[sy * width + sx];
    }
  }
  return { data, width: w, height: h, scale };
}

function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height);
  let count = 0;
  const stackX: number[] = [];
  const stackY: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i] || labels[i]) continue;
      count++;
      labels[i] = count;
      stackX.push(x);
      stackY.push(y);
      while (stackX.length) {
        const cx = stackX.pop()!;
        const cy = stackY.pop()!;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (!mask[ni] || labels[ni]) continue;
            labels[ni] = count;
            stackX.push(nx);
            stackY.push(ny);
          }
        }
      }
    }
  }
  return { labels, count };
}

function buildBubbleMask(
  gray: Uint8Array,
  width: number,
  height: number,
  s: AutoRegionSettings,
): Float64Array {
  const n = width * height;
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) bright[i] = gray[i] >= s.brightThr ? 1 : 0;
  const { labels, count } = labelComponents(bright, width, height);
  const bubble = new Float64Array(n);
  if (count === 0) return bubble;

  const area = new Int32Array(count + 1);
  const minX = new Int32Array(count + 1).fill(width);
  const minY = new Int32Array(count + 1).fill(height);
  const maxX = new Int32Array(count + 1);
  const maxY = new Int32Array(count + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lab = labels[y * width + x];
      if (!lab) continue;
      area[lab]++;
      if (x < minX[lab]) minX[lab] = x;
      if (y < minY[lab]) minY[lab] = y;
      if (x > maxX[lab]) maxX[lab] = x;
      if (y > maxY[lab]) maxY[lab] = y;
    }
  }

  for (let lab = 1; lab <= count; lab++) {
    const a = area[lab];
    const frac = a / n;
    if (frac < s.minBubbleAreaFrac || frac > s.maxBubbleAreaFrac) continue;
    const bw = maxX[lab] - minX[lab] + 1;
    const bh = maxY[lab] - minY[lab] + 1;
    if (bw < s.minBubbleSide || bh < s.minBubbleSide) continue;
    if (bw >= s.bgWidthFrac * width && bh >= s.bgHeightFrac * height) continue;
    if (a / (bw * bh) < s.minFill) continue;
    let dark = 0;
    let total = 0;
    for (let y = minY[lab]; y <= maxY[lab]; y++) {
      for (let x = minX[lab]; x <= maxX[lab]; x++) {
        total++;
        if (gray[y * width + x] < 160) dark++;
      }
    }
    if (dark / total < s.minDarkInBubble) continue;
    for (let y = minY[lab]; y <= maxY[lab]; y++) {
      for (let x = minX[lab]; x <= maxX[lab]; x++) {
        const i = y * width + x;
        if (labels[i] === lab) bubble[i] = 1;
      }
    }
  }
  return bubble;
}

function bestWindow1d(
  line: Float64Array,
  minKeep: number,
  minBubbleReduce: number,
): { start: number; length: number; mean: number } {
  const n = line.length;
  let fullSum = 0;
  for (let i = 0; i < n; i++) fullSum += line[i];
  const fullMean = n ? fullSum / n : 0;
  if (n <= minKeep) return { start: 0, length: n, mean: fullMean };
  const ps = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + line[i];
  // dài → ngắn: nhận length đầu tiên giảm bubble đủ ngưỡng
  const lengths = Array.from(
    new Set([n, Math.round(n * 0.92), Math.round(n * 0.85), Math.round(n * 0.78), minKeep]),
  ).sort((a, b) => b - a);
  for (const length of lengths) {
    if (length < minKeep || length > n || length === n) continue;
    let bestStart = 0;
    let bestMean = Infinity;
    for (let start = 0; start <= n - length; start++) {
      const mean = (ps[start + length] - ps[start]) / length;
      if (mean < bestMean) {
        bestMean = mean;
        bestStart = start;
      }
    }
    if (fullMean > 1e-12 && (fullMean - bestMean) / fullMean >= minBubbleReduce) {
      return { start: bestStart, length, mean: bestMean };
    }
  }
  return { start: 0, length: n, mean: fullMean };
}

function clampRegion(r: BeatRegion, width: number, height: number): BeatRegion {
  const x = Math.max(0, Math.min(Math.round(r.x), width - 1));
  const y = Math.max(0, Math.min(Math.round(r.y), height - 1));
  const w = Math.max(1, Math.min(Math.round(r.w), width - x));
  const h = Math.max(1, Math.min(Math.round(r.h), height - y));
  return { x, y, w, h };
}

export function autoRegion(img: RawImage, settings?: Partial<AutoRegionSettings>): BeatRegion | null {
  const s = { ...AUTO_REGION_DEFAULTS, ...settings };
  const { width: W0, height: H0 } = img;
  if (W0 < 8 || H0 < 8) return null;

  const gray0 = toGray(img);
  const { data: gray, width: W, height: H, scale } = downscaleGray(gray0, W0, H0, s.maxEdge);
  const bubble = buildBubbleMask(gray, W, H, s);
  let bubbleSum = 0;
  for (let i = 0; i < bubble.length; i++) bubbleSum += bubble[i];
  const bubbleFracFull = bubbleSum / (W * H);
  if (bubbleFracFull < 0.012) return null;

  const tall = H >= W * 1.05;
  const wide = W > H * 1.15;

  let x0 = 0;
  let y0 = 0;
  let rw = W;
  let rh = H;
  let subBub = bubbleFracFull;

  if (tall || !wide) {
    const rowBub = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let x = 0; x < W; x++) sum += bubble[y * W + x];
      rowBub[y] = sum / W;
    }
    const minKeepH = Math.max(8, Math.round(H * s.minKeepHFrac));
    const win = bestWindow1d(rowBub, minKeepH, s.minBubbleReduce);
    y0 = win.start;
    rh = win.length;
    subBub = win.mean;
    x0 = 0;
    rw = W;
  } else {
    const colBub = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = 0; y < H; y++) sum += bubble[y * W + x];
      colBub[x] = sum / H;
    }
    const minKeepW = Math.max(8, Math.round(W * s.minKeepWFrac));
    const win = bestWindow1d(colBub, minKeepW, s.minBubbleReduce);
    x0 = win.start;
    rw = win.length;
    subBub = win.mean;
    y0 = 0;
    rh = H;
  }

  const trim = 1 - (rw * rh) / (W * H);
  if (trim < s.minTrimFrac) return null;
  if (bubbleFracFull > 0 && (bubbleFracFull - subBub) / bubbleFracFull < s.minBubbleReduce) {
    return null;
  }

  const inv = scale > 0 ? 1 / scale : 1;
  let x = x0 * inv;
  let y = y0 * inv;
  let w = rw * inv;
  let h = rh * inv;
  const padX = Math.max(s.padMinPx, Math.round(w * s.padPct));
  const padY = Math.max(s.padMinPx, Math.round(h * s.padPct));
  if (tall || !wide) {
    x = 0;
    w = W0;
    y = Math.max(0, y - padY);
    h = Math.min(H0 - y, h + 2 * padY);
  } else {
    y = 0;
    h = H0;
    x = Math.max(0, x - padX);
    w = Math.min(W0 - x, w + 2 * padX);
  }
  return clampRegion({ x, y, w, h }, W0, H0);
}

export function autoRegionWithin(
  img: RawImage,
  base: BeatRegion | null,
  settings?: Partial<AutoRegionSettings>,
): BeatRegion | null {
  const full = { x: 0, y: 0, w: img.width, h: img.height };
  const box = clampRegion(base ?? full, img.width, img.height);
  const { x: bx, y: by, w: bw, h: bh } = box;
  const channels = img.channels;
  const data = new Uint8ClampedArray(bw * bh * channels);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const si = ((by + y) * img.width + (bx + x)) * channels;
      const di = (y * bw + x) * channels;
      for (let c = 0; c < channels; c++) data[di + c] = img.data[si + c];
    }
  }
  const local = autoRegion({ data, width: bw, height: bh, channels }, settings);
  if (!local) return base ? { ...box } : null;
  return clampRegion(
    { x: bx + local.x, y: by + local.y, w: local.w, h: local.h },
    img.width,
    img.height,
  );
}
