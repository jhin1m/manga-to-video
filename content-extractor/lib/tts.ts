import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { probeDurationSec } from './ffmpeg';
import { withRetry } from './vision';

// TTS ElevenLabs với CACHE ĐĨA dùng chung giữa Preview UI và CLI: preview synth 1 lần,
// CLI tái dùng — không gọi API (tính tiền theo ký tự) lần 2 cho cùng text+voice+model.
// Provider qua ENV; ghi atomic (.tmp → rename) chống cache corrupt.

export interface TtsConfig {
  apiKey: string;
  baseUrl: string;
  voiceId: string;
  model: string;
  cacheDir: string;
}

export function readTtsConfig(overrides?: { voiceId?: string; model?: string }): TtsConfig {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu ELEVENLABS_API_KEY — khai báo trong .env.local (xem .env.example).');
  }
  return {
    apiKey,
    baseUrl: (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, ''),
    voiceId: overrides?.voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
    model: overrides?.model || process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
    cacheDir: process.env.TTS_CACHE_DIR || path.join('.cache', 'tts'),
  };
}

// Key cache gồm cả voice + model — đổi giọng/tier không lẫn audio cũ.
export function ttsCacheKey(text: string, voiceId: string, model: string): string {
  return createHash('sha256').update(`${text}\x00${voiceId}\x00${model}`).digest('hex');
}

function statusOf(res: Response): Error & { status: number } {
  const err = new Error(`ElevenLabs HTTP ${res.status}`) as Error & { status: number };
  err.status = res.status;
  return err;
}

async function fetchTts(text: string, cfg: TtsConfig): Promise<Buffer> {
  const res = await fetch(`${cfg.baseUrl}/v1/text-to-speech/${cfg.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': cfg.apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: cfg.model }),
    // Kết nối treo không được ghim cả CLI/route vô hạn — timeout ném lỗi không status,
    // withRetry coi là lỗi mạng và thử lại.
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw statusOf(res); // status gắn kèm → withRetry phân loại 429/5xx
  return Buffer.from(await res.arrayBuffer());
}

export interface SynthResult {
  mp3Path: string;
  durationSec: number;
  cached: boolean; // HIT cache đĩa — không gọi API
  key: string;
}

// Synth MỘT đoạn văn → mp3 + độ dài (giây). Text rỗng → không synth, durationSec 0
// (CLI áp sàn im lặng). Cache: <cacheDir>/<sha256>.mp3 + .json metadata độ dài
// (khỏi ffprobe lại khi HIT).
export async function synthSegment(text: string, cfg: TtsConfig): Promise<SynthResult> {
  const trimmed = text.trim();
  const key = ttsCacheKey(trimmed, cfg.voiceId, cfg.model);
  if (trimmed === '') {
    return { mp3Path: '', durationSec: 0, cached: true, key };
  }
  await mkdir(cfg.cacheDir, { recursive: true });
  const mp3Path = path.join(cfg.cacheDir, `${key}.mp3`);
  const metaPath = path.join(cfg.cacheDir, `${key}.json`);

  if (existsSync(mp3Path)) {
    let durationSec: number | undefined;
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { durationSec?: number };
      if (typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec)) {
        durationSec = meta.durationSec;
      }
    } catch {
      // metadata hỏng/thiếu → đo lại bên dưới
    }
    if (durationSec === undefined) {
      durationSec = await probeDurationSec(mp3Path);
      await writeAtomic(metaPath, JSON.stringify({ durationSec }));
    }
    return { mp3Path, durationSec, cached: true, key };
  }

  const audio = await withRetry(() => fetchTts(trimmed, cfg));
  await writeAtomic(mp3Path, audio);
  const durationSec = await probeDurationSec(mp3Path);
  await writeAtomic(metaPath, JSON.stringify({ durationSec }));
  return { mp3Path, durationSec, cached: false, key };
}

// Ghi atomic: .tmp → rename (rename cùng filesystem là atomic) — cache không bao giờ
// chứa file ghi dở. Hậu tố pid+counter: hai synth cùng key chạy song song không giẫm
// lên file tmp của nhau.
let tmpCounter = 0;
async function writeAtomic(filePath: string, data: Buffer | string): Promise<void> {
  const tmp = `${filePath}.${process.pid}-${tmpCounter++}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, filePath);
}
