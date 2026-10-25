import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { probeDurationSec } from './ffmpeg';
import { getOutputLanguage, type OutputLanguage } from './output-language';
import { readAiSettings } from './settings';
import { DEFAULT_PROVIDER_ID, getTtsProvider } from './tts-providers';
import { pickVoiceForLang } from './tts-providers/catalog';
import type { TtsConfig } from './tts-providers';

// TTS với CACHE ĐĨA dùng chung giữa Preview UI và CLI: preview synth 1 lần, CLI tái dùng —
// không gọi lại API cho cùng text+voice+model. Provider cắm được (ElevenLabs, CapCut, …):
// lib này lo cache/atomic/probe, provider chỉ lo text → mp3. Ghi atomic (.tmp → rename)
// chống cache corrupt.

export type { TtsConfig } from './tts-providers';

// Resolve provider: arg > ENV TTS_PROVIDER > 'elevenlabs'. Validate sớm (throw tiếng Việt
// nếu id lạ) để route trả lỗi rõ ràng trước khi synth.
function resolveProviderId(override?: string): string {
  const id = (override || process.env.TTS_PROVIDER || DEFAULT_PROVIDER_ID).trim() || DEFAULT_PROVIDER_ID;
  getTtsProvider(id); // ném lỗi nếu không hợp lệ
  return id;
}

// Câu mẫu nút "Nghe thử" trong Settings. HẰNG SỐ dùng chung (không viết inline ở nhiều chỗ):
// mọi lần nghe thử cùng giọng dùng chung một entry cache → synth 1 lần, nghe lại miễn phí.
// Bản vi giữ là hằng số export (cache nghe thử cũ); ngôn ngữ khác lấy previewSample theo giọng.
export const TTS_PREVIEW_SAMPLE = getOutputLanguage('vi').previewSample;

// Chuỗi ưu tiên: overrides (renderConfig của job) > .settings.json.tts > ENV > default.
// `lang` = ngôn ngữ lời kể của job: provider có catalog (CapCut) đổi giọng sai ngôn ngữ sang
// giọng đầu của ngôn ngữ đó. Đổi giọng PHẢI xảy ra ở đây, trước khi synthSegment tính cache
// key — key luôn phản ánh đúng giọng sẽ synth. Không truyền lang = hành vi cũ.
export function readTtsConfig(overrides?: {
  provider?: string;
  voiceId?: string;
  model?: string;
  lang?: OutputLanguage;
}): TtsConfig {
  const saved = readAiSettings()?.tts ?? null;
  const provider = resolveProviderId(overrides?.provider || saved?.provider);
  // Settings TTS chỉ áp khi provider HIỆU DỤNG trùng provider đã cấu hình. Job override sang
  // nhà khác mà vẫn lấy giọng/key nhà cũ là sai chắc chắn (giọng CapCut gửi cho ElevenLabs).
  const st = saved && saved.provider === provider ? saved : null;
  const isElevenlabs = provider === 'elevenlabs';
  let voiceId =
    overrides?.voiceId ||
    st?.voiceId ||
    (isElevenlabs ? process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM' : '');
  if (overrides?.lang) {
    // voiceId rỗng của CapCut nghĩa là "theo CAPCUT_VOICE" — xét luôn giọng ENV đó để job en
    // không đọc bằng giọng Việt đặt trong .env.local.
    const candidate = voiceId || (provider === 'capcut' ? process.env.CAPCUT_VOICE || '' : '');
    const picked = pickVoiceForLang(provider, candidate, overrides.lang);
    if (picked === null) {
      const { label } = getOutputLanguage(overrides.lang);
      throw new Error(
        `${getTtsProvider(provider).label} chưa có giọng ${label} — chọn ElevenLabs ở trang Dựng video hoặc Settings.`,
      );
    }
    // Giữ voiceId rỗng khi không phải đổi giọng → provider tự resolve như cũ (cache key vi y cũ).
    if (picked !== candidate) voiceId = picked;
  }
  return {
    provider,
    // apiKey không còn ném lỗi tại đây — provider ElevenLabs tự kiểm khi thực sự synth,
    // nên chọn CapCut không bắt buộc khai báo ELEVENLABS_API_KEY.
    apiKey: st?.apiKey || process.env.ELEVENLABS_API_KEY || '',
    baseUrl: (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, ''),
    // Default giọng/model theo ElevenLabs CHỈ khi provider là elevenlabs — giữ NGUYÊN cache
    // key cũ. Provider khác tự resolve giọng mặc định trong synth (vd CapCut → CAPCUT_VOICE).
    voiceId,
    model:
      overrides?.model ||
      st?.model ||
      (isElevenlabs ? process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' : ''),
    cacheDir: process.env.TTS_CACHE_DIR || path.join('.cache', 'tts'),
  };
}

// Key cache gồm voice + model — đổi giọng/tier không lẫn audio cũ. ElevenLabs GIỮ NGUYÊN
// công thức cũ sha256(text\0voice\0model) để không vô hiệu cache đã trả phí; provider khác
// thêm prefix provider để không đụng cache ElevenLabs cùng text/voice/model.
export function ttsCacheKey(
  text: string,
  voiceId: string,
  model: string,
  provider: string = DEFAULT_PROVIDER_ID,
): string {
  const material =
    provider === 'elevenlabs'
      ? `${text}\x00${voiceId}\x00${model}`
      : `${provider}\x00${text}\x00${voiceId}\x00${model}`;
  return createHash('sha256').update(material).digest('hex');
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
  const provider = getTtsProvider(cfg.provider || DEFAULT_PROVIDER_ID);
  // Giọng dùng cho key phải là giọng SẼ synth: provider resolve default từ ENV khi voiceId
  // rỗng (vd CapCut) → tránh HIT nhầm audio khi đổi giọng mặc định. ElevenLabs không khai báo
  // resolveVoiceId (readTtsConfig đã điền sẵn voiceId) → key giữ nguyên công thức cũ.
  const voiceForKey = provider.resolveVoiceId ? provider.resolveVoiceId(cfg) : cfg.voiceId;
  const key = ttsCacheKey(trimmed, voiceForKey, cfg.model, provider.id);
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

  const audio = await provider.synth(trimmed, cfg);
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
