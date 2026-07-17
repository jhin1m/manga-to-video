import { withRetry } from '../vision';
import { PROVIDER_LABELS } from './catalog';
import type { TtsConfig, TtsProvider } from './types';

// Provider ElevenLabs — di chuyển nguyên fetchTts/statusOf từ lib/tts.ts, hành vi KHÔNG đổi
// (headers, timeout 120s, phân loại 429/5xx qua withRetry). Cache/atomic/probe do lib/tts.ts lo.

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

export const elevenlabsProvider: TtsProvider = {
  id: 'elevenlabs',
  label: PROVIDER_LABELS.elevenlabs,
  // Không có catalog cố định — voiceId là chuỗi tự do (voice library ElevenLabs).
  async synth(text: string, cfg: TtsConfig): Promise<Buffer> {
    if (!cfg.apiKey) {
      throw new Error('Thiếu ELEVENLABS_API_KEY — khai báo trong .env.local (xem .env.example).');
    }
    return withRetry(() => fetchTts(text, cfg));
  },
};
