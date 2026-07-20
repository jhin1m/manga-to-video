import OpenAI from 'openai';
import sharp from 'sharp';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { SceneContent } from './schema';
import { isZaiProvider, readAiSettings, resolveApiKey } from './settings';

export interface VisionConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  maxEdge: number;
  concurrency: number;
  disableThinking: boolean;
  rpm: number; // nhịp tối đa (requests/phút) khi chạy vision hàng loạt — chặn 429 chủ động
}

export function readVisionConfig(): VisionConfig {
  const maxEdge = Number.parseInt(process.env.MAX_EDGE ?? '', 10);
  const concurrency = Number.parseInt(process.env.VISION_CONCURRENCY ?? '', 10);
  const rpm = Number.parseInt(process.env.VISION_RPM ?? '', 10);
  const tuning = {
    maxEdge: Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : 1568,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 4,
    rpm: Number.isFinite(rpm) && rpm > 0 ? rpm : 30,
  };

  // Có settings từ UI → settings quyết định provider/model/thinking; key vẫn lấy từ ENV
  // theo provider. Cờ disableThinking chỉ áp cho z.ai — provider khác không nhận param GLM.
  const settings = readAiSettings();
  if (settings) {
    const { apiKey, keyEnv } = resolveApiKey(settings.provider);
    if (!apiKey) {
      throw new Error(
        `Thiếu ${keyEnv} (hoặc OPENAI_API_KEY) trong .env.local cho provider "${settings.provider}" đã chọn ở Settings.`,
      );
    }
    return {
      apiKey,
      baseURL: settings.baseURL,
      model: settings.visionModel || process.env.VISION_MODEL || 'gpt-4o-mini',
      disableThinking: isZaiProvider(settings.provider) && settings.disableThinking,
      ...tuning,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu OPENAI_API_KEY — khai báo trong .env.local (xem .env.example).');
  }
  return {
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.VISION_MODEL || 'gpt-4o-mini',
    disableThinking: /^(true|1|yes)$/i.test(process.env.VISION_DISABLE_THINKING ?? ''),
    ...tuning,
  };
}

const PROMPT = `Bạn là công cụ trích xuất nội dung trang manga cho pipeline thuyết minh.
ĐỌC KỸ trang truyện trong ảnh rồi trả về DUY NHẤT một JSON thô (không markdown, không lời dẫn, không giải thích) đúng dạng:
{"description": string, "dialogue": string[], "note": string}

Quy tắc — MỌI giá trị đều bằng tiếng Việt:
- "description": mô tả những gì đang diễn ra trong trang (nhân vật, hành động, bối cảnh, cảm xúc). Độ dài thích ứng theo nội dung: trang đơn giản thì ngắn gọn, trang nhiều diễn biến thì chi tiết hơn. Chỉ mô tả những gì nhìn thấy, không suy diễn thêm, không viết lời bình sẵn. Luôn mô tả KHÁCH QUAN ở ngôi thứ ba (gọi nhân vật bằng tên nếu biết, hoặc "chàng trai/cô gái/người đàn ông…") — kể cả khi trang là độc thoại nội tâm ngôi "tôi/ta", description KHÔNG được viết ở ngôi thứ nhất.
- "dialogue": lời thoại trong các khung/bong bóng thoại, DỊCH sang tiếng Việt (ngôn ngữ gốc có thể là Nhật/Hàn/Anh/Trung), xếp theo đúng thứ tự đọc. Để mảng rỗng [] nếu trang không có thoại.
- "note": để chuỗi rỗng "" trừ khi thật sự có điều đáng lưu ý: hiệu ứng âm thanh/từ tượng thanh nổi bật, chuyển cảnh, chi tiết nền quan trọng cho mạch truyện, hoặc cảnh báo ảnh mờ/chữ khó đọc (độ tin cậy thấp).`;

// Ghép ngữ cảnh chương (nhân vật/xưng hô/bối cảnh, người dùng nhập) vào prompt vision.
// Guardrail bắt buộc: ngữ cảnh chỉ để gọi tên + chọn xưng hô khi dịch thoại — nếu không
// chặn, model "nhìn thấy" cả nhân vật không có trong ảnh (context bleed). Rỗng = prompt y cũ.
export function buildVisionPrompt(context?: string): string {
  const trimmed = context?.trim();
  if (!trimmed) return PROMPT;
  return `${PROMPT}

Ngữ cảnh chương (người dùng cung cấp — CHỈ dùng để gọi đúng tên nhân vật và chọn đúng đại từ xưng hô khi dịch thoại; KHÔNG mô tả nhân vật/sự kiện không xuất hiện trong ảnh, KHÔNG chép ngữ cảnh này vào description):
${trimmed}`;
}

// Cờ adaptive process-wide: thử response_format json_object; nếu endpoint trả 400 VÌ
// json-mode thì tắt vĩnh viễn cho tiến trình này và gọi lại không kèm response_format.
let jsonModeSupported = true;

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

// Chỉ 400 NÓI VỀ json-mode mới được TẮT CỜ VĨNH VIỄN. Trước đây mọi 400 đều tắt cờ, nên
// một ảnh quá khổ hay một lần content-filter là cả tiến trình mất json-mode — các panel
// sau đó trả prose/fence và hỏng parse hàng loạt.
// Vẫn thử lại không-json-mode cho MỌI 400 (giữ đường lùi khi endpoint từ chối bằng thông
// báo mơ hồ); chỉ khác ở chỗ lần từ chối mơ hồ không kéo theo cả các lần gọi sau.
function isJsonModeRejection(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /response_format|json_object|json mode|json_schema|json schema/.test(msg);
}

// Trần token output. Để trống = giữ mặc định của endpoint. Đặt khi model reasoning
// (Gemini 2.5, GLM) đốt ngân sách output vào phần suy nghĩ làm JSON bị cắt giữa chừng.
const MAX_TOKENS_ENV = 'MODEL_MAX_TOKENS';

function readMaxTokens(): number | undefined {
  const n = Number.parseInt(process.env[MAX_TOKENS_ENV] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Trích đoạn output model cho log/thông báo lỗi: giữ đầu + đuôi, bỏ giữa. Thiếu cái này
// thì lỗi parse là hộp đen — không biết model trả fence, trả prose, hay JSON bị cắt.
export function snippet(raw: string | null | undefined, keep = 180): string {
  const text = (raw ?? '').trim();
  if (!text) return '(rỗng)';
  if (text.length <= keep * 2) return text;
  return `${text.slice(0, keep)} …[bỏ ${text.length - keep * 2} ký tự]… ${text.slice(-keep)}`;
}

// Lỗi output model không dùng được. Mặc định retryable: output hỏng thường là ngẫu nhiên,
// gọi lại là qua. retryable=false cho trường hợp gọi lại chắc chắn hỏng y hệt (bị cắt do
// chạm trần token) — retry ở đó chỉ đốt tiền.
export class ModelOutputError extends Error {
  readonly raw: string;
  readonly retryable: boolean;

  constructor(message: string, raw: string | null | undefined, retryable = true) {
    super(`${message} — model trả về: ${snippet(raw)}`);
    this.name = 'ModelOutputError';
    this.raw = raw ?? '';
    this.retryable = retryable;
  }
}

function isRetryable(err: unknown): boolean {
  // Lỗi tự đánh dấu non-retryable (vd CapCut ret!=0 "shark block only") → không retry mù.
  if (err && typeof err === 'object' && (err as { retryable?: boolean }).retryable === false) {
    return false;
  }
  const s = statusOf(err);
  if (s === 429) return true;
  if (s !== undefined && s >= 500) return true;
  // Không có HTTP status → lỗi mạng/timeout từ SDK
  return s === undefined;
}

// Retry 429/5xx/lỗi mạng với backoff mũ — dùng chung cho vision, script (biên kịch) và TTS.
// fn nhận số lần đã thử (0-based) để lần sau đổi cách gọi (vd kèm lời nhắc sửa JSON).
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === tries - 1) throw err;
      const delay = 500 * 2 ** attempt + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Gọi chat.completions với json-mode adaptive + tắt thinking — dùng chung cho vision và
// script (biên kịch). Cờ jsonModeSupported process-wide: endpoint từ chối json-mode một lần
// thì thôi luôn (mất tối ưu, không mất đúng đắn). jsonMode=false cho output văn bản thuần
// (vd recap) — ép json_object ở đó làm model trả JSON dù prompt đòi plain text.
export async function createCompletion(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  disableThinking: boolean,
  jsonMode = true,
): Promise<ChatCompletion> {
  // Với model reasoning của z.ai (GLM), tắt "thinking" giảm ~50% token cho tác vụ đọc
  // ảnh vốn không cần suy luận sâu. Param ngoài chuẩn OpenAI nên cast qua base type.
  const maxTokens = readMaxTokens();
  const extra = {
    ...(disableThinking ? { thinking: { type: 'disabled' } } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };
  if (jsonModeSupported && jsonMode) {
    try {
      return await client.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        ...extra,
      } as ChatCompletionCreateParamsNonStreaming);
    } catch (err) {
      if (statusOf(err) !== 400) throw err;
      if (isJsonModeRejection(err)) {
        jsonModeSupported = false; // endpoint không hỗ trợ json-mode — thôi hẳn
        console.warn('[model] endpoint từ chối json-mode — tắt cho tiến trình này');
      } else {
        // 400 vì lý do khác (ảnh quá khổ, content-filter…): thử lại không json-mode để
        // giữ đường lùi, nhưng KHÔNG tắt cờ — lần gọi sau vẫn được dùng json-mode.
        console.warn(`[model] 400 không rõ có phải do json-mode — thử lại không kèm: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return client.chat.completions.create({
    model,
    messages,
    ...extra,
  } as ChatCompletionCreateParamsNonStreaming);
}

// Lần thử lại kèm lời nhắc: model vừa trả sai định dạng, nhắc lại luật để nó không lặp
// đúng lỗi cũ (đặc biệt khi endpoint không có json-mode nên chỉ còn prompt giữ format).
const REPAIR_NUDGE: ChatCompletionMessageParam = {
  role: 'user',
  content:
    'Lần trả lời trước KHÔNG parse được thành JSON. Trả lời lại DUY NHẤT một object JSON thô hợp lệ: không markdown, không dấu ```, không lời dẫn, không khối suy nghĩ, không văn bản nào ngoài JSON.',
};

// Gọi model rồi parse JSON NGAY TRONG vòng retry. Parse nằm ngoài retry là sai: output
// hỏng ngẫu nhiên (rò khối suy nghĩ, thêm lời dẫn, thoại chưa escape) thì hỏng luôn cả
// job, trong khi 429 lại được thử tới 4 lần — cùng một mức "lỗi tạm thời".
export async function completeJson<T>(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  disableThinking: boolean,
  parse: (raw: string | null | undefined) => T,
  label: string,
): Promise<T> {
  return withRetry(async (attempt) => {
    const res = await createCompletion(
      client,
      model,
      attempt === 0 ? messages : [...messages, REPAIR_NUDGE],
      disableThinking,
    );
    const choice = res.choices[0];
    const finish = choice?.finish_reason;
    if (res.usage) {
      console.log(`[${label}] tokens=${res.usage.total_tokens} finish=${finish ?? '?'}`);
    }
    const content = choice?.message?.content;
    try {
      return parse(content);
    } catch (err) {
      // finish_reason='length' = chạm trần token, output cắt giữa chừng. Gọi lại y hệt sẽ
      // cắt y hệt → báo cách chữa thay vì đốt thêm 3 lượt.
      if (finish === 'length') {
        // KHÔNG khuyên "tắt reasoning": công tắc disableThinking ở Settings hiện chỉ áp
        // cho z.ai (isZaiProvider), nên với OpenRouter/OpenAI nó là no-op — chỉ nêu hai
        // cách thật sự có tác dụng hôm nay.
        throw new ModelOutputError(
          `Output bị cắt vì chạm trần token (finish_reason=length). Tăng ${MAX_TOKENS_ENV} trong .env.local, hoặc chia nhỏ đầu vào (bớt số band mỗi lần tạo kịch bản)`,
          content,
          false,
        );
      }
      console.warn(
        `[${label}] parse lỗi lần ${attempt + 1} (finish=${finish ?? '?'}): ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  });
}

// Gỡ nhiễu quanh JSON: khối suy nghĩ của model reasoning và ```fence (kể cả fence mở mà
// chưa đóng vì output bị cắt). Khối suy nghĩ phải bỏ TRƯỚC khi dò '{' — bên trong nó
// thường có ngoặc, mọi cách dò sẽ bám nhầm vào đoạn suy nghĩ thay vì câu trả lời.
function stripNoise(raw: string | null | undefined): string {
  let text = (raw ?? '').trim();
  if (!text) return '';
  text = text
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/^[\s\S]*?<\/(?:think|thinking|reasoning)>/i, '')
    .trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const openFence = text.match(/```(?:json)?\s*([\s\S]*)$/i);
  if (openFence) return openFence[1].trim();
  return text;
}

// Cắt object JSON đầu tiên CÂN BẰNG ngoặc, bỏ qua ngoặc nằm trong chuỗi (tính cả escape).
// Cặp indexOf('{')/lastIndexOf('}') thô sai hai kiểu: ôm nhầm khi model in thêm chữ sau
// JSON, và khi output bị cắt giữa chừng thì tóm '}' của phần tử con → slice lệch ngoặc.
// null = không có object nào đóng đủ (gần như luôn là output bị cắt).
function sliceBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// Rút object JSON từ output model: chịu ```json fences, lời dẫn trước/sau, khối suy nghĩ
// — dùng chung cho parseSceneJSON (vision) và parse kịch bản (script).
export function extractJson(raw: string | null | undefined): unknown {
  const text = stripNoise(raw);
  if (!text) throw new ModelOutputError('Model trả về không đúng JSON (rỗng)', raw);
  const candidate = sliceBalancedObject(text);
  if (!candidate) {
    throw new ModelOutputError(
      'Model trả về không đúng JSON (không có object đóng đủ ngoặc — nhiều khả năng output bị cắt giữa chừng)',
      raw,
    );
  }
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new ModelOutputError(
      `Model trả về không đúng JSON (${err instanceof Error ? err.message : 'parse lỗi'})`,
      raw,
    );
  }
}

export function parseSceneJSON(raw: string | null | undefined): SceneContent {
  const obj = extractJson(raw) as Record<string, unknown>;
  const dialogue = Array.isArray(obj.dialogue)
    ? obj.dialogue.map((d) => String(d))
    : obj.dialogue != null && obj.dialogue !== ''
      ? [String(obj.dialogue)]
      : [];
  return {
    description: obj.description != null ? String(obj.description) : '',
    dialogue,
    note: obj.note != null ? String(obj.note) : '',
  };
}

export function classifyError(err: unknown): string {
  const s = statusOf(err);
  if (s === 401) return 'Sai API key hoặc không có quyền truy cập (401)';
  if (s === 429) return 'Bị giới hạn tần suất (429)';
  if (s !== undefined && s >= 500) return `Lỗi máy chủ vision (${s})`;
  const msg = err instanceof Error ? err.message : String(err);
  return msg || 'Lỗi không xác định';
}

// Chốt chặn hợp đồng MAX_EDGE ngay trước khi encode: mọi ảnh gửi model đều ≤ maxEdge
// mỗi cạnh, bất kể nguồn (trang Stage 1, slice dải dọc giữ chiều cao, crop band 2A).
// Không tái dùng pipeline.downscale để tránh import vòng (pipeline → vision).
async function boundForVision(buffer: Buffer, maxEdge: number): Promise<Buffer> {
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  if ((meta.width ?? 0) <= maxEdge && (meta.height ?? 0) <= maxEdge) return buffer;
  return sharp(buffer, { limitInputPixels: false })
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

export async function describeImage(
  buffer: Buffer,
  filename?: string,
  context?: string,
): Promise<SceneContent> {
  const config = readVisionConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0, // tự quản lý retry bằng withRetry
  });
  const bounded = await boundForVision(buffer, config.maxEdge);
  const b64 = bounded.toString('base64');
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: buildVisionPrompt(context) },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      ],
    },
  ];
  return completeJson(
    client,
    config.model,
    messages,
    config.disableThinking,
    parseSceneJSON,
    `vision ${filename ?? '?'}`,
  );
}
