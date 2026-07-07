import path from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import pLimit from 'p-limit';
import { getJob, setItemError, setItemResult, updateProgress } from './jobs';
import { renderPdf } from './pdf';
import { detectBands } from './smart-split';
import { readStripRatio } from './source-kind';
import { stitchSlices } from './stitch';
import { classifyError, describeImage } from './vision';

export interface RawImage {
  filename: string;
  buffer: Buffer;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
export const PDF_EXT = /\.pdf$/i;

// PDF upload trực tiếp → render từng trang thành RawImage TRƯỚC extractImages
// (extractImages lọc theo đuôi ảnh nên PDF phải nở ra trang ở đây). Tên trang đệm 0
// theo tổng số trang để natural sort giữ nguyên thứ tự đọc.
export async function expandPdfs(uploaded: RawImage[]): Promise<RawImage[]> {
  const out: RawImage[] = [];
  for (const file of uploaded) {
    if (!PDF_EXT.test(file.filename)) {
      out.push(file);
      continue;
    }
    const pages = await renderPdf(file.buffer);
    const base = path.basename(file.filename).replace(PDF_EXT, '');
    const pad = String(pages.length).length;
    pages.forEach((buffer, i) => {
      out.push({ filename: `${base}-p${String(i + 1).padStart(pad, '0')}.png`, buffer });
    });
  }
  return out;
}

// Thứ tự đọc là yêu cầu cứng: 1,2,…,9,10,11 (không phải 1,10,11,2).
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function isUsableImageName(filename: string): boolean {
  // Loại file ẩn/metadata (.DS_Store, AppleDouble ._x.jpg trong zip từ macOS)
  return IMAGE_EXT.test(filename) && !filename.startsWith('.');
}

export function extractImagesFromZip(zipBuffer: Buffer): RawImage[] {
  const zip = new AdmZip(zipBuffer);
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && isUsableImageName(path.basename(entry.entryName)))
    .map((entry) => ({ filename: path.basename(entry.entryName), buffer: entry.getData() }));
}

// Gom ảnh từ upload trực tiếp và/hoặc zip, rồi sắp theo natural sort tên file.
export function extractImages(input: { images?: RawImage[]; zip?: Buffer }): RawImage[] {
  const out: RawImage[] = [];
  if (input.zip) out.push(...extractImagesFromZip(input.zip));
  if (input.images) {
    out.push(
      ...input.images
        .map((img) => ({ ...img, filename: path.basename(img.filename) }))
        .filter((img) => isUsableImageName(img.filename)),
    );
  }
  return out.sort((a, b) => naturalCompare(a.filename, b.filename));
}

// Downscale MỘT LẦN lúc ingest; buffer JPEG này dùng chung cho vision + thumbnail + retry.
// Ảnh dải dọc (ratio ≥ STRIP_RATIO) chỉ kẹp BỀ RỘNG ≤ maxEdge, giữ nguyên chiều cao:
// fit-inside vuông sẽ nghiền slice 800×12000 thành 104×1568 — chữ nát, stitch/2A vô dụng.
// Payload gửi vision luôn được chặn lại lần nữa trong describeImage (fit-inside maxEdge).
export async function downscale(buffer: Buffer, maxEdge: number): Promise<Buffer> {
  const base = sharp(buffer).rotate(); // tôn trọng EXIF orientation
  const meta = await base.metadata();
  const isTall =
    meta.width && meta.height && meta.width > 0 && meta.height / meta.width >= readStripRatio();
  return base
    .resize(
      isTall
        ? { width: maxEdge, withoutEnlargement: true }
        : { width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true },
    )
    .jpeg({ quality: 80 })
    .toBuffer();
}

// Item của job sau ingest: MỘT band cắt từ canvas dài (kèm kích thước để khỏi đọc lại metadata).
export interface BandItem {
  filename: string;
  buffer: Buffer;
  mime: string;
  width: number;
  height: number;
}

// Ingest thống nhất cho MỌI upload: downscale từng ảnh → gộp toàn bộ thành MỘT canvas dọc
// → smart-split tìm khoảng an toàn (không cắt ngang bubble/chữ) → cắt lại thành từng band.
// Mỗi band là một "ảnh" của job từ đây trở đi (thumbnail, vision Stage 1, 1 nhịp storyboard)
// — biên trang gốc không còn quyết định biên nhịp, nên không cần tách/gộp tay ở storyboard.
export async function ingestBandItems(images: RawImage[], maxEdge: number): Promise<BandItem[]> {
  const limit = pLimit(4);
  const downscaled = await Promise.all(
    images.map((img) =>
      limit(async () => {
        try {
          return await downscale(img.buffer, maxEdge);
        } catch {
          // Ném kèm tên file — thà fail rõ ràng còn hơn lặng lẽ mất trang giữa chapter
          throw new Error(`Ảnh hỏng hoặc không đọc được: ${img.filename}`);
        }
      }),
    ),
  );
  const canvas = await stitchSlices(downscaled);
  const bands = await detectBands(canvas.buffer);
  const pad = String(bands.length).length;
  return Promise.all(
    bands.map((band, i) =>
      limit(async () => ({
        filename: `band-${String(i + 1).padStart(pad, '0')}.jpg`,
        buffer: await sharp(canvas.buffer, { limitInputPixels: false })
          .extract({ left: band.x, top: band.y, width: band.w, height: band.h })
          .jpeg({ quality: 80 })
          .toBuffer(),
        mime: 'image/jpeg',
        width: band.w,
        height: band.h,
      })),
    ),
  );
}

// Cổng nhịp: buộc các request vision bắt đầu cách nhau tối thiểu `minIntervalMs` — chặn 429
// theo giới hạn RPM của nhà cung cấp. Phần tính `nextStart` chạy đồng bộ (single-thread) trước
// mọi await nên nhiều task song song không tranh chấp: mỗi task nhận một mốc start riêng biệt.
// (Export cho compose storyboard 2A dùng chung.)
export function createPacer(minIntervalMs: number): () => Promise<void> {
  if (minIntervalMs <= 0) return async () => {};
  let nextStart = 0;
  return async () => {
    const now = Date.now();
    const start = Math.max(now, nextStart);
    nextStart = start + minIntervalMs;
    const wait = start - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
}

// Chạy vision cho toàn bộ item của job. Lỗi từng ảnh được cô lập vào item đó,
// không bao giờ làm sập cả job.
export async function processChapter(
  jobId: string,
  opts: { concurrency: number; minIntervalMs?: number },
): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;
  updateProgress(jobId, { phase: 'processing' });
  const limit = pLimit(opts.concurrency);
  const pace = createPacer(opts.minIntervalMs ?? 0);
  await Promise.all(
    job.items.map((item) =>
      limit(async () => {
        await pace(); // giãn nhịp trước khi gọi — vẫn nằm dưới trần concurrency của p-limit
        updateProgress(jobId, { currentIndex: item.index });
        try {
          const content = await describeImage(item.buffer, item.filename);
          setItemResult(jobId, item.index, content);
        } catch (err) {
          setItemError(jobId, item.index, classifyError(err));
        }
      }),
    ),
  );
  updateProgress(jobId, { phase: 'done', currentIndex: null });
}
