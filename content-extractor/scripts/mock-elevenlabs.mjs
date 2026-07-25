// Mock ElevenLabs TTS cho test Stage 2 — không tốn API/tiền thật.
// POST /v1/text-to-speech/{voiceId} → trả 1 mp3 sine ~1s cố định (độ dài biết trước để
// assert timeline). GET /__count → {count} (đếm request TTS — assert cache HIT không fetch).
// mp3 sinh bằng ffmpeg lúc khởi động (bin resolve qua mock-ffmpeg-bin — máy chưa cài
// ffmpeg vẫn chạy nhờ bản bundled npm).
// Chạy đứng riêng: node scripts/mock-elevenlabs.mjs (MOCK_PORT, mặc định 3107)
// hoặc import { createMockElevenLabs } trong verify script (port 0 = tự chọn).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockFfmpegBin } from './mock-ffmpeg-bin.mjs';

async function makeSineMp3(durationSec = 1) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mock-11labs-'));
  const out = path.join(dir, 'tone.mp3');
  await new Promise((resolve, reject) => {
    const child = spawn(mockFfmpegBin(), [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSec}`,
      '-b:a',
      '32k',
      out,
    ]);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg thoát mã ${code}`)),
    );
  });
  const mp3 = await readFile(out);
  await rm(dir, { recursive: true, force: true });
  return mp3;
}

export async function createMockElevenLabs(port = 0) {
  const mp3 = await makeSineMp3();
  let count = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/__count') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ count }));
      return;
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/text-to-speech/')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        count++;
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        res.end(mp3);
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return {
    port: server.address().port,
    requestCount: () => count,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mock = await createMockElevenLabs(Number(process.env.MOCK_PORT ?? 3107));
  console.log(`MOCK_READY ${mock.port}`);
}
