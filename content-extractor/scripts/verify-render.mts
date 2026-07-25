// E2E render Stage 2 (mock ElevenLabs — không API/tiền thật; cần ffmpeg, thiếu thì SKIP):
//   dựng sample bundle (3 band sharp, 3 segment, 1 segment 2 shot) →
//   --dry-run: chỉ timeline+srt, KHÔNG gọi TTS →
//   render 9:16: MP4 có video+audio, duration ≈ Σ dur_seg, srt đủ caption, TTS 3 call →
//   render 16:9 + BGM + burn: chạy được từ CÙNG bundle, TTS cache HIT (không call thêm).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { writeBundle } from '../lib/bundle';
import {
  assertFfmpeg,
  probeDurationSec,
  probeStreams,
  resolveSubtitleBin,
  runFfmpeg,
} from '../lib/ffmpeg';
import type { ScriptSegment } from '../lib/schema';
import { defaultRenderConfig, toScriptManifest } from '../lib/schema';
import { createMockElevenLabs } from './mock-elevenlabs.mjs';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`);
  }
};
const ok = (c: boolean, label: string) => eq(c, true, label);

try {
  await assertFfmpeg();
} catch {
  console.log('SKIP: thiếu ffmpeg/ffprobe (PATH lẫn bundled đều không có) — bỏ qua test:render.');
  process.exit(0);
}

async function band(w: number, h: number, gray: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: gray, g: gray, b: gray } } })
    .jpeg()
    .toBuffer();
}

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      path.join('node_modules', '.bin', 'tsx'),
      ['scripts/render-video.mts', ...args],
      { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

const mock = await createMockElevenLabs();
const tmp = await mkdtemp(path.join(os.tmpdir(), 'verify-render-'));
const cacheDir = path.join(tmp, 'tts-cache');
const env = {
  ELEVENLABS_API_KEY: 'mock-key',
  ELEVENLABS_BASE_URL: `http://localhost:${mock.port}`,
  ELEVENLABS_VOICE_ID: 'mock-voice',
  ELEVENLABS_MODEL: 'mock-model',
  TTS_CACHE_DIR: cacheDir,
};

// ==== Dựng sample bundle: 3 band, 3 segment (segment 1 có 2 shot) ====
console.log('A. Dựng sample bundle (3 band, 3 segment, segment 1 gộp 2 shot)');
const segments: ScriptSegment[] = [
  {
    id: 'seg-1',
    order: 0,
    narration: 'Mở đầu câu chuyện. Hai nhân vật chạm mặt nhau!',
    shots: [
      { sourceIndex: 0, region: null, weight: 1 },
      { sourceIndex: 1, region: null, weight: 2 },
    ],
  },
  {
    id: 'seg-2',
    order: 1,
    narration: 'Band dọc dài được pan từ trên xuống.',
    shots: [{ sourceIndex: 2, region: null, weight: 1 }],
  },
  {
    id: 'seg-3',
    order: 2,
    narration: 'Kết thúc.',
    shots: [{ sourceIndex: 0, region: null, weight: 1 }],
  },
];
const manifest = toScriptManifest({ jobId: 'verify-render', createdAt: 'test', segments });
const images = new Map<number, Buffer>([
  [0, await band(600, 900, 200)],
  [1, await band(600, 600, 120)],
  [2, await band(400, 1600, 230)], // band dọc → pan-v ở 9:16, blur-fill ở 16:9
]);
const zip = writeBundle({ scriptManifest: manifest, config: defaultRenderConfig(), images });
const bundlePath = path.join(tmp, 'bundle.zip');
await writeFile(bundlePath, zip);
ok(existsSync(bundlePath), 'bundle.zip ghi xong');

// ==== B. --dry-run: timeline + srt, KHÔNG TTS/ffmpeg render ====
console.log('B. --dry-run');
{
  const outBase = path.join(tmp, 'dry');
  const r = await runCli([bundlePath, '--dry-run', '--out', `${outBase}.mp4`], env);
  eq(r.code, 0, `dry-run thoát 0${r.code !== 0 ? `\n${r.out}` : ''}`);
  ok(existsSync(`${outBase}.srt`), 'dry-run xuất .srt');
  ok(existsSync(`${outBase}.timeline.json`), 'dry-run xuất timeline.json');
  ok(!existsSync(`${outBase}.mp4`), 'dry-run KHÔNG render mp4');
  eq(mock.requestCount(), 0, 'dry-run không gọi ElevenLabs');
  const tj = JSON.parse(await readFile(`${outBase}.timeline.json`, 'utf8'));
  eq(tj.segments.length, 3, 'timeline.json đủ 3 segment');
  // durationHint: ước từ narration (15 ký tự/giây, sàn 2s mỗi đoạn)
  ok(tj.totalSec >= 6, `dry-run totalSec ≥ 3×sàn (${tj.totalSec})`);
}

// ==== C. Render 9:16 (mock TTS) ====
console.log('C. Render 9:16 — MP4 + streams + duration + srt + TTS 3 call');
const out916 = path.join(tmp, 'out-916.mp4');
{
  const r = await runCli([bundlePath, '--aspect', '9:16', '--fps', '24', '--out', out916], env);
  eq(r.code, 0, `render 9:16 thoát 0${r.code !== 0 ? `\n${r.out}` : ''}`);
  ok(existsSync(out916), 'MP4 tồn tại');
  const streams = await probeStreams(out916);
  ok(streams.includes('video') && streams.includes('audio'), `MP4 có video+audio (${streams})`);
  // mp3 mock ~1.04s → mỗi segment max(1.04+0.5, 2) = 2s → tổng ≈ 6s
  const dur = await probeDurationSec(out916);
  ok(Math.abs(dur - 6) < 0.8, `tổng thời lượng ≈ Σ dur_seg = 6s (${dur.toFixed(2)})`);
  const tj = JSON.parse(await readFile(path.join(tmp, 'out-916.timeline.json'), 'utf8'));
  ok(Math.abs(dur - tj.totalSec) < 0.5, `MP4 khớp timeline.json (${dur.toFixed(2)} vs ${tj.totalSec})`);
  const srt = await readFile(path.join(tmp, 'out-916.srt'), 'utf8');
  // seg1 2 câu + seg2 1 câu + seg3 1 câu = 4 caption
  eq(srt.trim().split('\n\n').length, 4, 'srt tách caption theo câu (4 caption)');
  eq(mock.requestCount(), 3, 'TTS gọi đúng 3 lần (3 segment có lời)');
}

// ==== D. Render 16:9 + BGM + burn từ CÙNG bundle — cache HIT ====
console.log('D. Render 16:9 + BGM + burn-in — cùng bundle, TTS cache HIT');
{
  const bgmPath = path.join(tmp, 'bgm.mp3');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', '-b:a', '32k', bgmPath]);
  const out169 = path.join(tmp, 'out-169.mp4');
  const r = await runCli(
    [bundlePath, '--aspect', '16:9', '--out', out169, '--bgm', bgmPath, '--subs', 'both'],
    env,
  );
  eq(r.code, 0, `render 16:9 thoát 0${r.code !== 0 ? `\n${r.out}` : ''}`);
  const streams = await probeStreams(out169);
  ok(streams.includes('video') && streams.includes('audio'), '16:9 có video+audio');
  const dur = await probeDurationSec(out169);
  ok(Math.abs(dur - 6) < 0.8, `16:9 duration khớp (${dur.toFixed(2)})`);
  ok(existsSync(path.join(tmp, 'out-169.srt')), 'subs both → .srt rời vẫn giữ');
  eq(mock.requestCount(), 3, 'cache HIT — không gọi ElevenLabs thêm (vẫn 3)');
  ok(r.out.includes('cache HIT'), 'log xác nhận cache HIT');
  ok(r.out.includes('BGM duck'), 'log xác nhận BGM ducking');
  // Burn-in chạy khi CÓ nguồn ffmpeg nào đó kèm libass (binary chính hoặc bản bundled).
  // Không nguồn nào có → degrade rõ ràng, .srt rời vẫn có (đã assert trên).
  if (await resolveSubtitleBin()) {
    ok(r.out.includes('burn-in'), 'log xác nhận burn phụ đề');
  } else {
    ok(
      r.out.includes('có filter subtitles'),
      'không nguồn ffmpeg nào có libass → cảnh báo rõ, không chết giữa chừng',
    );
  }
}

await rm(tmp, { recursive: true, force: true });
await mock.close();

console.log(failures === 0 ? '\nRENDER_ALL_PASS' : `\nRENDER_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
