import { NextResponse } from 'next/server';
import { PROVIDER_PRESETS } from '@/lib/ai-providers';
import {
  readAiSettings,
  writeAiSettings,
  type AiSettings,
  type AiSettingsInput,
  type StageConfig,
  type TtsSettings,
} from '@/lib/settings';

// GET/PUT cấu hình AI + TTS từ Settings dialog.
//
// Luật cứng: API key KHÔNG BAO GIỜ đi ra qua GET. DTO gửi về XOÁ HẲN trường apiKey (chứ
// không mask tại chỗ) và thay bằng hasKey + keyMask — quên xử lý một nhánh nào đó thì cũng
// không còn gì để rò. Client gửi lại `apiKey: null` để giữ nguyên key đang lưu.

function maskKey(key: string): string {
  if (!key) return '';
  // Key ngắn thì 4 ký tự cuối đã là phần lớn key → che trơn, không lộ ký tự nào.
  return key.length >= 8 ? `••••${key.slice(-4)}` : '••••';
}

type StageDto = Omit<StageConfig, 'apiKey'> & { hasKey: boolean; keyMask: string };
type TtsDto = Omit<TtsSettings, 'apiKey'> & { hasKey: boolean; keyMask: string };

function toStageDto(cfg: StageConfig): StageDto {
  const { apiKey, ...rest } = cfg;
  return { ...rest, hasKey: Boolean(apiKey), keyMask: maskKey(apiKey) };
}

function toDto(s: AiSettings | null) {
  if (!s) return null;
  const { apiKey: ttsKey, ...ttsRest } = s.tts ?? { apiKey: '' };
  return {
    version: s.version,
    vision: toStageDto(s.vision),
    script: s.script ? toStageDto(s.script) : null,
    tts: s.tts ? ({ ...ttsRest, hasKey: Boolean(ttsKey), keyMask: maskKey(ttsKey) } as TtsDto) : null,
  };
}

// Biến env chứa key của MỌI preset (dedup) — UI cảnh báo "chưa có key" khi cả ô key lẫn env
// đều trống. Lấy từ catalog thay vì liệt kê tay để thêm provider không phải sửa hai chỗ.
function envKeyStatus(): Record<string, boolean> {
  const names = [...new Set(PROVIDER_PRESETS.map((p) => p.keyEnv))];
  return Object.fromEntries(names.map((k) => [k, Boolean(process.env[k])]));
}

function payload() {
  return {
    settings: toDto(readAiSettings()),
    presets: PROVIDER_PRESETS,
    envKeys: envKeyStatus(),
  };
}

export async function GET() {
  return NextResponse.json(payload());
}

export async function PUT(req: Request) {
  let body: { settings?: unknown };
  try {
    body = (await req.json()) as { settings?: unknown };
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }
  try {
    // settings=null → xóa file, quay về cấu hình theo ENV.
    // Validate + luật sentinel key nằm ở lib/settings.ts — route không nhân đôi.
    writeAiSettings(body.settings === null ? null : (body.settings as AiSettingsInput));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Settings không hợp lệ' },
      { status: 400 },
    );
  }
  return NextResponse.json(payload());
}
