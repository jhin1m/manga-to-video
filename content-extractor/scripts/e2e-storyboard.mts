// E2E Stage 1.5 qua dev server + mock OpenAI vision (không tốn API thật).
// Cách chạy (Node 24):
//   1. node scripts/mock-openai-vision.mjs                      # mock vision :3106
//   2. PORT=3105 OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://localhost:3106/v1 \
//      VISION_MODEL=mock-vision VISION_RPM=600 SPLIT_HEIGHT=1000 npm run dev
//   3. npx tsx scripts/e2e-storyboard.mts                       # (E2E_BASE đổi được)
// Phủ: pages (manga) + cô lập lỗi beat + sửa tay + split/merge/reorder + export;
// strip (webtoon) stitch + smart-split + 2A + retry + import; PDF vào pipeline.
import sharp from 'sharp';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3105';
let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}: ${(data as { error?: string })?.error}`);
  }
  return data as T;
}

async function pollStoryboard(jobId: string, timeoutMs = 60000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const dto = await api<any>(`/api/jobs/${jobId}/storyboard`);
    if (dto.progress.phase === 'done' || dto.progress.phase === 'failed') return dto;
    if (Date.now() - start > timeoutMs) throw new Error('Storyboard quá thời gian chờ');
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function pollJob(jobId: string, timeoutMs = 60000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const dto = await api<any>(`/api/jobs/${jobId}`);
    if (dto.progress.phase === 'done' || dto.progress.phase === 'failed') return dto;
    if (Date.now() - start > timeoutMs) throw new Error('Job quá thời gian chờ');
    await new Promise((r) => setTimeout(r, 500));
  }
}

function toBlob(buf: Buffer, type: string): Blob {
  return new Blob([new Uint8Array(buf)], { type });
}

async function solidJpeg(w: number, h: number, gray: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: gray, g: gray, b: gray } } })
    .jpeg()
    .toBuffer();
}

// Slice trắng có "bubble" đen (rect không tràn bề ngang) tại dải y cho trước.
async function bubbleSlice(w: number, h: number, bubbles: Array<{ y: number; h: number }>): Promise<Buffer> {
  const composites = await Promise.all(
    bubbles.map(async (b) => ({
      input: await sharp({
        create: { width: Math.floor(w / 2), height: b.h, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
      left: Math.floor(w / 4),
      top: b.y,
    })),
  );
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(composites)
    .png()
    .toBuffer();
}

function buildPdf(): Buffer {
  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [];
  let pos = chunks[0].length;
  const push = (s: string) => {
    chunks.push(s);
    pos += s.length;
  };
  const addObj = (num: number, body: string) => {
    offsets[num] = pos;
    push(`${num} 0 obj\n${body}\nendobj\n`);
  };
  const s1 = '0 0 0 rg 20 20 100 100 re f';
  const s2 = '1 0 0 rg 50 150 80 80 re f';
  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObj(2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  addObj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 4 0 R >>');
  addObj(4, `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`);
  addObj(5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 6 0 R >>');
  addObj(6, `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`);
  const xrefPos = pos;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return Buffer.from(chunks.join(''), 'latin1');
}

const MOCK_NARRATION = 'Cảnh mock.\n"Thoại mock."';

// ============ A. PAGES (manga trang rời) ============
console.log('A. Pages: upload 3 trang → Stage 1 (1 lỗi mock) → storyboard → edit → export');
{
  const fd = new FormData();
  fd.append('images', toBlob(await solidJpeg(600, 900, 100), 'image/jpeg'), '1.jpg');
  // 601px = marker cho mock LUÔN trả 500 → trang này lỗi thật (qua hết withRetry)
  fd.append('images', toBlob(await solidJpeg(601, 900, 150), 'image/jpeg'), '2.jpg');
  fd.append('images', toBlob(await solidJpeg(600, 900, 200), 'image/jpeg'), '10.jpg');
  const job = await api<any>('/api/jobs', { method: 'POST', body: fd });
  eq(job.items.length, 3, 'job 3 trang');
  eq(
    job.items.map((it: any) => it.filename),
    ['1.jpg', '2.jpg', '10.jpg'],
    'natural sort 1,2,10',
  );

  // Stage 1 với mock (trang 2.jpg marker → lỗi vision bền qua retry)
  await api<any>(`/api/jobs/${job.jobId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpm: 600 }),
  });
  const doneJob = await pollJob(job.jobId, 120000);
  const errored = doneJob.items.filter((it: any) => it.error);
  eq(errored.length, 1, 'đúng 1 trang lỗi vision (marker)');
  eq(errored[0]?.filename, '2.jpg', 'trang lỗi là 2.jpg');

  // Storyboard pages
  await api<any>(`/api/jobs/${job.jobId}/storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceKind: 'pages' }),
  });
  const sb = await pollStoryboard(job.jobId);
  eq(sb.progress.phase, 'done', 'compose xong');
  eq(sb.sourceKind, 'pages', 'sourceKind pages');
  eq(sb.beats.length, 3, 'mỗi trang 1 nhịp');
  ok(sb.beats.every((b: any) => b.region === null), 'region null (cả trang)');
  const goodBeats = sb.beats.filter((b: any) => !b.error);
  const errBeats = sb.beats.filter((b: any) => b.error);
  eq(goodBeats.length, 2, '2 nhịp có narration');
  eq(errBeats.length, 1, '1 nhịp lỗi (trang thiếu content) — job không sập');
  ok(
    goodBeats.every((b: any) => b.narration === MOCK_NARRATION),
    'narration = template mô tả + thoại',
  );
  ok(
    goodBeats.every((b: any) => JSON.stringify(b.sourceDialogue) === JSON.stringify(['Thoại mock.'])),
    'sourceDialogue truy vết',
  );

  // Sửa tay nhịp lỗi → hết lỗi
  const fixed = await api<any>(`/api/jobs/${job.jobId}/storyboard/beats/${errBeats[0].id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ narration: 'Tự điền lời đọc.' }),
  });
  ok(!fixed.error, 'PATCH narration xoá cờ lỗi');
  eq(fixed.durationHint, Math.ceil('Tự điền lời đọc.'.length / 15), 'durationHint tính lại');

  // Sửa region + narration
  const b0 = sb.beats.find((b: any) => b.order === 0)!;
  const edited = await api<any>(`/api/jobs/${job.jobId}/storyboard/beats/${b0.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ narration: 'Lời đọc mới dài hơn một chút.', region: { x: 0, y: 100, w: 600, h: 400 } }),
  });
  eq(edited.region, { x: 0, y: 100, w: 600, h: 400 }, 'PATCH region hợp lệ');
  // Region vượt biên → 400
  const bad = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/beats/${b0.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ region: { x: 0, y: 700, w: 600, h: 400 } }),
  });
  eq(bad.status, 400, 'region vượt biên → 400');

  // Crop preview
  const crop = await fetch(`${BASE}${edited.cropUrl}`);
  eq(crop.status, 200, 'crop preview 200');
  eq(crop.headers.get('content-type'), 'image/jpeg', 'crop là JPEG');
  const cropMeta = await sharp(Buffer.from(await crop.arrayBuffer())).metadata();
  eq({ w: cropMeta.width, h: cropMeta.height }, { w: 600, h: 400 }, 'crop đúng kích thước region');

  // Split → 4 nhịp; merge lại → 3; reorder
  const afterSplit = await api<any>(`/api/jobs/${job.jobId}/storyboard/beats/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beatId: b0.id }),
  });
  eq(afterSplit.beats.length, 4, 'split → 4 nhịp');
  eq(
    afterSplit.beats.map((b: any) => b.order),
    [0, 1, 2, 3],
    'order liền mạch sau split',
  );
  const half1 = afterSplit.beats.find((b: any) => b.id === b0.id);
  const half2 = afterSplit.beats.find((b: any) => b.order === 1);
  eq(half1.region, { x: 0, y: 100, w: 600, h: 200 }, 'nửa trên giữ y, h/2');
  eq(half2.region, { x: 0, y: 300, w: 600, h: 200 }, 'nửa dưới nối tiếp');
  const afterMerge = await api<any>(`/api/jobs/${job.jobId}/storyboard/beats/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beatId: b0.id }),
  });
  eq(afterMerge.beats.length, 3, 'merge → 3 nhịp');
  eq(
    afterMerge.beats.find((b: any) => b.id === b0.id).region,
    { x: 0, y: 100, w: 600, h: 400 },
    'merge nối lại region bao',
  );
  const afterReorder = await api<any>(`/api/jobs/${job.jobId}/storyboard/beats/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beatId: b0.id, to: 2 }),
  });
  eq(afterReorder.beats.find((b: any) => b.id === b0.id).order, 2, 'reorder tới vị trí 2');
  eq(
    afterReorder.beats.map((b: any) => b.order),
    [0, 1, 2],
    'order liền mạch sau reorder',
  );

  // Export
  const exportRes = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/export`);
  eq(exportRes.status, 200, 'export 200');
  ok(
    (exportRes.headers.get('content-disposition') ?? '').startsWith('attachment'),
    'export là attachment',
  );
  const manifest = await exportRes.json();
  eq(manifest.version, 1, 'manifest version 1');
  eq(manifest.sourceKind, 'pages', 'manifest sourceKind');
  eq(manifest.beatCount, 3, 'beatCount khớp');
  eq(
    manifest.beats.map((b: any) => b.order),
    [0, 1, 2],
    'beats xếp theo order',
  );
  ok(
    manifest.beats.some((b: any) => b.narration === 'Lời đọc mới dài hơn một chút.'),
    'sửa tay phản ánh trong export',
  );
  ok(manifest.beats.every((b: any) => !('status' in b) && !('cropUrl' in b)), 'manifest không lộ field nội bộ');
}

// ============ B. STRIP (webtoon dải dọc) ============
console.log('B. Strip: 2 slice có bubble → stitch + smart-split né bubble → 2A → retry → export → import');
let stripManifest: any;
let stripSlices: Buffer[];
{
  // 2 slice 400×1400 (ratio 3.5 → strip). Canvas 400×2800. SPLIT_HEIGHT=1000 (env e2e):
  // bubble toàn cục y 950-1150 chặn target 1000 → cắt tại 945 (dò lên từng 5px).
  stripSlices = [
    await bubbleSlice(400, 1400, [{ y: 950, h: 200 }]),
    await bubbleSlice(400, 1400, []),
  ];
  const fd = new FormData();
  fd.append('images', toBlob(stripSlices[0], 'image/png'), 'a1.png');
  fd.append('images', toBlob(stripSlices[1], 'image/png'), 'a2.png');
  const job = await api<any>('/api/jobs', { method: 'POST', body: fd });
  eq(job.items.length, 2, 'job 2 slice');

  await api<any>(`/api/jobs/${job.jobId}/storyboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpm: 600 }),
  });
  const sb = await pollStoryboard(job.jobId);
  eq(sb.sourceKind, 'strip', 'auto phân loại strip (ratio 3.5)');
  eq(sb.working.length, 1, '1 working canvas (đã stitch)');
  eq({ w: sb.working[0].width, h: sb.working[0].height }, { w: 400, h: 2800 }, 'canvas 400×2800');
  // Ingest re-encode JPEG có thể xê dịch vị trí cắt vài px quanh mép bubble —
  // assert bất biến thuật toán thay vì số cứng: 3 band, cắt NÉ bubble [950,1150),
  // cắt 1 ngay trên bubble (dò lên từ target 1000), cắt 2 = cắt 1 + SPLIT_HEIGHT (nền trắng).
  eq(sb.beats.length, 3, '3 band');
  const cuts = sb.beats.slice(1).map((b: any) => b.region.y);
  ok(
    cuts.every((y: number) => y < 950 || y >= 1150),
    `điểm cắt ${JSON.stringify(cuts)} không xuyên bubble [950,1150)`,
  );
  ok(cuts[0] >= 900 && cuts[0] < 950, 'cắt 1 ngay trên bubble (dò lên từ target 1000)');
  eq(cuts[1], cuts[0] + 1000, 'cắt 2 = cắt 1 + SPLIT_HEIGHT');
  ok(
    sb.beats.every(
      (b: any, i: number) =>
        b.region.x === 0 &&
        b.region.w === 400 &&
        (i === 0 ? b.region.y === 0 : true) &&
        (i === sb.beats.length - 1 ? b.region.y + b.region.h === 2800 : true),
    ),
    'band full-width, phủ kín canvas',
  );
  ok(
    sb.beats.every((b: any) => b.narration === MOCK_NARRATION && !b.error),
    '2A: mỗi band re-extract qua mock vision',
  );

  // Retry 1 beat strip → vẫn compose lại được
  const retried = await api<any>(
    `/api/jobs/${job.jobId}/storyboard/beats/${sb.beats[0].id}/retry`,
    { method: 'POST' },
  );
  eq(retried.narration, MOCK_NARRATION, 'retry beat strip → narration mock');

  const exportRes = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/export`);
  stripManifest = await exportRes.json();
  eq(stripManifest.sourceKind, 'strip', 'export strip');
  eq(stripManifest.beatCount, 3, 'export 3 beats');
}

// ============ B2. IMPORT (nạp lại strip từ manifest + ảnh) ============
console.log('B2. Import: manifest strip + 2 slice → storyboard mới khớp');
{
  const fd = new FormData();
  fd.append(
    'manifest',
    toBlob(Buffer.from(JSON.stringify(stripManifest)), 'application/json'),
    'storyboard.json',
  );
  fd.append('images', toBlob(stripSlices[0], 'image/png'), 'a1.png');
  fd.append('images', toBlob(stripSlices[1], 'image/png'), 'a2.png');
  const dto = await api<any>('/api/storyboard/import', { method: 'POST', body: fd });
  ok(dto.jobId !== stripManifest.jobId, 'import tạo job mới');
  eq(dto.sourceKind, 'strip', 'giữ sourceKind');
  eq(dto.progress.phase, 'done', 'không compose lại — phase done');
  eq(
    dto.beats.map((b: any) => [b.region.y, b.region.h, b.narration]),
    stripManifest.beats.map((b: any) => [b.region.y, b.region.h, b.narration]),
    'beats khớp manifest (region + narration)',
  );
  const reExport = await (await fetch(`${BASE}/api/jobs/${dto.jobId}/storyboard/export`)).json();
  eq(
    reExport.beats.map((b: any) => [b.order, b.narration]),
    stripManifest.beats.map((b: any) => [b.order, b.narration]),
    're-export khớp manifest gốc',
  );

  // Import thiếu ảnh → 400 rõ ràng, không dựng nửa vời
  const fdBad = new FormData();
  const pagesManifest = { ...stripManifest, sourceKind: 'pages' };
  fdBad.append(
    'manifest',
    toBlob(Buffer.from(JSON.stringify(pagesManifest)), 'application/json'),
    'storyboard.json',
  );
  fdBad.append('images', toBlob(stripSlices[0], 'image/png'), 'a1.png'); // pages cần index 0 duy nhất nhưng region vượt biên trang
  const badRes = await fetch(`${BASE}/api/storyboard/import`, { method: 'POST', body: fdBad });
  eq(badRes.status, 400, 'import không khớp (region vượt biên trang đơn) → 400');
}

// ============ C. PDF ============
console.log('C. PDF: upload PDF 2 trang → vào pipeline như ảnh');
{
  const fd = new FormData();
  fd.append('images', toBlob(buildPdf(), 'application/pdf'), 'chapter.pdf');
  const job = await api<any>('/api/jobs', { method: 'POST', body: fd });
  eq(job.items.length, 2, 'PDF 2 trang → 2 item');
  eq(
    job.items.map((it: any) => it.filename),
    ['chapter-p1.png', 'chapter-p2.png'],
    'tên trang đúng thứ tự',
  );
  const img = await fetch(`${BASE}${job.items[0].imageUrl}`);
  eq(img.status, 200, 'thumbnail trang PDF 200');
}

console.log(failures === 0 ? '\nE2E_ALL_PASS' : `\nE2E_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
