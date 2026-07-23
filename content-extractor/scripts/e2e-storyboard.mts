// E2E nhận chapter + storyboard qua dev server + mock OpenAI vision (không tốn API thật).
// Cách chạy (Node 24):
//   1. node scripts/mock-openai-vision.mjs                      # mock vision :3106
//   2. PORT=3105 OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://localhost:3106/v1 \
//      VISION_MODEL=mock-vision VISION_RPM=600 SPLIT_HEIGHT=1000 \
//      SETTINGS_FILE=/dev/null npm run dev
//      (SETTINGS_FILE=/dev/null: không ăn .settings.json của dev — e2e phải chạy ENV thuần)
//   3. npx tsx scripts/e2e-storyboard.mts                       # (E2E_BASE đổi được)
// Phủ: upload gộp ảnh dài + chia band → storyboard beats pending sạch → Generate all
// (batch vision, lỗi cô lập từng nhịp, không đè bản sửa tay) + Generate lẻ + sửa tay +
// reorder + lưu/mở project .mtvproj (không re-ingest); PDF vào pipeline; route Stage 1
// cũ (/run, /export) đã gỡ → 404.
import AdmZip from 'adm-zip';
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

// POST /api/jobs giờ trả NDJSON (dòng progress + dòng done cuối) — đọc trọn rồi lấy job.
async function postJob(fd: FormData): Promise<any> {
  const res = await fetch(`${BASE}/api/jobs`, { method: 'POST', body: fd });
  const lines = (await res.text())
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; status?: number; message?: string; job?: any });
  const err = lines.find((l) => l.type === 'error');
  if (err) throw new Error(`/api/jobs → ${err.status}: ${err.message}`);
  const done = lines.find((l) => l.type === 'done');
  if (!done) throw new Error('/api/jobs → thiếu dòng done');
  return done.job;
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

function toBlob(buf: Buffer, type: string): Blob {
  return new Blob([new Uint8Array(buf)], { type });
}

async function solidJpeg(w: number, h: number, gray: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: gray, g: gray, b: gray } } })
    .jpeg()
    .toBuffer();
}

// Khối sọc dọc: cột đen rộng ~cell×inkRatio, lặp mỗi cell px trên nền trắng. MỌI hàng
// đều "unsafe" (có bước nhảy màu tại biên cột) → thuật toán band mới KHÔNG cắt trong lòng
// khối và KHÔNG gộp nó (đủ mực). Dùng làm band XÁC ĐỊNH: inkRatio 0.5 ≈ mean 127 (marker
// LỖI của mock), 0.25-0.3 ≈ mean ~180-190 (mock trả scene).
async function stripes(w: number, h: number, inkRatio: number, cell = 20): Promise<Buffer> {
  const black = Math.max(1, Math.round(cell * inkRatio));
  const cols: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let x = 0; x < w; x += cell) {
    cols.push({
      input: await sharp({
        create: { width: Math.min(black, w - x), height: h, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
      left: x,
      top: 0,
    });
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(cols)
    .png()
    .toBuffer();
}

// Trang = khối sọc (h px) + gutter trắng dưới (gutter px). Gutter là "khoảng an toàn" dày
// giữa hai khối sọc để thuật toán có chỗ cắt; band vẫn do sọc chi phối nên marker mean ăn đúng.
async function stripePage(w: number, h: number, inkRatio: number, gutter = 40): Promise<Buffer> {
  const block = await stripes(w, h, inkRatio);
  return sharp({ create: { width: w, height: h + gutter, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: block, left: 0, top: 0 }])
    .jpeg()
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

// ============ A. UPLOAD GỘP + CHIA BAND → STORYBOARD → GENERATE ALL ============
console.log('A. Upload 3 khối sọc (thưa/đậm/thưa) → gộp + chia gutter → 3 band → storyboard pending sạch → Generate all (band sọc-đậm lỗi mock) → edit → Generate lẻ → export');
{
  // 3 trang = khối sọc 600×900 + gutter 40 (canvas 600×2820). Thuật toán gutter cắt trong
  // gutter → mỗi khối 1 band. Khối giữa sọc 50% (mean ~127) → marker LỖI; hai khối ngoài
  // sọc 25% (mean ~191) → mock trả scene.
  const fd = new FormData();
  fd.append('images', toBlob(await stripePage(600, 900, 0.25), 'image/jpeg'), '1.jpg');
  fd.append('images', toBlob(await stripePage(600, 900, 0.5), 'image/jpeg'), '2.jpg');
  fd.append('images', toBlob(await stripePage(600, 900, 0.25), 'image/jpeg'), '10.jpg');
  const job = await postJob(fd);
  eq(job.items.length, 3, 'gộp canvas → 3 band (mỗi khối sọc 1 band)');
  eq(
    job.items.map((it: any) => it.filename),
    ['band-1.jpg', 'band-2.jpg', 'band-3.jpg'],
    'item là band đánh số thứ tự',
  );
  const dims = await Promise.all(job.items.map((it: any) => itemDims(it.imageUrl)));
  // Vị trí cắt tuỳ thuật toán (biên gutter) → assert BẤT BIẾN thay vì số cứng: band full-width,
  // phủ kín canvas, mỗi band đủ cao để mang ngữ cảnh (≥ minBandHeight môi trường e2e không đặt,
  // suy từ SPLIT_HEIGHT=1000 → 600).
  eq(dims.reduce((s, d) => s + d.h, 0), 2820, 'band phủ kín canvas 2820');
  ok(dims.every((d) => d.w === 600), 'band full-width 600');
  ok(dims.every((d) => d.h >= 600), 'mỗi band ≥ minBandHeight (đủ ngữ cảnh)');

  // Route batch Stage 1 cũ đã gỡ — batch vision giờ nằm ở storyboard/generate
  const runGone = await fetch(`${BASE}/api/jobs/${job.jobId}/run`, { method: 'POST' });
  eq(runGone.status, 404, 'route /run cũ đã gỡ → 404');

  // Storyboard từ job CHƯA có content → beats pending SẠCH, phase done (không compose mù)
  await api<any>(`/api/jobs/${job.jobId}/storyboard`, { method: 'POST' });
  let sb = await pollStoryboard(job.jobId);
  eq(sb.progress.phase, 'done', 'tạo storyboard xong (không compose khi chưa có content)');
  eq(sb.sourceKind, 'pages', 'sourceKind pages (band)');
  eq(sb.beats.length, 3, 'mỗi band 1 nhịp');
  // Auto-region né bubble: null = full band, hoặc {x,y,w,h} hợp lệ trong biên ảnh.
  ok(
    sb.beats.every((b: any) => {
      if (b.region === null) return true;
      const r = b.region;
      return (
        r &&
        typeof r.x === 'number' &&
        typeof r.y === 'number' &&
        typeof r.w === 'number' &&
        typeof r.h === 'number' &&
        r.w > 0 &&
        r.h > 0
      );
    }),
    'region null (full) hoặc bbox né bubble hợp lệ',
  );
  ok(
    sb.beats.every((b: any) => !b.error && b.narration === ''),
    'fresh chapter → nhịp pending sạch, KHÔNG lỗi "Nội dung trống"',
  );

  // Generate all: batch vision mọi nhịp pending/error (band sọc-đậm → lỗi cô lập vào nhịp)
  await api<any>(`/api/jobs/${job.jobId}/storyboard/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpm: 600 }),
  });
  sb = await pollStoryboard(job.jobId, 120000);
  eq(sb.progress.phase, 'done', 'Generate all xong');
  const goodBeats = sb.beats.filter((b: any) => !b.error);
  const errBeats = sb.beats.filter((b: any) => b.error);
  eq(goodBeats.length, 2, '2 nhịp có narration từ vision');
  eq(errBeats.length, 1, '1 nhịp lỗi (band marker) — cô lập, job không sập');
  eq(errBeats[0]?.sourceIndex, 1, 'nhịp lỗi là band sọc-đậm (band-2)');
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

  // Generate all lần 2: không còn nhịp pending/error → bản sửa tay KHÔNG bị đè
  await api<any>(`/api/jobs/${job.jobId}/storyboard/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpm: 600 }),
  });
  const sbRerun = await pollStoryboard(job.jobId);
  eq(
    sbRerun.beats.find((b: any) => b.id === errBeats[0].id)?.narration,
    'Tự điền lời đọc.',
    'Generate all không đè nhịp đã sửa tay',
  );

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
  // Generate trên band sọc-đậm (marker) → mock luôn 500 → lỗi cô lập vào beat, không văng HTTP
  const markerBeat = sb.beats.find((b: any) => b.order === 1)!;
  const genErr = await api<any>(
    `/api/jobs/${job.jobId}/storyboard/beats/${markerBeat.id}/generate`,
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

  // Lưu project .mtvproj (thay export storyboard JSON cũ) — route cũ phải đã gỡ
  const oldExport = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/export`);
  eq(oldExport.status, 404, 'route export storyboard cũ đã gỡ → 404');
  const jobExportGone = await fetch(`${BASE}/api/jobs/${job.jobId}/export`);
  eq(jobExportGone.status, 404, 'route Export JSON standalone đã gỡ → 404');
  const exportRes = await fetch(`${BASE}/api/project/export?jobId=${job.jobId}`);
  eq(exportRes.status, 200, 'export project 200');
  ok(
    (exportRes.headers.get('content-disposition') ?? '').includes('.mtvproj'),
    'export là attachment .mtvproj',
  );
  const zip = new AdmZip(Buffer.from(await exportRes.arrayBuffer()));
  const projectJson = JSON.parse(zip.getEntry('project.json')!.getData().toString('utf8'));
  eq(projectJson.version, 1, 'project.json version 1');
  eq(projectJson.working.length, 3, 'project.json meta 3 ảnh working');
  ok(
    [0, 1, 2].every((i) => !!zip.getEntry(`working/${i}.jpg`) && !!zip.getEntry(`items/band-${i}.jpg`)),
    'ảnh working + band embed đủ trong zip',
  );
  const manifest = JSON.parse(zip.getEntry('storyboard.json')!.getData().toString('utf8'));
  eq(manifest.version, 1, 'storyboard.json version 1');
  eq(manifest.sourceKind, 'pages', 'storyboard.json sourceKind');
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
console.log('B. 2 khối sọc webtoon → upload cắt trong gutter (né nội dung) → storyboard → Generate từng nhịp → lưu project');
let bandManifest: any;
let projectZip: Buffer;
let bandCount: number;
{
  // 2 khối sọc 400×900 + gutter 40 (canvas 400×1880). Thuật toán cắt trong gutter trắng
  // [900,940) giữa hai khối → KHÔNG cắt xuyên khối sọc (nội dung). inkRatio 0.3 (mean ~178)
  // → mock trả scene (không phải marker lỗi).
  const slicePages = [await stripePage(400, 900, 0.3), await stripePage(400, 900, 0.3)];
  const fd = new FormData();
  fd.append('images', toBlob(slicePages[0], 'image/jpeg'), 'a1.jpg');
  fd.append('images', toBlob(slicePages[1], 'image/jpeg'), 'a2.jpg');
  const job = await postJob(fd);
  bandCount = job.items.length;
  ok(bandCount >= 2, `canvas 1880 → ${bandCount} band`);
  const dims = await Promise.all(job.items.map((it: any) => itemDims(it.imageUrl)));
  // Bất biến: cắt đầu rơi TRONG gutter trắng [900,940) — né khối sọc; band phủ kín, full-width.
  const cut1 = dims[0].h;
  ok(cut1 >= 900 && cut1 <= 940, `cắt 1 (${cut1}) trong gutter, né khối nội dung`);
  eq(dims.reduce((s, d) => s + d.h, 0), 1880, 'band phủ kín canvas');
  ok(dims.every((d) => d.w === 400), 'band full-width');

  // Storyboard từ job không content → nhịp pending sạch, rồi Generate từng nhịp (đường lẻ)
  await api<any>(`/api/jobs/${job.jobId}/storyboard`, { method: 'POST' });
  const sb = await pollStoryboard(job.jobId);
  eq(sb.beats.length, bandCount, `${bandCount} nhịp`);
  ok(
    sb.beats.every((b: any) => !b.error && b.narration === ''),
    'chưa Generate → nhịp pending sạch chờ Generate/điền tay',
  );
  for (const b of sb.beats) {
    const gen = await api<any>(`/api/jobs/${job.jobId}/storyboard/beats/${b.id}/generate`, {
      method: 'POST',
    });
    eq(gen.narration, MOCK_NARRATION, `Generate nhịp ${b.order} → narration mock`);
  }

  const exportRes = await fetch(`${BASE}/api/project/export?jobId=${job.jobId}`);
  eq(exportRes.status, 200, 'lưu project 200');
  projectZip = Buffer.from(await exportRes.arrayBuffer());
  bandManifest = JSON.parse(
    new AdmZip(projectZip).getEntry('storyboard.json')!.getData().toString('utf8'),
  );
  eq(bandManifest.beatCount, bandCount, 'project chứa số beats khớp band');
  ok(bandManifest.beats.every((b: any) => b.narration === MOCK_NARRATION), 'project lưu sau Generate');
}

// ============ B2. MỞ PROJECT (.mtvproj — không cần ảnh rời, không re-ingest) ============
console.log('B2. Mở project: 1 file .mtvproj → hydrate job + storyboard khớp, không re-ingest');
{
  const fd = new FormData();
  fd.append('file', toBlob(projectZip, 'application/zip'), 'project.mtvproj');
  const imp = await api<any>('/api/project/import', { method: 'POST', body: fd });
  ok(imp.jobId !== bandManifest.jobId, 'mở project tạo job mới');
  eq(imp.stage, 'storyboard', 'chưa có kịch bản → điều hướng storyboard');

  const dto = await api<any>(`/api/jobs/${imp.jobId}/storyboard`);
  eq(dto.progress.phase, 'done', 'không compose lại — phase done');
  eq(dto.working.length, bandCount, 'working hydrate từ ảnh embed (không re-ingest)');
  eq(
    dto.beats.map((b: any) => [b.sourceIndex, b.narration]),
    bandManifest.beats.map((b: any) => [b.sourceIndex, b.narration]),
    'beats khớp bản lưu (sourceIndex + narration)',
  );
  const jobDto = await api<any>(`/api/jobs/${imp.jobId}`);
  eq(jobDto.items.length, bandCount, 'job Stage 1 hydrate đủ band');

  const reExportRes = await fetch(`${BASE}/api/project/export?jobId=${imp.jobId}`);
  const reManifest = JSON.parse(
    new AdmZip(Buffer.from(await reExportRes.arrayBuffer()))
      .getEntry('storyboard.json')!
      .getData()
      .toString('utf8'),
  );
  eq(
    reManifest.beats.map((b: any) => [b.order, b.narration]),
    bandManifest.beats.map((b: any) => [b.order, b.narration]),
    're-export khớp bản lưu gốc',
  );

  // Route import cũ (manifest + ảnh rời) phải đã gỡ
  const oldImport = await fetch(`${BASE}/api/storyboard/import`, { method: 'POST', body: new FormData() });
  eq(oldImport.status, 404, 'route import cũ đã gỡ → 404');

  // Project hỏng (beat trỏ working không tồn tại) → 400 rõ ràng, không dựng nửa vời
  const badZip = new AdmZip(projectZip);
  const badManifest = {
    ...bandManifest,
    beats: bandManifest.beats.map((b: any, i: number) => (i === 0 ? { ...b, sourceIndex: 99 } : b)),
  };
  badZip.updateFile('storyboard.json', Buffer.from(JSON.stringify(badManifest)));
  const fdBad = new FormData();
  fdBad.append('file', toBlob(badZip.toBuffer(), 'application/zip'), 'bad.mtvproj');
  const badRes = await fetch(`${BASE}/api/project/import`, { method: 'POST', body: fdBad });
  eq(badRes.status, 400, 'project không khớp (sourceIndex thiếu ảnh) → 400');
}

// ============ C. PDF ============
console.log('C. PDF: upload PDF 2 trang → render + gộp + chia band như ảnh');
{
  const fd = new FormData();
  fd.append('images', toBlob(buildPdf(), 'application/pdf'), 'chapter.pdf');
  const job = await postJob(fd);
  // 2 trang 200×300 render scale 2 → canvas 400×1200 → SPLIT_HEIGHT=1000 chia 1-2 band.
  ok(job.items.length >= 1, `PDF vào pipeline → ${job.items.length} band`);
  ok(
    job.items.every((it: any) => /^band-\d+\.jpg$/.test(it.filename)),
    'item PDF cũng là band',
  );
  const img = await fetch(`${BASE}${job.items[0].imageUrl}`);
  eq(img.status, 200, 'thumbnail band PDF 200');
}

// ============ D. XOÁ ẢNH: band (khu upload) + nhịp (storyboard) ============
console.log('D. Xoá band (khu upload) + xoá nhịp (storyboard): hard-delete, re-index/re-order, 404/409');
{
  // D1. Xoá band: phase ready → 200 + re-index; index ngoài biên → 404; đang chạy Stage 1 → 409.
  // 3 khối sọc (mỗi khối 1 band) → 3 band xác định. inkRatio 0.3 → mock trả scene (không lỗi).
  const fd = new FormData();
  fd.append('images', toBlob(await stripePage(600, 900, 0.3), 'image/jpeg'), '1.jpg');
  fd.append('images', toBlob(await stripePage(600, 900, 0.3), 'image/jpeg'), '2.jpg');
  fd.append('images', toBlob(await stripePage(600, 900, 0.3), 'image/jpeg'), '3.jpg');
  const job = await postJob(fd);
  eq(job.items.length, 3, 'D1: upload 3 khối sọc → 3 band');

  const delOOB = await fetch(`${BASE}/api/jobs/${job.jobId}/items/99`, { method: 'DELETE' });
  eq(delOOB.status, 404, 'D1: xoá index ngoài biên → 404');

  const afterDel = await api<any>(`/api/jobs/${job.jobId}/items/1`, { method: 'DELETE' });
  eq(afterDel.items.length, 2, 'D1: xoá band giữa → còn 2');
  eq(afterDel.items.map((it: any) => it.index), [0, 1], 'D1: index re-index liền mạch [0,1]');
  eq(
    afterDel.items.map((it: any) => it.filename),
    ['band-1.jpg', 'band-3.jpg'],
    'D1: giữ đúng 2 band còn lại (band-1, band-3)',
  );
  eq(afterDel.progress.total, 2, 'D1: progress.total = 2 sau xoá');

  // PATCH content Stage 1 đã gỡ khỏi route items — chỉ còn DELETE
  const patchGone = await fetch(`${BASE}/api/jobs/${job.jobId}/items/0`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'x' }),
  });
  eq(patchGone.status, 405, 'D1: PATCH content item đã gỡ → 405');

  // D2. Xoá nhịp storyboard: 200 + re-sequence order; beatId lạ → 404; job chưa có storyboard → 404;
  // đang Generate all → 409 (vision qua mock network + pace 100ms/req → có cửa sổ đua thật).
  await api<any>(`/api/jobs/${job.jobId}/storyboard`, { method: 'POST' });
  const sb = await pollStoryboard(job.jobId);
  eq(sb.progress.phase, 'done', 'D2: tạo storyboard xong (pending sạch)');
  eq(sb.beats.length, 2, 'D2: 2 nhịp khớp 2 band còn lại sau D1');

  await api<any>(`/api/jobs/${job.jobId}/storyboard/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpm: 600 }),
  });
  const delWhileGen = await fetch(
    `${BASE}/api/jobs/${job.jobId}/storyboard/beats/${sb.beats[0].id}`,
    { method: 'DELETE' },
  );
  eq(delWhileGen.status, 409, 'D2: xoá nhịp khi Generate all đang chạy → 409');
  const sbGen = await pollStoryboard(job.jobId);
  ok(
    sbGen.beats.every((b: any) => b.narration === MOCK_NARRATION),
    'D2: Generate all fill cả 2 nhịp (band sọc thưa)',
  );

  const delBeatOOB = await fetch(
    `${BASE}/api/jobs/${job.jobId}/storyboard/beats/khong-ton-tai`,
    { method: 'DELETE' },
  );
  eq(delBeatOOB.status, 404, 'D2: beatId lạ → 404');

  const b0 = sb.beats.find((b: any) => b.order === 0)!;
  const afterDelBeat = await api<any>(
    `/api/jobs/${job.jobId}/storyboard/beats/${b0.id}`,
    { method: 'DELETE' },
  );
  eq(afterDelBeat.beats.length, 1, 'D2: xoá 1 nhịp → còn 1');
  eq(afterDelBeat.beats.map((b: any) => b.order), [0], 'D2: order re-sequence về [0]');
  eq(afterDelBeat.progress.total, 1, 'D2: progress.total = 1 sau xoá');

  const fdNoSb = new FormData();
  fdNoSb.append('images', toBlob(await solidJpeg(600, 500, 200), 'image/jpeg'), '1.jpg');
  const jobNoSb = await postJob(fdNoSb);
  const delNoSb = await fetch(`${BASE}/api/jobs/${jobNoSb.jobId}/storyboard/beats/x`, {
    method: 'DELETE',
  });
  eq(delNoSb.status, 404, 'D2: job chưa có storyboard → 404');
}

console.log(failures === 0 ? '\nE2E_ALL_PASS' : `\nE2E_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
