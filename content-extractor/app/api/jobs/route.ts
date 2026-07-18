import { NextResponse } from 'next/server';
import { createJob, toJobStatusDTO } from '@/lib/jobs';
import {
  expandPdfs,
  extractImages,
  ingestBandItems,
  type BandItem,
  type RawImage,
} from '@/lib/pipeline';
import { readVisionConfig, type VisionConfig } from '@/lib/vision';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let config: VisionConfig;
  try {
    config = readVisionConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cấu hình vision không hợp lệ';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const form = await req.formData();
  const zipField = form.get('zip');
  const imageFields = form.getAll('images');

  let uploaded: RawImage[] = [];
  for (const f of imageFields) {
    if (f instanceof File) {
      uploaded.push({ filename: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
    }
  }
  const zipBuffer = zipField instanceof File ? Buffer.from(await zipField.arrayBuffer()) : undefined;

  // PDF upload trực tiếp → nở thành ảnh trang trước khi lọc/sắp xếp.
  try {
    uploaded = await expandPdfs(uploaded);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không xử lý được file PDF';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let images: RawImage[];
  try {
    images = extractImages({ images: uploaded, zip: zipBuffer });
  } catch {
    return NextResponse.json({ error: 'Không đọc được file zip' }, { status: 400 });
  }
  if (images.length === 0) {
    return NextResponse.json(
      { error: 'Không tìm thấy ảnh (.jpg/.jpeg/.png/.webp/.gif) hoặc PDF trong dữ liệu tải lên' },
      { status: 400 },
    );
  }

  // Gộp toàn bộ ảnh thành một canvas dọc rồi chia lại thành band tại khoảng an toàn —
  // item của job là band, không phải trang gốc (downscale nằm trong ingestBandItems).
  let items: BandItem[];
  try {
    items = await ingestBandItems(images, config.maxEdge);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không xử lý được ảnh tải lên';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // KHÔNG gọi vision ở đây: job sinh ra ở phase 'ready' và đứng yên đó để client xem trước.
  // Vision (có rate limit) chạy ở Storyboard qua POST /api/jobs/{id}/storyboard/generate.
  const job = createJob(items);
  return NextResponse.json(toJobStatusDTO(job));
}
