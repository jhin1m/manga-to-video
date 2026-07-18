import fs from 'node:fs';
import path from 'node:path';

// Cấu hình AI đổi được từ UI (Settings dialog trong header) — lưu JSON cạnh app, ưu tiên
// hơn ENV cho CẢ vision lẫn biên kịch. Server-only (dùng fs) — client đi qua /api/settings.
//
// Luật ưu tiên: có file settings → settings quyết định provider/baseURL/model/thinking cho
// cả hai stage (bỏ qua SCRIPT_BASE_URL/SCRIPT_API_KEY vì key phải khớp provider đã chọn);
// không có file → hành vi ENV thuần như trước, không đổi gì.
//
// API key KHÔNG BAO GIỜ nằm trong file này — key luôn ở .env.local, chọn theo provider:
// OPENAI_API_KEY / ZAI_API_KEY / OPENROUTER_API_KEY (thiếu key riêng → fallback OPENAI_API_KEY).

export type AiProviderId = 'openai' | 'zai' | 'zai-coding' | 'openrouter' | 'custom';

export interface AiSettings {
  provider: AiProviderId;
  baseURL: string; // preset tự điền; chỉ nhập tay khi provider='custom'
  visionModel: string; // rỗng = fallback VISION_MODEL/mặc định
  scriptModel: string; // rỗng = fallback SCRIPT_MODEL/mặc định
  disableThinking: boolean; // param thinking:{type:'disabled'} riêng GLM — chỉ áp khi provider z.ai
}

export interface ProviderPreset {
  id: AiProviderId;
  label: string;
  baseURL: string; // rỗng với 'custom' — người dùng tự nhập
  keyEnv: string; // biến env chứa API key của provider này
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  { id: 'zai', label: 'Z.AI (trả theo token)', baseURL: 'https://api.z.ai/api/paas/v4', keyEnv: 'ZAI_API_KEY' },
  { id: 'zai-coding', label: 'Z.AI (gói Coding Plan)', baseURL: 'https://api.z.ai/api/coding/paas/v4', keyEnv: 'ZAI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  { id: 'custom', label: 'Tùy chỉnh (OpenAI-compatible)', baseURL: '', keyEnv: 'OPENAI_API_KEY' },
];

export function getPreset(id: AiProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0];
}

export function isZaiProvider(id: AiProviderId): boolean {
  return id === 'zai' || id === 'zai-coding';
}

// Đường dẫn file settings — env SETTINGS_FILE để test/e2e cô lập (trỏ path không tồn tại
// khi cần đảm bảo chạy ENV thuần, không ăn nhầm settings của dev cùng thư mục).
export function settingsFilePath(): string {
  return process.env.SETTINGS_FILE || path.join(process.cwd(), '.settings.json');
}

// Cache theo mtime: route handler gọi mỗi request, tránh parse lại khi file không đổi.
let cache: { file: string; mtimeMs: number; value: AiSettings } | null = null;

function sanitize(raw: unknown): AiSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const provider = PROVIDER_PRESETS.find((p) => p.id === obj.provider)?.id;
  if (!provider) return null;
  const preset = getPreset(provider);
  // Preset thì baseURL PIN theo preset (chọn "OpenAI" là đúng endpoint OpenAI — không cho
  // body/file tự chế trỏ nơi khác dưới nhãn preset); muốn endpoint tùy ý dùng 'custom'.
  const baseURL =
    provider === 'custom'
      ? typeof obj.baseURL === 'string'
        ? obj.baseURL.trim().replace(/\/$/, '')
        : ''
      : preset.baseURL;
  if (!baseURL) return null; // custom bắt buộc có baseURL
  return {
    provider,
    baseURL,
    visionModel: typeof obj.visionModel === 'string' ? obj.visionModel.trim() : '',
    scriptModel: typeof obj.scriptModel === 'string' ? obj.scriptModel.trim() : '',
    disableThinking: obj.disableThinking === true,
  };
}

// null = chưa cấu hình từ UI (hoặc file hỏng) → caller dùng ENV thuần.
export function readAiSettings(): AiSettings | null {
  const file = settingsFilePath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    cache = null;
    return null; // chưa có file — trạng thái bình thường
  }
  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs) return cache.value;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return null; // file rỗng (vd SETTINGS_FILE=/dev/null khi test) = chưa cấu hình
    const value = sanitize(JSON.parse(raw));
    if (!value) throw new Error('shape không hợp lệ');
    cache = { file, mtimeMs: stat.mtimeMs, value };
    return value;
  } catch (err) {
    // File hỏng → coi như chưa cấu hình (fallback ENV), không sập pipeline.
    console.warn(`[settings] Bỏ qua ${file} (${err instanceof Error ? err.message : err})`);
    cache = null;
    return null;
  }
}

// settings=null → xóa file (nút "Dùng theo ENV").
export function writeAiSettings(settings: AiSettings | null): void {
  const file = settingsFilePath();
  cache = null;
  if (settings === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  const clean = sanitize(settings);
  if (!clean) throw new Error('Settings không hợp lệ');
  fs.writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
}

// Key theo provider: ưu tiên biến env riêng (OPENROUTER_API_KEY/ZAI_API_KEY), fallback
// OPENAI_API_KEY — nhờ đó khai báo mọi key một lần trong .env.local rồi đổi provider tự do.
export function resolveApiKey(provider: AiProviderId): { apiKey: string; keyEnv: string } {
  const { keyEnv } = getPreset(provider);
  return { apiKey: process.env[keyEnv] || process.env.OPENAI_API_KEY || '', keyEnv };
}
