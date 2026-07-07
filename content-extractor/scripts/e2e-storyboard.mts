// E2E Stage 1 + 1.5 qua dev server + mock OpenAI vision (không tốn API thật).
// Cách chạy (Node 24):
//   1. node scripts/mock-openai-vision.mjs                      # mock vision :3106
//   2. PORT=3105 OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://localhost:3106/v1 \
//      VISION_MODEL=mock-vision VISION_RPM=600 SPLIT_HEIGHT=1000 npm run dev
//   3. npx tsx scripts/e2e-storyboard.mts                       # (E2E_BASE đổi được)
// Phủ: upload gộp ảnh dài + chia band + cô lập lỗi Stage 1 + storyboard 1 beat/band +
// sửa tay + Generate (vision) + reorder + export; smart-split né bubble ngay lúc upload;
// import từ manifest; PDF vào pipeline; split/merge đã gỡ (404).
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

// Đọc kích thước ảnh item qua API (ItemDTO không mang dims).
async function itemDims(imageUrl: string): Promise<{ w: number; h: number }> {
  const res = await fetch(`${BASE}${imageUrl}`);
  if (!res.ok) throw new Error(`${imageUrl} → HTTP ${res.status}`);
  const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  return { w: m.width!, h: m.height! };
}

// ============ A. UPLOAD GỘP + CHIA BAND → STAGE 1 → STORYBOARD ============
console.log('A. Upload 3 trang → gộp canvas 2700 → 3 band (SPLIT_HEIGHT=1000) → Stage 1 (band đen lỗi mock) → storyboard → edit → Generate → export');
{
  const fd = new FormData();
  fd.append('images', toBlob(await solidJpeg(600, 1000, 100), 'image/jpeg'), '1.jpg');
  // Trang đen tuyền → band giữa gần đen (marker mock LUÔN trả 500) → lỗi thật qua hết withRetry
  fd.append('images', toBlob(await solidJpeg(600, 1000, 0), 'image/jpeg'), '2.jpg');
  fd.append('images', toBlob(await solidJpeg(600, 700, 200), 'image/jpeg'), '10.jpg');
  const job = await api<any>('/api/jobs', { method: 'POST', body: fd });
  // Trang trơn → mọi hàng safe → cắt đúng target 1000/2000: band [1000, 1000, 700].
  eq(job.items.length, 3, 'gộp 2700px → 3 band');
  eq(
    job.items.map((it: any) => it.filename),
    ['band-1.jpg', 'band-2.jpg', 'band-3.jpg'],
    'item là band đánh số thứ tự',
  );
  const dims = await Promise.all(job.items.map((it: any) => itemDims(it.imageUrl)));
  eq(dims, [{ w: 600, h: 1000 }, { w: 600, h: 1000 }, { w: 600, h: 700 }], 'kích thước band khớp tính tay');

  // Stage 1 với mock (band 2 đen tuyền → lỗi vision bền qua retry)
  await api<any>(`/api/jobs/${job.jobId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpm: 600 }),
  });
  const doneJob = await pollJob(job.jobId, 120000);
  const errored = doneJob.items.filter((it: any) => it.error);
  eq(errored.length, 1, 'đúng 1 band lỗi vision (marker đen)');
  eq(errored[0]?.filename, 'band-2.jpg', 'band lỗi là band-2.jpg');

  // Storyboard: 1 band = 1 nhịp, narration pre-fill từ content Stage 1
  await api<any>(`/api/jobs/${job.jobId}/storyboard`, { method: 'POST' });
  const sb = await pollStoryboard(job.jobId);
  eq(sb.progress.phase, 'done', 'compose xong');
  eq(sb.sourceKind, 'pages', 'sourceKind pages (band)');
  eq(sb.beats.length, 3, 'mỗi band 1 nhịp');
  ok(sb.beats.every((b: any) => b.region === null), 'region null (trọn band)');
  const goodBeats = sb.beats.filter((b: any) => !b.error);
  const errBeats = sb.beats.filter((b: any) => b.error);
  eq(goodBeats.length, 2, '2 nhịp có narration');
  eq(errBeats.length, 1, '1 nhịp lỗi (band thiếu content) — job không sập');
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
  // Region vượt biên band (600×1000) → 400
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

  // Generate (vision) ghi đè bản sửa tay khi người dùng chủ động bấm
  const generated = await api<any>(
    `/api/jobs/${job.jobId}/storyboard/beats/${b0.id}/generate`,
    { method: 'POST' },
  );
  eq(generated.narration, MOCK_NARRATION, 'Generate → narration từ vision');
  // Generate trên band đen → mock luôn 500 → lỗi cô lập vào beat, không văng HTTP
  const black = sb.beats.find((b: any) => b.order === 1)!;
  const genErr = await api<any>(
    `/api/jobs/${job.jobId}/storyboard/beats/${black.id}/generate`,
    { method: 'POST' },
  );
  ok(!!genErr.error, 'Generate band marker → beat mang cờ lỗi (cô lập)');

  // Split/merge đã gỡ — path giờ rơi vào segment động [beatId] (chỉ có PATCH) → POST 405
  const splitRes = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/beats/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beatId: b0.id }),
  });
  eq(splitRes.status, 405, 'route split đã gỡ → 405 (rơi vào [beatId], không có POST)');
  const mergeRes = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/beats/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beatId: b0.id }),
  });
  eq(mergeRes.status, 405, 'route merge đã gỡ → 405 (rơi vào [beatId], không có POST)');

  // Reorder vẫn hoạt động
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
    manifest.beats.some((b: any) => b.narration === MOCK_NARRATION),
    'kết quả Generate phản ánh trong export',
  );
  ok(manifest.beats.every((b: any) => !('status' in b) && !('cropUrl' in b)), 'manifest không lộ field nội bộ');
}

// ============ B. SMART-SPLIT NÉ BUBBLE NGAY LÚC UPLOAD (webtoon) ============
console.log('B. 2 slice có bubble → upload chia band né bubble → storyboard → Generate từng nhịp → export');
let bandManifest: any;
let bubbleSlices: Buffer[];
{
  // 2 slice 400×1400. Canvas 400×2800. SPLIT_HEIGHT=1000 (env e2e):
  // bubble toàn cục y 950-1150 chặn target 1000 → cắt tại ~945 (dò lên từng 5px).
  bubbleSlices = [
    await bubbleSlice(400, 1400, [{ y: 950, h: 200 }]),
    await bubbleSlice(400, 1400, []),
  ];
  const fd = new FormData();
  fd.append('images', toBlob(bubbleSlices[0], 'image/png'), 'a1.png');
  fd.append('images', toBlob(bubbleSlices[1], 'image/png'), 'a2.png');
  const job = await api<any>('/api/jobs', { method: 'POST', body: fd });
  eq(job.items.length, 3, 'canvas 2800 → 3 band');
  // Ingest re-encode JPEG có thể xê dịch vị trí cắt vài px quanh mép bubble —
  // assert bất biến thuật toán thay vì số cứng: cắt NÉ bubble [950,1150),
  // cắt 1 ngay trên bubble (dò lên từ target 1000), cắt 2 = cắt 1 + SPLIT_HEIGHT (nền trắng).
  const dims = await Promise.all(job.items.map((it: any) => itemDims(it.imageUrl)));
  const cut1 = dims[0].h;
  const cut2 = cut1 + dims[1].h;
  ok(cut1 >= 900 && cut1 < 950, `cắt 1 (${cut1}) ngay trên bubble`);
  eq(cut2, cut1 + 1000, 'cắt 2 = cắt 1 + SPLIT_HEIGHT');
  eq(dims.reduce((s, d) => s + d.h, 0), 2800, 'band phủ kín canvas');
  ok(dims.every((d) => d.w === 400), 'band full-width');

  // Storyboard KHÔNG chạy Stage 1 trước → mọi nhịp thiếu content (lỗi), rồi Generate từng nhịp
  await api<any>(`/api/jobs/${job.jobId}/storyboard`, { method: 'POST' });
  const sb = await pollStoryboard(job.jobId);
  eq(sb.beats.length, 3, '3 nhịp');
  ok(
    sb.beats.every((b: any) => b.error && b.narration === ''),
    'chưa chạy Stage 1 → nhịp chờ Generate/điền tay',
  );
  for (const b of sb.beats) {
    const gen = await api<any>(`/api/jobs/${job.jobId}/storyboard/beats/${b.id}/generate`, {
      method: 'POST',
    });
    eq(gen.narration, MOCK_NARRATION, `Generate nhịp ${b.order} → narration mock`);
  }

  const exportRes = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/export`);
  bandManifest = await exportRes.json();
  eq(bandManifest.beatCount, 3, 'export 3 beats');
  ok(bandManifest.beats.every((b: any) => b.narration === MOCK_NARRATION), 'export sau Generate');
}

// ============ B2. IMPORT (nạp lại từ manifest + ảnh gốc) ============
console.log('B2. Import: manifest + 2 slice gốc → chia band tái lập → storyboard khớp');
{
  const fd = new FormData();
  fd.append(
    'manifest',
    toBlob(Buffer.from(JSON.stringify(bandManifest)), 'application/json'),
    'storyboard.json',
  );
  fd.append('images', toBlob(bubbleSlices[0], 'image/png'), 'a1.png');
  fd.append('images', toBlob(bubbleSlices[1], 'image/png'), 'a2.png');
  const dto = await api<any>('/api/storyboard/import', { method: 'POST', body: fd });
  ok(dto.jobId !== bandManifest.jobId, 'import tạo job mới');
  eq(dto.progress.phase, 'done', 'không compose lại — phase done');
  eq(dto.working.length, 3, 'working = 3 band tái lập từ ảnh gốc');
  eq(
    dto.beats.map((b: any) => [b.sourceIndex, b.narration]),
    bandManifest.beats.map((b: any) => [b.sourceIndex, b.narration]),
    'beats khớp manifest (sourceIndex + narration)',
  );
  const reExport = await (await fetch(`${BASE}/api/jobs/${dto.jobId}/storyboard/export`)).json();
  eq(
    reExport.beats.map((b: any) => [b.order, b.narration]),
    bandManifest.beats.map((b: any) => [b.order, b.narration]),
    're-export khớp manifest gốc',
  );

  // Import thiếu ảnh (beat trỏ band không tồn tại) → 400 rõ ràng, không dựng nửa vời
  const fdBad = new FormData();
  const badManifest = {
    ...bandManifest,
    beats: bandManifest.beats.map((b: any, i: number) => (i === 0 ? { ...b, sourceIndex: 99 } : b)),
  };
  fdBad.append(
    'manifest',
    toBlob(Buffer.from(JSON.stringify(badManifest)), 'application/json'),
    'storyboard.json',
  );
  fdBad.append('images', toBlob(bubbleSlices[0], 'image/png'), 'a1.png');
  const badRes = await fetch(`${BASE}/api/storyboard/import`, { method: 'POST', body: fdBad });
  eq(badRes.status, 400, 'import không khớp (sourceIndex vượt số band) → 400');
}

// ============ C. PDF ============
console.log('C. PDF: upload PDF 2 trang → render + gộp + chia band như ảnh');
{
  const fd = new FormData();
  fd.append('images', toBlob(buildPdf(), 'application/pdf'), 'chapter.pdf');
  const job = await api<any>('/api/jobs', { method: 'POST', body: fd });
  // 2 trang 200×300 render scale 2 → canvas 400×1200 → SPLIT_HEIGHT=1000 chia 1-2 band.
  ok(job.items.length >= 1, `PDF vào pipeline → ${job.items.length} band`);
  ok(
    job.items.every((it: any) => /^band-\d+\.jpg$/.test(it.filename)),
    'item PDF cũng là band',
  );
  const img = await fetch(`${BASE}${job.items[0].imageUrl}`);
  eq(img.status, 200, 'thumbnail band PDF 200');
}

console.log(failures === 0 ? '\nE2E_ALL_PASS' : `\nE2E_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
