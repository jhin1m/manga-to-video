// E2E Stage 2 tầng ROUTE (kịch bản + TTS + bundle) qua server thật + mock (không API/tiền thật).
// Cách chạy (Node 24):
//   1. node scripts/mock-openai-vision.mjs                       # vision :3106
//   2. node scripts/mock-script-model.mjs                        # biên kịch :3108
//   3. node scripts/mock-elevenlabs.mjs                          # TTS :3107 (cần ffmpeg)
//   4. npm run build && PORT=3105 OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://localhost:3106/v1 \
//      VISION_MODEL=mock-vision SCRIPT_API_KEY=mock-key SCRIPT_BASE_URL=http://localhost:3108/v1 \
//      SCRIPT_MODEL=mock-script ELEVENLABS_API_KEY=mock-key ELEVENLABS_BASE_URL=http://localhost:3107 \
//      TTS_CACHE_DIR=/tmp/e2e-tts-cache SPLIT_HEIGHT=1000 \
//      SETTINGS_FILE=/dev/null npx next start -p 3105
//      (SETTINGS_FILE=/dev/null: không ăn .settings.json của dev — e2e phải chạy ENV thuần)
//   5. npx tsx scripts/e2e-script-video.mts
// Phủ: tạo kịch bản (mock model, index ngoài biên bị loại) → sửa/gộp/tách/reorder/xoá →
// confirm (mutator reset cờ) → TTS synth + stream audio → export-bundle mở lại được.
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
const post = (path: string, body: unknown) =>
  api<any>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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

// POST .../script giờ trả NDJSON khi thành công (progress + done) hoặc JSON lỗi cho guard.
async function postScript(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST' });
  const text = await res.text();
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('ndjson')) {
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {}
    throw new Error(`${path} → HTTP ${res.status}: ${msg}`);
  }
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; status?: number; message?: string; script?: any });
  const err = lines.find((l) => l.type === 'error');
  if (err) throw new Error(`${path} → ${err.status}: ${err.message}`);
  const done = lines.find((l) => l.type === 'done');
  if (!done) throw new Error(`${path} → thiếu dòng done`);
  return done.script;
}

function toBlob(buf: Buffer, type: string): Blob {
  return new Blob([new Uint8Array(buf)], { type });
}

// Khối sọc thưa + gutter (mẫu e2e-storyboard) → 3 band xác định, mock vision trả scene.
async function stripePage(w: number, h: number, gutter = 40): Promise<Buffer> {
  const cell = 20;
  const black = 5; // 25% mực → mean ~191, không dính marker lỗi của mock vision
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
  return sharp({ create: { width: w, height: h + gutter, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(cols)
    .jpeg()
    .toBuffer();
}

async function pollDone(path: string, timeoutMs = 60000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const dto = await api<any>(path);
    if (dto.progress.phase === 'done' || dto.progress.phase === 'failed') return dto;
    if (Date.now() - start > timeoutMs) throw new Error(`${path} quá thời gian chờ`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

console.log('A. Chuẩn bị: upload 3 khối sọc → storyboard pending → Generate all (mock vision)');
const fd = new FormData();
fd.append('images', toBlob(await stripePage(600, 900), 'image/jpeg'), '1.jpg');
fd.append('images', toBlob(await stripePage(600, 900), 'image/jpeg'), '2.jpg');
fd.append('images', toBlob(await stripePage(600, 900), 'image/jpeg'), '3.jpg');
const job = await postJob(fd);
eq(job.items.length, 3, '3 band');
await api<any>(`/api/jobs/${job.jobId}/storyboard`, { method: 'POST' });
const sbPending = await pollDone(`/api/jobs/${job.jobId}/storyboard`);
ok(
  sbPending.beats.every((b: any) => !b.error && b.narration === ''),
  'chưa Generate → nhịp pending sạch',
);
await post(`/api/jobs/${job.jobId}/storyboard/generate`, { rpm: 600 });
const sb = await pollDone(`/api/jobs/${job.jobId}/storyboard`);
eq(sb.beats.length, 3, '3 nhịp');
ok(sb.beats.every((b: any) => b.narration.length > 0), 'Generate all fill mọi nhịp');
// Content reuse (chống double-vision): Generate all đã ghi scene vào working.content nên
// bước Kịch bản không gọi vision lần 2 — assert đơn vị nằm ở verify-narration (mock đếm
// được call); ở tầng E2E, script tạo được không lỗi (block B) là đủ bằng chứng luồng.

console.log('B. Kịch bản AI: POST script (mock model) — gộp/loại index ngoài biên');
{
  const noScript = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/script`);
  eq(noScript.status, 404, 'GET trước khi tạo → 404');
  const dto = await postScript(`/api/jobs/${job.jobId}/storyboard/script`);
  eq(dto.confirmed, false, 'mới tạo → chưa confirmed');
  eq(dto.segments.length, 2, 'mock 3 đoạn → 2 (index 99 bị loại)');
  eq(dto.segments[0].shots.length, 2, 'đoạn 1 gộp band 0+1');
  eq(dto.segments[1].shots[0].sourceIndex, 2, 'đoạn 2 → band 2');
}

console.log('C. Duyệt: sửa/tách/gộp/reorder/xoá + confirm');
{
  let dto = await api<any>(`/api/jobs/${job.jobId}/storyboard/script`);
  const seg1 = dto.segments[0];
  // Sửa narration → edited
  dto = await api<any>(`/api/jobs/${job.jobId}/storyboard/script/segments/${seg1.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ narration: 'Lời kể mới. Có hai câu.' }),
  });
  ok(dto.segments[0].edited === true, 'PATCH → edited=true');
  eq(dto.segments[0].durationHint, 2, 'durationHint tính lại (24 ký tự → 2s)');
  // Tách đoạn 2-shot tại biên shot 1
  dto = await post(`/api/jobs/${job.jobId}/storyboard/script/segments/split`, {
    segId: dto.segments[0].id,
    atShotIndex: 1,
  });
  eq(dto.segments.length, 3, 'tách → 3 đoạn');
  eq(dto.segments[1].narration, '', 'đoạn tách ra narration rỗng chờ điền');
  // Gộp lại 2 đoạn vừa tách
  dto = await post(`/api/jobs/${job.jobId}/storyboard/script/segments/merge`, {
    segIds: [dto.segments[0].id, dto.segments[1].id],
  });
  eq(dto.segments.length, 2, 'gộp → 2 đoạn');
  eq(dto.segments[0].shots.length, 2, 'shots nối lại đủ 2');
  // Gộp 2 đoạn KHÔNG liền kề → 400
  const dtoNow = dto;
  const farMerge = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/script/segments/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segIds: [dtoNow.segments[0].id, dtoNow.segments[0].id] }),
  });
  eq(farMerge.status, 400, 'gộp không liền kề/tự gộp → 400');
  // Reorder + xoá
  dto = await post(`/api/jobs/${job.jobId}/storyboard/script/segments/reorder`, {
    segId: dto.segments[0].id,
    to: 1,
  });
  eq(dto.segments.map((s: any) => s.order), [0, 1], 'order liền mạch sau reorder');
  // Confirm → mutator bất kỳ reset cờ
  dto = await api<any>(`/api/jobs/${job.jobId}/storyboard/script/confirm`, { method: 'POST' });
  eq(dto.confirmed, true, 'confirm → true');
  dto = await api<any>(`/api/jobs/${job.jobId}/storyboard/script/segments/${dto.segments[0].id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ narration: 'Sửa sau khi chốt.' }),
  });
  eq(dto.confirmed, false, 'sửa sau confirm → cờ reset');
  await api<any>(`/api/jobs/${job.jobId}/storyboard/script/confirm`, { method: 'POST' });
}

console.log('D. TTS synth (mock ElevenLabs) + stream audio');
{
  const { results } = await post(`/api/jobs/${job.jobId}/storyboard/tts`, {});
  eq(results.length, 2, 'synth mọi đoạn có narration');
  ok(results.every((r: any) => r.durationSec > 0.8 && r.durationSec < 1.3), 'độ dài mp3 mock ~1s');
  ok(results.every((r: any) => r.audioUrl), 'có audioUrl phát lại');
  const audioRes = await fetch(`${BASE}${results[0].audioUrl}`);
  eq(audioRes.status, 200, 'stream audio 200');
  eq(audioRes.headers.get('content-type'), 'audio/mpeg', 'audio là mp3');
  // Synth lại → cache HIT
  const second = await post(`/api/jobs/${job.jobId}/storyboard/tts`, {});
  ok(second.results.every((r: any) => r.cached === true), 'synth lại → cache HIT toàn bộ');
}

console.log('E. Export bundle → mở lại được, đủ manifest/config/band/audio');
{
  const fdExp = new FormData();
  fdExp.append('config', JSON.stringify({ aspect: '9:16', fps: 24 }));
  const res = await fetch(`${BASE}/api/jobs/${job.jobId}/storyboard/export-bundle`, {
    method: 'POST',
    body: fdExp,
  });
  eq(res.status, 200, 'export-bundle 200');
  ok((res.headers.get('content-disposition') ?? '').startsWith('attachment'), 'là attachment zip');
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const names = zip.getEntries().map((e) => e.entryName).sort();
  ok(names.includes('manifest.json'), 'zip có manifest.json');
  ok(names.includes('render-config.json'), 'zip có render-config.json');
  eq(names.filter((n) => /^band-\d+\.jpg$/.test(n)).length, 3, 'zip đủ 3 band mà shots trỏ tới');
  eq(names.filter((n) => n.startsWith('audio/')).length, 2, 'zip kèm 2 audio đã synth');
  const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8'));
  eq(manifest.version, 1, 'manifest SCRIPT_VERSION 1');
  eq(manifest.segmentCount, 2, 'manifest đủ 2 đoạn');
  const config = JSON.parse(zip.getEntry('render-config.json')!.getData().toString('utf8'));
  eq([config.aspect, config.fps], ['9:16', 24], 'config từ UI được nhúng');
}

console.log(failures === 0 ? '\nE2E_SCRIPT_VIDEO_ALL_PASS' : `\nE2E_SCRIPT_VIDEO_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
