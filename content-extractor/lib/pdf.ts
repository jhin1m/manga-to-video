import { pdf } from 'pdf-to-img';

// Render PDF → ảnh PNG từng trang (pdf-to-img = pdfjs + @napi-rs/canvas, đã verify Node 24).
// Scale 1 = 72dpi; 2 đủ nét để downscale MAX_EDGE phía sau không mất chữ.
export function readPdfScale(): number {
  const v = Number.parseFloat(process.env.PDF_SCALE ?? '');
  return Number.isFinite(v) && v > 0 ? v : 2;
}

export async function renderPdf(buffer: Buffer, opts?: { scale?: number }): Promise<Buffer[]> {
  const scale = opts?.scale ?? readPdfScale();
  let doc: Awaited<ReturnType<typeof pdf>>;
  try {
    // pdfjs yêu cầu Uint8Array "sạch" — không đưa thẳng Buffer.
    doc = await pdf(new Uint8Array(buffer), { scale });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Không đọc được file PDF: ${msg}`);
  }
  const pages: Buffer[] = [];
  for (let i = 1; i <= doc.length; i++) {
    // Render từng trang riêng để lỗi chỉ ra đúng trang hỏng — thà fail rõ ràng
    // còn hơn lặng lẽ mất trang giữa chapter (triết lý ingest Stage 1).
    try {
      pages.push(Buffer.from(await doc.getPage(i)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Không render được trang ${i}/${doc.length} của PDF: ${msg}`);
    }
  }
  return pages;
}
