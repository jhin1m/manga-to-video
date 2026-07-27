// Catalog nhà cung cấp AI dạng DỮ LIỆU THUẦN (chỉ `import type`, không node builtin, không
// process.env) → client component (Settings dialog) import trực tiếp, khỏi fetch preset qua
// HTTP. Cùng khuôn với lib/tts-providers/catalog.ts.
//
// Đây là NƠI DUY NHẤT biết quirk của từng provider: baseURL, biến env chứa key, có nhận ảnh
// hay không, param tắt reasoning, trần token output. lib/settings.ts, lib/vision.ts,
// lib/script.ts và UI đều đọc từ đây — thêm provider mới chỉ sửa file này.

export type AiProviderId =
  | 'openai'
  | 'zai'
  | 'zai-coding'
  | 'openrouter'
  | 'google'
  | 'deepseek'
  | 'groq'
  | 'custom';

export interface ProviderPreset {
  id: AiProviderId;
  label: string;
  /** Endpoint OpenAI-compatible, đã chuẩn hóa (KHÔNG slash cuối — SDK tự nối `/chat/completions`).
   *  Rỗng với 'custom': người dùng tự nhập. */
  baseURL: string;
  /** Biến env chứa API key của provider này (đường lùi khi settings không lưu key). */
  keyEnv: string;
  /** false = text-only → UI cảnh báo khi chọn cho stage Vision. */
  vision: boolean;
  /** Gợi ý ghim đầu datalist — /models của phần lớn provider KHÔNG cho biết model nào nhận ảnh. */
  visionModels: string[];
  scriptModels: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    vision: true,
    visionModels: ['gpt-4o-mini', 'gpt-4o'],
    scriptModels: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'zai',
    label: 'Z.AI (trả theo token)',
    baseURL: 'https://api.z.ai/api/paas/v4',
    keyEnv: 'ZAI_API_KEY',
    vision: true,
    visionModels: ['glm-4.5v', 'glm-4.6v'],
    scriptModels: ['glm-4.6', 'glm-4.5'],
  },
  {
    id: 'zai-coding',
    label: 'Z.AI (gói Coding Plan)',
    baseURL: 'https://api.z.ai/api/coding/paas/v4',
    keyEnv: 'ZAI_API_KEY',
    vision: true,
    visionModels: ['glm-4.5v', 'glm-4.6v'],
    scriptModels: ['glm-4.6', 'glm-4.5'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    vision: true,
    visionModels: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini'],
    scriptModels: ['google/gemini-2.5-flash', 'openai/gpt-4o'],
  },
  {
    id: 'google',
    label: 'Google AI Studio (Gemini)',
    // Lớp OpenAI-compatible của Generative Language API. Đường native /v1beta/models là
    // đường lùi riêng cho việc liệt kê model (xem app/api/settings/models).
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    vision: true,
    visionModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    scriptModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek (chỉ văn bản)',
    baseURL: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    vision: false, // không nhận ảnh → chọn cho stage Vision là hỏng cả pipeline
    visionModels: [],
    scriptModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    vision: true,
    visionModels: ['meta-llama/llama-4-scout-17b-16e-instruct'],
    scriptModels: ['llama-3.3-70b-versatile'],
  },
  {
    id: 'custom',
    label: 'Tùy chỉnh (OpenAI-compatible)',
    baseURL: '',
    keyEnv: 'OPENAI_API_KEY',
    vision: true, // endpoint lạ — không đoán thay người dùng, không cảnh báo sai
    visionModels: [],
    scriptModels: [],
  },
];

export function getPreset(id: AiProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0];
}

export function isZaiProvider(id: AiProviderId): boolean {
  return id === 'zai' || id === 'zai-coding';
}

// Param tắt "thinking/reasoning" — mỗi nhà cung cấp gọi một kiểu, và gửi param của nhà này
// sang nhà kia thường ăn 400. Provider không hỗ trợ → {} (UI ẩn luôn công tắc).
export function thinkingParams(id: AiProviderId, disable: boolean): Record<string, unknown> {
  if (!disable) return {};
  if (isZaiProvider(id)) return { thinking: { type: 'disabled' } };
  if (id === 'google') return { reasoning_effort: 'none' };
  if (id === 'openrouter') return { reasoning: { exclude: true } };
  return {};
}

// Trần token output mặc định khi ENV MODEL_MAX_TOKENS để trống. undefined = giữ mặc định
// của endpoint. Đặt cho model reasoning (Gemini 2.5, GLM): phần suy nghĩ ăn hết ngân sách
// output làm JSON bị cắt giữa chừng (finish_reason=length).
export function defaultMaxTokens(id: AiProviderId): number | undefined {
  return id === 'google' || isZaiProvider(id) ? 16384 : undefined;
}
