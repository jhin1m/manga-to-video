import sharp from 'sharp';
import type { BeatRegion } from './schema';

// Port thuật toán SmartStitch từ jhin1m/manhwa-sticher (src-tauri/src/lib.rs, MIT) — Rust → TS/sharp.
// Tìm "safe-line" (hàng ngang không đè bubble/SFX/hình) để cắt canvas dải dọc thành band.
// Giữ NGUYÊN hành vi gốc: tìm hai chiều (lên trước, xuống sau), khoảng cách tối thiểu
// theo % split_height, fallback cắt tại target_y khi không có safe-line.

export interface SplitSettings {
  splitHeight: number; // chiều cao band mục tiêu (px trên canvas làm việc)
  scanLineStep: number; // bước nhảy khi dò safe-line
  lineTolerance: number; // chênh lệch pixel liền kề tối đa của hàng "an toàn" (0-255)
  minDistancePct: number; // khoảng cách tối thiểu giữa 2 điểm cắt, % của splitHeight
  ignorableBorder: number; // bỏ qua N px sát mép trái/phải khi xét hàng (viền/watermark)
}

// Defaults = repo gốc TRỪ splitHeight: repo cắt file webtoon (5000px), còn ở đây band là
// một "nhịp" video và sẽ được downscale ≤ MAX_EDGE trước khi gửi vision — band quá cao
// làm chữ nát khi thu nhỏ. 1600 ≈ 2× bề rộng slice phổ biến (800px), giữ chữ đọc được.
function envInt(name: string, fallback: number, min = 1): number {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

export function readSplitSettings(): SplitSettings {
  return {
    splitHeight: envInt('SPLIT_HEIGHT', 1600),
    scanLineStep: envInt('SCAN_LINE_STEP', 5),
    lineTolerance: envInt('LINE_TOLERANCE', 25, 0),
    minDistancePct: envInt('MIN_DISTANCE_PCT', 40),
    ignorableBorder: envInt('IGNORABLE_BORDER', 5, 0),
  };
}

export interface GrayImage {
  data: Uint8Array; // grayscale, row-major
  width: number;
  height: number;
}

// Grayscale theo đúng công thức integer của repo gốc: (299R + 587G + 114B) / 1000 —
// KHÔNG dùng sharp.greyscale() (libvips dùng hệ số khác, có thể lệch safe-line biên).
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

// Tìm điểm cắt gần target_y: dò LÊN trước theo scanLineStep, chạm biên thì dò XUỐNG;
// chỉ nhận safe-line cách điểm cắt trước ≥ minDistance. Hết lượt → fallback target_y.
export function findSplitPosition(
  img: GrayImage,
  targetY: number,
  lastSplitY: number,
  s: SplitSettings,
): number {
  const maxAttempts = 1000;
  let attempts = 0;
  let currentY = targetY;
  let moveUp = true;
  const minDistance = Math.floor((s.splitHeight * s.minDistancePct) / 100);

  while (attempts < maxAttempts) {
    if (currentY >= img.height) break;
    if (currentY <= lastSplitY) break;

    if (isSafeLine(img, currentY, s) && currentY - lastSplitY >= minDistance) {
      return currentY;
    }

    // Quá gần điểm cắt trước (< minDistance) → reset về lastSplit + splitHeight, dò xuống.
    if (currentY - lastSplitY < minDistance) {
      currentY = lastSplitY + s.splitHeight;
      moveUp = false;
      continue;
    }

    if (moveUp) {
      if (currentY <= s.scanLineStep) {
        currentY = targetY; // chạm đỉnh — quay về target, đổi chiều xuống
        moveUp = false;
      } else {
        currentY -= s.scanLineStep;
      }
    } else {
      currentY += s.scanLineStep;
    }
    attempts++;
  }

  // Fallback: ép cắt tại target_y — giữ đúng chiều cao dự kiến thay vì vị trí tuỳ ý.
  return Math.min(targetY, img.height - 1);
}

// Canvas → danh sách band (full-width, chồng khít theo y). Canvas thấp hơn splitHeight → 1 band.
export function splitGray(img: GrayImage, s: SplitSettings): BeatRegion[] {
  const regions: BeatRegion[] = [];
  let currentY = 0;
  while (currentY < img.height) {
    const targetY = currentY + s.splitHeight;
    const splitY = targetY >= img.height ? img.height : findSplitPosition(img, targetY, currentY, s);
    const h = splitY - currentY;
    if (h <= 0) break; // chặn vòng lặp vô hạn (khớp repo gốc)
    regions.push({ x: 0, y: currentY, w: img.width, h });
    currentY = splitY;
  }
  return regions;
}

export async function detectBands(
  canvas: Buffer,
  settings: SplitSettings = readSplitSettings(),
): Promise<BeatRegion[]> {
  const img = await toGray(canvas);
  return splitGray(img, settings);
}
