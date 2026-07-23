import { createJob, toJobStatusDTO } from '@/lib/jobs';
import {
  expandPdfs,
  extractImages,
  ingestBandItems,
  type BandItem,
  type RawImage,
} from '@/lib/pipeline';
import { createNdjsonStream } from '@/lib/ndjson-stream';
import { readVisionConfig, type VisionConfig } from '@/lib/vision';
import type { IngestProgress } from '@/lib/schema';

export const runtime = 'nodejs';

// Trả NDJSON stream: phát `{type:'progress', ...}` cho từng bước ingest (pha-2), kết thúc bằng
// `{type:'done', job}` (bằng JobStatusDTO cũ) hoặc `{type:'error', status, message}`. Client dùng
// XHR để đo thêm upload-bytes (pha-1). Response trả NGAY; pipeline chạy nền, ghi dần vào stream.
export async function POST(req: Request) {
  const { response, write, close } = createNdjsonStream();

  void (async () => {
    try {
      let config: VisionConfig;
      try {
        config = readVisionConfig();
      } catch (err) {
        write({
          type: 'error',
          status: 400,
          message: err instanceof Error ? err.message : 'Cấu hình vision không hợp lệ',
        });
        return;
      }

      // req.formData() buffer toàn bộ upload trước khi pha-2 chạy — thanh pha-1 (client đo tới
      // 100%) che quãng lặng này. KISS: không stream-parse multipart thủ công.
      const form = await req.formData();
      const zipField = form.get('zip');
      const imageFields = form.getAll('images');

      let uploaded: RawImage[] = [];
      for (const f of imageFields) {
        if (f instanceof File) {
          uploaded.push({ filename: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
        }
      }
      const zipBuffer =
        zipField instanceof File ? Buffer.from(await zipField.arrayBuffer()) : undefined;

      const onProgress = (p: IngestProgress) => write({ type: 'progress', ...p });

      // PDF upload trực tiếp → nở thành ảnh trang trước khi lọc/sắp xếp.
      try {
        uploaded = await expandPdfs(uploaded, onProgress);
      } catch (err) {
        write({
          type: 'error',
          status: 400,
          message: err instanceof Error ? err.message : 'Không xử lý được file PDF',
        });
        return;
      }

      let images: RawImage[];
      try {
        images = extractImages({ images: uploaded, zip: zipBuffer });
      } catch {
        write({ type: 'error', status: 400, message: 'Không đọc được file zip' });
        return;
      }
      if (images.length === 0) {
        write({
          type: 'error',
          status: 400,
          message: 'Không tìm thấy ảnh (.jpg/.jpeg/.png/.webp/.gif) hoặc PDF trong dữ liệu tải lên',
        });
        return;
      }

      // Gộp toàn bộ ảnh thành một canvas dọc rồi chia lại thành band tại khoảng an toàn —
      // item của job là band, không phải trang gốc (downscale nằm trong ingestBandItems).
      let items: BandItem[];
      try {
        items = await ingestBandItems(images, config.maxEdge, onProgress);
      } catch (err) {
        write({
          type: 'error',
          status: 400,
          message: err instanceof Error ? err.message : 'Không xử lý được ảnh tải lên',
        });
        return;
      }

      // KHÔNG gọi vision ở đây: job sinh ra ở phase 'ready' và đứng yên đó để client xem trước.
      // Vision (có rate limit) chạy ở Storyboard qua POST /api/jobs/{id}/storyboard/generate.
      const job = createJob(items);
      write({ type: 'done', job: toJobStatusDTO(job) });
    } catch (err) {
      write({
        type: 'error',
        status: 500,
        message: err instanceof Error ? err.message : 'Lỗi máy chủ khi xử lý upload',
      });
    } finally {
      close();
    }
  })();

  return response;
}
