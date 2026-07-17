// Mock CapCut common_task TTS cho test offline — không gọi API thật. Khớp shape JSON THẬT
// capture ở Phase 1 (reports/capcut-response-samples.md): new → query (queueing 1 nhịp rồi
// succeed) → audio URL trỏ về chính mock. mp3 sine ~1s sinh bằng ffmpeg (test render vốn cần
// ffmpeg). Chế độ lỗi: SSML chứa voice tên FAIL_VOICE → query trả status "failed" (test message
// lỗi + gợi ý đổi provider). GET /__count = số request /new (assert cache HIT không tạo task).
// Chạy riêng: node scripts/mock-capcut.mjs (MOCK_PORT, mặc định 3109) hoặc
// import { createMockCapcut } trong verify script (port 0 = tự chọn).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAPCUT_FAIL_VOICE = 'FAIL_VOICE'; // → task "failed" (test message lỗi)
export const CAPCUT_QUEUE_VOICE = 'QUEUE_VOICE'; // → luôn "queueing" (test timeout poll)

async function makeSineMp3(durationSec = 1) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mock-capcut-'));
  const out = path.join(dir, 'tone.mp3');
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSec}`, '-b:a', '32k', out,
    ]);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg thoát mã ${code}`))));
  });
  const mp3 = await readFile(out);
  await rm(dir, { recursive: true, force: true });
  return mp3;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

function voiceFromNewBody(bodyText) {
  // body.tasks[0].payload (JSON string) → ssml → name="<voice>"
  try {
    const payload = JSON.parse(JSON.parse(bodyText).tasks[0].payload);
    return /name="([^"]+)"/.exec(payload.ssml)?.[1] ?? '';
  } catch {
    return '';
  }
}

export async function createMockCapcut(port = 0) {
  const mp3 = await makeSineMp3();
  let newCount = 0;
  let seq = 0;
  const tasks = new Map(); // taskId → { voice, polls }

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '';
    const json = (obj) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'GET' && url === '/__count') return json({ count: newCount });

    if (req.method === 'GET' && url.startsWith('/audio/')) {
      res.writeHead(200, { 'content-type': 'video/mp4' }); // CapCut thật cũng gắn video/mp4 dù là mp3
      res.end(mp3);
      return;
    }

    if (req.method === 'POST' && url.startsWith('/lv/v1/common_task/new')) {
      newCount++;
      const voice = voiceFromNewBody(await readBody(req));
      const id = `mock_task_${seq++}_8_0`;
      tasks.set(id, { voice, polls: 0 });
      return json({
        ret: '0', errmsg: 'success',
        data: { tasks: [{ id, status: 'queueing', token: 'mock-token', estimated_time: 1 }], failed_tasks: [] },
      });
    }

    if (req.method === 'POST' && url.startsWith('/lv/v1/common_task/query')) {
      const id = JSON.parse(await readBody(req)).tasks?.[0]?.id;
      const t = tasks.get(id);
      if (!t) return json({ ret: '0', data: { tasks: [{ id, status: 'failed', err_code: 404, err_msg: 'task không tồn tại', payload: null }] } });
      t.polls++;
      if (t.voice === CAPCUT_FAIL_VOICE) {
        return json({ ret: '0', errmsg: 'success', data: { tasks: [{ id, status: 'failed', progress: 0, err_code: 40402004, err_msg: 'TTSInvalidSpeaker', payload: null }] } });
      }
      if (t.voice === CAPCUT_QUEUE_VOICE || t.polls < 2) {
        // nhịp đầu queueing → ép provider poll lại (khớp flow thật)
        return json({ ret: '0', errmsg: 'success', data: { tasks: [{ id, status: 'queueing', progress: 0, payload: '' }] } });
      }
      const payload = JSON.stringify({
        audio_subtitles: [
          {
            speech_url: `http://127.0.0.1:${server.address().port}/audio/${id}`,
            speech_vid: 'mockvid', utterances: null, duration: 1000, hit_cache: false,
            platform: 'sami', invalid_input: false, text: '', code: 0, msg: '', speaker_id: t.voice,
          },
        ],
        scene: 'text_to_speech',
      });
      return json({ ret: '0', errmsg: 'success', data: { tasks: [{ id, status: 'succeed', progress: 100, payload }] } });
    }

    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(port, resolve));
  return {
    port: server.address().port,
    newRequestCount: () => newCount,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mock = await createMockCapcut(Number(process.env.MOCK_PORT ?? 3109));
  console.log(`MOCK_READY ${mock.port}`);
}
