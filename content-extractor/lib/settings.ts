import fs from 'node:fs';
import path from 'node:path';
import {
  PROVIDER_PRESETS,
  defaultMaxTokens,
  getPreset,
  thinkingParams,
  type AiProviderId,
} from './ai-providers';

// Cấu hình AI đổi được từ UI (Settings dialog trong header) — lưu JSON cạnh app, ưu tiên
// hơn ENV. Server-only (dùng fs) — client đi qua /api/settings.
//
// Vision và Biên kịch cấu hình ĐỘC LẬP: mỗi stage có provider/baseURL/model/key riêng.
// `script: null` = biên kịch dùng chung y cấu hình Vision (mặc định) — biểu diễn bằng null
// thay vì cờ boolean để không sinh được state mâu thuẫn.
//
// API key CÓ THỂ nằm trong file này (nhập từ UI, khỏi sửa .env.local + restart). File luôn
// ghi mode 0o600. Key rỗng = rơi về ENV theo provider (OPENAI_API_KEY / ZAI_API_KEY /
// GEMINI_API_KEY / … , fallback cuối là OPENAI_API_KEY).

// Catalog provider nằm ở lib/ai-providers.ts (data thuần, client import được). Re-export
// để call-site cũ không phải đổi import.
export { PROVIDER_PRESETS, getPreset };
export type { AiProviderId, ProviderPreset } from './ai-providers';

export const SETTINGS_VERSION = 2;

export interface StageConfig {
  provider: AiProviderId;
  baseURL: string; // preset tự điền; chỉ nhập tay khi provider='custom'
  model: string; // rỗng = fallback VISION_MODEL/SCRIPT_MODEL của ENV
  apiKey: string; // rỗng = fallback ENV theo keyEnv của provider
  disableThinking: boolean; // param tắt reasoning — dạng param tùy provider (ai-providers.ts)
}

export interface TtsSettings {
  provider: string;
  voiceId: string;
  model: string;
  apiKey: string;
}

export interface AiSettings {
  version: typeof SETTINGS_VERSION;
  vision: StageConfig;
  script: StageConfig | null; // null = dùng chung cấu hình Vision
  tts: TtsSettings | null; // null = TTS theo ENV như trước
}

// Shape client GỬI LÊN: apiKey nhận thêm null = "giữ nguyên key đang lưu" (client không bao
// giờ nhận được key thật nên không thể gửi lại nó).
type KeySentinel<T> = Omit<T, 'apiKey'> & { apiKey?: string | null };
export interface AiSettingsInput {
  vision: KeySentinel<StageConfig>;
  script?: KeySentinel<StageConfig> | null;
  tts?: KeySentinel<TtsSettings> | null;
}

// Đường dẫn file settings — env SETTINGS_FILE để test/e2e cô lập (trỏ path không tồn tại
// khi cần đảm bảo chạy ENV thuần, không ăn nhầm settings của dev cùng thư mục).
export function settingsFilePath(): string {
  return process.env.SETTINGS_FILE || path.join(process.cwd(), '.settings.json');
}

// Cache theo mtime: route handler gọi mỗi request, tránh parse lại khi file không đổi.
let cache: { file: string; mtimeMs: number; value: AiSettings } | null = null;

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function sanitizeStage(raw: unknown): StageConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const provider = PROVIDER_PRESETS.find((p) => p.id === obj.provider)?.id;
  if (!provider) return null;
  // Preset thì baseURL PIN theo preset (chọn "OpenAI" là đúng endpoint OpenAI — không cho
  // body/file tự chế trỏ nơi khác dưới nhãn preset); muốn endpoint tùy ý dùng 'custom'.
  const baseURL =
    provider === 'custom' ? asString(obj.baseURL).replace(/\/$/, '') : getPreset(provider).baseURL;
  if (!baseURL) return null; // custom bắt buộc có baseURL
  return {
    provider,
    baseURL,
    model: asString(obj.model),
    apiKey: asString(obj.apiKey), // trim: key dán từ web hay dính \n cuối
    disableThinking: obj.disableThinking === true,
  };
}

function sanitizeTts(raw: unknown): TtsSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const provider = asString(obj.provider);
  if (!provider) return null; // id provider được validate ở lib/tts.ts khi thực sự synth
  return {
    provider,
    voiceId: asString(obj.voiceId),
    model: asString(obj.model),
    apiKey: asString(obj.apiKey),
  };
}

// File v1 (shape phẳng, không có `version`) → v2 trong BỘ NHỚ. File trên đĩa chỉ nâng lên v2
// ở lần writeAiSettings kế tiếp — đọc là thao tác chỉ-đọc, không gây side effect bất ngờ.
function migrateV1(obj: Record<string, unknown>): AiSettings | null {
  const vision = sanitizeStage({
    provider: obj.provider,
    baseURL: obj.baseURL,
    model: obj.visionModel,
    apiKey: '',
    disableThinking: obj.disableThinking,
  });
  if (!vision) return null;
  return {
    version: SETTINGS_VERSION,
    vision,
    // v1 dùng một provider cho cả hai stage, chỉ khác model → script thừa hưởng phần còn lại.
    // KHÔNG rút gọn "scriptModel rỗng → script: null": ở v1 rỗng nghĩa là RƠI VỀ SCRIPT_MODEL
    // env, còn null ở v2 nghĩa là dùng y model của vision — hai thứ khác nhau. Giữ script là
    // config riêng với model rỗng thì hành vi trùng khít v1 (AC6).
    script: { ...vision, model: asString(obj.scriptModel) },
    tts: null,
  };
}

function sanitize(raw: unknown): AiSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version === undefined) return migrateV1(obj);
  const vision = sanitizeStage(obj.vision);
  if (!vision) return null;
  let script: StageConfig | null = null;
  if (obj.script !== null && obj.script !== undefined) {
    script = sanitizeStage(obj.script);
    // script CÓ MẶT nhưng hỏng → cả file coi như hỏng. Rơi âm thầm về "dùng chung vision"
    // sẽ chạy biên kịch bằng provider khác cái người dùng đã chọn — sai lặng lẽ, tệ hơn.
    if (!script) return null;
  }
  return { version: SETTINGS_VERSION, vision, script, tts: sanitizeTts(obj.tts) };
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
    // Thông điệp CHỈ nêu lý do parse — không bao giờ in nội dung file (có thể chứa key).
    console.warn(`[settings] Bỏ qua ${file} (${err instanceof Error ? err.message : err})`);
    cache = null;
    return null;
  }
}

// Sentinel 3 trạng thái: null/thiếu = giữ key đang lưu · "" = xoá về ENV · chuỗi = key mới.
function resolveKeySentinel(next: string | null | undefined, prev: string | undefined): string {
  if (next === null || next === undefined) return prev ?? '';
  const trimmed = next.trim();
  // Client hiển thị key dạng mask (••••1234) — gửi lại chuỗi đó nghĩa là UI đang đổ mask vào
  // ô nhập, và ghi tiếp sẽ phá key thật. Chặn ngay tại đây làm lưới an toàn cuối.
  if (trimmed.startsWith('•')) {
    throw new Error('Không nhận chuỗi mask làm API key — để trống ô key nếu muốn giữ key hiện tại.');
  }
  return trimmed;
}

// settings=null → xóa file (nút "Dùng theo ENV").
export function writeAiSettings(settings: AiSettingsInput | null): void {
  const file = settingsFilePath();
  if (settings === null) {
    cache = null;
    fs.rmSync(file, { force: true });
    return;
  }
  const prev = readAiSettings(); // đọc TRƯỚC khi bỏ cache — cần key cũ cho sentinel null
  cache = null;
  // Key THUỘC VỀ một nhà cung cấp: chỉ thừa kế khi provider không đổi. Thiếu điều kiện này,
  // đổi provider mà không gõ lại ô key sẽ LƯU key nhà cũ dưới nhãn nhà mới rồi GỬI secret
  // sang đó — và vì cfg.apiKey khác rỗng nên resolveApiKey không bao giờ rơi về ENV đúng.
  const keyOf = (cfg: StageConfig | null | undefined, provider: unknown) =>
    cfg && cfg.provider === provider ? cfg.apiKey : undefined;
  const prevVision = prev?.vision;
  const merged = {
    version: SETTINGS_VERSION,
    vision: {
      ...settings.vision,
      apiKey: resolveKeySentinel(settings.vision?.apiKey, keyOf(prevVision, settings.vision?.provider)),
    },
    script:
      settings.script === null || settings.script === undefined
        ? null
        : {
            ...settings.script,
            // Tách script khỏi vision (trước đó dùng chung) → thừa kế key vision, nếu không
            // thao tác "bỏ tick dùng chung" sẽ làm gãy cấu hình đang chạy được. Vẫn phải
            // cùng provider — khác provider thì để rỗng, rơi về ENV của nhà đó.
            apiKey: resolveKeySentinel(
              settings.script.apiKey,
              keyOf(prev?.script, settings.script.provider) ??
                keyOf(prevVision, settings.script.provider),
            ),
          },
    tts:
      settings.tts === null || settings.tts === undefined
        ? null
        : {
            ...settings.tts,
            apiKey: resolveKeySentinel(
              settings.tts.apiKey,
              prev?.tts && prev.tts.provider === settings.tts.provider ? prev.tts.apiKey : undefined,
            ),
          },
  };
  const clean = sanitize(merged);
  if (!clean) throw new Error('Settings không hợp lệ');
  // mode 0o600: file chứa API key. mode của writeFileSync chỉ áp cho file MỚI tạo → chmod
  // thêm cho file đã tồn tại (vd file v1 cũ ghi ở 0o644).
  fs.writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// Config hiệu dụng của một stage — script null nghĩa là dùng chung y hệt vision.
export function stageConfig(s: AiSettings, stage: 'vision' | 'script'): StageConfig {
  return stage === 'script' ? (s.script ?? s.vision) : s.vision;
}

// Key: settings > ENV riêng của provider > OPENAI_API_KEY. Nhờ fallback cuối, khai báo mọi
// key một lần trong .env.local rồi đổi provider tự do vẫn chạy.
export function resolveApiKey(cfg: StageConfig): { apiKey: string; keyEnv: string } {
  const { keyEnv } = getPreset(cfg.provider);
  return {
    apiKey: cfg.apiKey || process.env[keyEnv] || process.env.OPENAI_API_KEY || '',
    keyEnv,
  };
}

// Key dùng cho một request THỬ từ Settings dialog (liệt kê model / kiểm tra kết nối):
// ô key người dùng vừa gõ (chưa Lưu) thắng; bỏ trống → key đã lưu của stage đó (chỉ khi
// cùng provider — key của provider khác chắc chắn sai), cuối cùng là ENV.
//
// baseURL phải truyền vào vì với provider 'custom', HOST ĐÍCH do client chọn. Ở đó tuyệt
// đối KHÔNG được rơi về ENV: nếu không, một trang web bất kỳ đang mở cùng trình duyệt chỉ
// cần POST {provider:'custom', baseURL:'http://kẻ-tấn-công'} là server tự đính OPENAI_API_KEY
// của người dùng vào rồi gửi đi (confused deputy — họ không cần đọc response). Với 'custom',
// key chỉ đến từ ô người dùng vừa gõ, hoặc key đã lưu CHO ĐÚNG baseURL đó.
export function resolveProbeApiKey(
  provider: AiProviderId,
  draft: string | null | undefined,
  stage: 'vision' | 'script' = 'vision',
  baseURL = '',
): string {
  const typed = typeof draft === 'string' ? draft.trim() : '';
  // Chuỗi mask không phải key — bỏ qua, rơi xuống key đã lưu (chính là cái mask đại diện).
  if (typed && !typed.startsWith('•')) return typed;
  const settings = readAiSettings();
  const saved = settings ? stageConfig(settings, stage) : null;
  const savedKey = saved?.provider === provider ? saved.apiKey : '';
  if (provider === 'custom') {
    return saved && saved.baseURL === baseURL ? savedKey : '';
  }
  return resolveApiKey({
    provider,
    baseURL: '',
    model: '',
    apiKey: savedKey,
    disableThinking: false,
  }).apiKey;
}

// Chặn cross-site cho các route "gọi ra ngoài kèm key". KHÔNG phải auth (app local
// single-user, mọi route /api/* đều không auth — đó là posture đã chốt): chỉ để một trang
// web khác đang mở trong cùng trình duyệt không sai khiến được server gửi key đi.
// Header vắng mặt (curl, CLI, test gọi thẳng hàm route) được cho qua.
export function isCrossSiteRequest(req: Request): boolean {
  return req.headers.get('sec-fetch-site') === 'cross-site';
}

// baseURL hiệu dụng cho request thử: preset PIN theo preset, chỉ 'custom' nhận baseURL do
// client gửi. Không pin thì một trang bất kỳ có thể bảo route gửi key của người dùng tới
// host do nó chọn.
export function resolveProbeBaseURL(provider: AiProviderId, draft: unknown): string {
  if (provider !== 'custom') return getPreset(provider).baseURL;
  return typeof draft === 'string' ? draft.trim().replace(/\/$/, '') : '';
}

// Trần token output. Để trống = giữ mặc định của endpoint. Đặt khi model reasoning
// (Gemini 2.5, GLM) đốt ngân sách output vào phần suy nghĩ làm JSON bị cắt giữa chừng.
export const MAX_TOKENS_ENV = 'MODEL_MAX_TOKENS';

function envMaxTokens(): number | undefined {
  const n = Number.parseInt(process.env[MAX_TOKENS_ENV] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Param ngoài chuẩn OpenAI gửi kèm mỗi request, tính SẴN ở tầng config để vision.ts/script.ts
// không phải biết provider nào có quirk gì. Toàn bộ tri thức đó nằm ở lib/ai-providers.ts.
export function stageExtraParams(cfg: StageConfig): Record<string, unknown> {
  const maxTokens = envMaxTokens() ?? defaultMaxTokens(cfg.provider);
  return {
    ...thinkingParams(cfg.provider, cfg.disableThinking),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };
}

// Nhánh ENV thuần (chưa cấu hình từ UI) — GIỮ NGUYÊN hành vi cũ, không suy diễn gì thêm:
//   • cờ VISION_DISABLE_THINKING/SCRIPT_DISABLE_THINKING vẫn gửi thẳng param GLM bất kể
//     endpoint nào. Suy provider từ chuỗi host sẽ nuốt param với endpoint GLM không nằm ở
//     api.z.ai (open.bigmodel.cn, proxy nội bộ) — mất ~50% token tiết kiệm mà không có lỗi.
//     Ai bật cờ này là chủ động chọn; endpoint không hiểu thì trước nay vẫn thế.
//   • trần token chỉ theo MODEL_MAX_TOKENS, KHÔNG áp mặc định theo provider.
// Muốn engine chọn đúng dạng param theo nhà cung cấp thì cấu hình từ UI (stageExtraParams).
export function envExtraParams(disableThinking: boolean): Record<string, unknown> {
  const maxTokens = envMaxTokens();
  return {
    ...(disableThinking ? { thinking: { type: 'disabled' } } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };
}
