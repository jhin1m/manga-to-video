import sharp from 'sharp';
import type { BeatRegion } from './schema';

// Cắt canvas dài (đã stitch) thành band theo NGỮ CẢNH thay vì theo chiều cao cố định:
// tìm "gutter" (khoảng trắng liên tục dày) làm điểm cắt, bỏ qua khe hẹp giữa nhân vật
// và bong bóng thoại (thứ mà thuật toán cũ — chia mỗi ~SPLIT_HEIGHT tại safe-line gần
// nhất — có thể cắt trúng, làm vision mất ngữ cảnh). Mỗi band vì vậy có xu hướng chứa
// trọn một đơn vị nội dung (nhân vật + bong bóng của nó).
//
// Pipeline: computeSafeRuns (gom hàng an toàn thành run) → chooseCuts (chọn gutter dày
// nhất trong cửa sổ [minBandHeight, maxBandHeight], ép cắt nếu không có gutter đạt tư
// cách) → regionsFromCuts (band liền mạch phủ kín canvas) → mergeLowInkBands (gộp band
// gần trắng / band cuối quá ngắn vào band liền kề).

export interface SplitSettings {
  lineTolerance: number; // chênh lệch pixel liền kề tối đa của hàng "an toàn" (0-255)
  ignorableBorder: number; // bỏ qua N px sát mép trái/phải khi xét hàng (viền/watermark)
  minGutterHeight: number; // run hàng an toàn liên tục phải dày ≥ ngưỡng này mới là ứng viên cắt
  minBandHeight: number; // không cắt trước ngưỡng này — giữ trọn nhân vật + bong bóng của nó
  maxBandHeight: number; // buộc cắt nếu vượt ngưỡng này — chặn band quá cao làm chữ nát khi downscale
  minInkDensity: number; // band có mật độ mực (tỉ lệ pixel không-trắng) dưới ngưỡng → gộp vào hàng xóm
}

function envInt(name: string, fallback: number, min = 1): number {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

// Như envInt nhưng KHÔNG có fallback cố định — trả undefined khi env chưa set/không hợp lệ,
// để caller tự suy giá trị mặc định (dùng cho MIN_BAND_HEIGHT/MAX_BAND_HEIGHT — suy từ SPLIT_HEIGHT).
function envIntOptional(name: string, min = 1): number | undefined {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v >= min ? v : undefined;
}

function envFloat(name: string, fallback: number, min = 0): number {
  const v = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) && v >= min ? v : fallback;
}

// Backward-compat: SPLIT_HEIGHT (.env cũ) vẫn được đọc — khi MIN_BAND_HEIGHT/MAX_BAND_HEIGHT
// chưa set, suy ra min = 0.6×SPLIT_HEIGHT, max = 1.4×SPLIT_HEIGHT (mặc định 1600 → 960/2240).
// SCAN_LINE_STEP/MIN_DISTANCE_PCT của thuật toán cũ không còn dùng — không đọc nữa.
export function readSplitSettings(): SplitSettings {
  const splitHeight = envInt('SPLIT_HEIGHT', 1600);
  return {
    lineTolerance: envInt('LINE_TOLERANCE', 25, 0),
    ignorableBorder: envInt('IGNORABLE_BORDER', 5, 0),
    minGutterHeight: envInt('MIN_GUTTER_HEIGHT', 24),
    minBandHeight: envIntOptional('MIN_BAND_HEIGHT') ?? Math.round(0.6 * splitHeight),
    maxBandHeight: envIntOptional('MAX_BAND_HEIGHT') ?? Math.round(1.4 * splitHeight),
    minInkDensity: envFloat('MIN_INK_DENSITY', 0.02, 0),
  };
}

export interface GrayImage {
  data: Uint8Array; // grayscale, row-major
  width: number;
  height: number;
}

// Grayscale theo đúng công thức integer của repo gốc (SmartStitch, jhin1m/manhwa-sticher,
// MIT): (299R + 587G + 114B) / 1000 — KHÔNG dùng sharp.greyscale() (libvips dùng hệ số
// khác, có thể lệch safe-line biên).
export async function toGray(image: Buffer): Promise<GrayImage> {
  const { data, info } = await sharp(image, { limitInputPixels: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const gray = new Uint8Array(width * height);
  if (channels === 1) {
    gray.set(data);
  } else if (channels === 2) {
    // gray + alpha — lấy kênh gray, bỏ alpha
    for (let i = 0, p = 0; i < gray.length; i++, p += 2) {
      gray[i] = data[p];
    }
  } else {
    // 3 (RGB) hoặc 4 (RGBA — bỏ alpha, khớp Rust đọc Rgba nhưng chỉ dùng RGB)
    for (let i = 0, p = 0; i < gray.length; i++, p += channels) {
      gray[i] = Math.min(255, Math.floor((299 * data[p] + 587 * data[p + 1] + 114 * data[p + 2]) / 1000));
    }
  }
  return { data: gray, width, height };
}

// Hàng y "an toàn" khi mọi cặp pixel liền kề trong hàng chênh ≤ tolerance
// (hàng free-space — không cắt ngang chữ/bubble/hình).
export function isSafeLine(img: GrayImage, y: number, s: SplitSettings): boolean {
  const startX = s.ignorableBorder;
  const endX = Math.max(0, img.width - s.ignorableBorder - 1);
  if (startX >= endX) return true; // ảnh quá hẹp — coi như an toàn (khớp repo gốc)
  const row = y * img.width;
  let prev = img.data[row + startX];
  for (let x = startX + 1; x <= endX; x++) {
    const cur = img.data[row + x];
    const diff = prev > cur ? prev - cur : cur - prev;
    if (diff > s.lineTolerance) return false;
    prev = cur;
  }
  return true;
}

export interface SafeRun {
  start: number; // hàng an toàn đầu tiên của run
  end: number; // hết run (exclusive) — hàng end KHÔNG an toàn (hoặc = height)
}

// Gom các hàng an toàn liên tiếp thành run. O(H×W) — chấp nhận được vì toGray đã decode
// raw pixel một lần cho cả canvas.
export function computeSafeRuns(img: GrayImage, s: SplitSettings): SafeRun[] {
  const runs: SafeRun[] = [];
  let start: number | null = null;
  for (let y = 0; y < img.height; y++) {
    if (isSafeLine(img, y, s)) {
      if (start === null) start = y;
    } else if (start !== null) {
      runs.push({ start, end: y });
      start = null;
    }
  }
  if (start !== null) runs.push({ start, end: img.height });
  return runs;
}

// Hàng an toàn gần `hi` nhất trong [lo, hi] — suy trực tiếp từ danh sách run (đã gom sẵn
// toàn bộ hàng an toàn của ảnh) thay vì quét lại pixel. `runs` tăng dần theo start nên
// candidate cuối cùng tìm được luôn là candidate lớn nhất (gần hi nhất).
function lastSafeRowInRange(runs: SafeRun[], lo: number, hi: number): number | null {
  let best: number | null = null;
  for (const r of runs) {
    if (r.start > hi) break; // run bắt đầu sau hi — run này và các run sau không thể overlap
    const rowEnd = r.end - 1; // hàng an toàn cuối cùng của run (end exclusive)
    if (rowEnd < lo) continue; // run kết thúc trước lo — bỏ qua
    best = Math.min(rowEnd, hi);
  }
  return best;
}

// Chọn danh sách điểm cắt (y tuyệt đối) bằng thuật toán tham lam: tại mỗi bước, xét cửa
// sổ (currentY+minBandHeight, currentY+maxBandHeight] — ưu tiên gutter (run an toàn dày
// ≥ minGutterHeight) dày nhất có tâm rơi trong cửa sổ; không có gutter đạt tư cách thì
// snap về hàng an toàn gần cuối cửa sổ nhất, hết cách thì ép cắt tại cuối cửa sổ.
export function chooseCuts(runs: SafeRun[], height: number, s: SplitSettings): number[] {
  const gutters = runs
    .filter((r) => r.end - r.start >= s.minGutterHeight)
    .map((r) => ({ center: Math.floor((r.start + r.end) / 2), thickness: r.end - r.start }));

  const cuts: number[] = [];
  let currentY = 0;
  while (height - currentY > s.maxBandHeight) {
    const lo = currentY + s.minBandHeight;
    const hi = currentY + s.maxBandHeight;
    const inWin = gutters.filter((g) => g.center > lo && g.center <= hi);
    let cutY: number;
    if (inWin.length > 0) {
      inWin.sort((a, b) => b.thickness - a.thickness || a.center - b.center);
      cutY = inWin[0].center;
    } else {
      cutY = lastSafeRowInRange(runs, lo, hi) ?? hi;
    }
    cuts.push(cutY);
    currentY = cutY;
  }
  return cuts;
}

// Danh sách cut → band full-width, liền mạch, phủ kín [0, height). Cuts rỗng → 1 band
// trọn canvas (canvas ≤ maxBandHeight).
export function regionsFromCuts(cuts: number[], width: number, height: number): BeatRegion[] {
  const regions: BeatRegion[] = [];
  let currentY = 0;
  for (const cut of cuts) {
    regions.push({ x: 0, y: currentY, w: width, h: cut - currentY });
    currentY = cut;
  }
  regions.push({ x: 0, y: currentY, w: width, h: height - currentY });
  return regions;
}

function regionInkDensity(img: GrayImage, r: BeatRegion): number {
  let ink = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    const row = y * img.width;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (img.data[row + x] < 250) ink++;
    }
  }
  return ink / (r.w * r.h);
}

// Nối `r` vào `carry` (carry null → khởi tạo carry mới từ r). Tách hàm riêng (thay vì
// ternary tự gán `carry = carry ? ... : ...` ngay trong loop) — mẫu đó khiến TS suy luận
// kiểu vòng lặp lẫn nhau giữa `carry` cũ/mới trong cùng khối lệnh (TS7022/TS2698).
function extendCarry(carry: BeatRegion | null, r: BeatRegion): BeatRegion {
  if (carry === null) return { ...r };
  return { x: 0, y: carry.y, w: carry.w, h: carry.h + r.h };
}

// Gộp band "non nội dung" vào band liền kề — một pass:
// 1) band có mật độ mực < minInkDensity gộp vào band liền TRƯỚC; band đầu tiên (không có
//    band trước) thì gộp về band liền SAU thay vì bị bỏ qua.
// 2) sau đó, nếu band cuối cùng thấp hơn minBandHeight thì gộp vào band liền trước (bất
//    kể mật độ mực — band cuối quá ngắn tự nó đã không đủ ngữ cảnh).
// Regions đầu vào phải liền mạch (contiguous) — kết quả cũng liền mạch, Σh giữ nguyên.
export function mergeLowInkBands(regions: BeatRegion[], img: GrayImage, s: SplitSettings): BeatRegion[] {
  if (regions.length <= 1) return regions.map((r) => ({ ...r }));

  const densities = regions.map((r) => regionInkDensity(img, r));
  const merged: BeatRegion[] = [];
  let carry: BeatRegion | null = null; // band đầu (hoặc chuỗi band đầu) mật độ thấp, chờ gộp về sau

  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (densities[i] < s.minInkDensity) {
      if (merged.length > 0) {
        const prev = merged[merged.length - 1];
        merged[merged.length - 1] = { ...prev, h: prev.h + r.h };
      } else {
        carry = extendCarry(carry, r);
      }
    } else {
      merged.push(extendCarry(carry, r));
      carry = null;
    }
  }
  if (carry) {
    // Toàn bộ regions mật độ thấp (không có band nào "bình thường" để gộp vào) — giữ 1 band.
    if (merged.length > 0) {
      const last = merged[merged.length - 1];
      merged[merged.length - 1] = { ...last, h: last.h + carry.h };
    } else {
      merged.push(carry);
    }
  }

  if (merged.length > 1 && merged[merged.length - 1].h < s.minBandHeight) {
    const last = merged.pop()!;
    const prev = merged[merged.length - 1];
    merged[merged.length - 1] = { ...prev, h: prev.h + last.h };
  }

  return merged;
}

// Canvas → band: gutter dày nhất trong cửa sổ hợp lệ → band liền mạch → gộp band non nội dung.
export function splitGray(img: GrayImage, s: SplitSettings): BeatRegion[] {
  const runs = computeSafeRuns(img, s);
  const cuts = chooseCuts(runs, img.height, s);
  const regions = regionsFromCuts(cuts, img.width, img.height);
  return mergeLowInkBands(regions, img, s);
}

export async function detectBands(
  canvas: Buffer,
  settings: SplitSettings = readSplitSettings(),
): Promise<BeatRegion[]> {
  const img = await toGray(canvas);
  return splitGray(img, settings);
}
