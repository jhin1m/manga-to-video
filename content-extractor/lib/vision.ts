import OpenAI from 'openai';
import sharp from 'sharp';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { SceneContent } from './schema';

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu OPENAI_API_KEY — khai báo trong .env.local (xem .env.example).');
  }
  const maxEdge = Number.parseInt(process.env.MAX_EDGE ?? '', 10);
  const concurrency = Number.parseInt(process.env.VISION_CONCURRENCY ?? '', 10);
  const rpm = Number.parseInt(process.env.VISION_RPM ?? '', 10);
  return {
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    model: process.env.VISION_MODEL || 'gpt-4o-mini',
    maxEdge: Number.isFinite(maxEdge) && maxEdge > 0 ? maxEdge : 1568,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 4,
    disableThinking: /^(true|1|yes)$/i.test(process.env.VISION_DISABLE_THINKING ?? ''),
    rpm: Number.isFinite(rpm) && rpm > 0 ? rpm : 30,
  };
}

const PROMPT = `Bạn là công cụ trích xuất nội dung trang manga cho pipeline thuyết minh.
ĐỌC KỸ trang truyện trong ảnh rồi trả về DUY NHẤT một JSON thô (không markdown, không lời dẫn, không giải thích) đúng dạng:
{"description": string, "dialogue": string[], "note": string}

Quy tắc — MỌI giá trị đều bằng tiếng Việt:
- "description": mô tả những gì đang diễn ra trong trang (nhân vật, hành động, bối cảnh, cảm xúc). Độ dài thích ứng theo nội dung: trang đơn giản thì ngắn gọn, trang nhiều diễn biến thì chi tiết hơn. Chỉ mô tả những gì nhìn thấy, không suy diễn thêm, không viết lời bình sẵn.
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

// Cờ adaptive process-wide: thử response_format json_object; nếu endpoint trả 400 thì
// tắt vĩnh viễn cho tiến trình này và gọi lại không kèm response_format.
let jsonModeSupported = true;

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

function isRetryable(err: unknown): boolean {
  const s = statusOf(err);
  if (s === 429) return true;
  if (s !== undefined && s >= 500) return true;
  // Không có HTTP status → lỗi mạng/timeout từ SDK
  return s === undefined;
}

// Retry 429/5xx/lỗi mạng với backoff mũ — dùng chung cho vision, script (biên kịch) và TTS.
export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
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
// thì thôi luôn (mất tối ưu, không mất đúng đắn).
export async function createCompletion(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  disableThinking: boolean,
): Promise<ChatCompletion> {
  // Với model reasoning của z.ai (GLM), tắt "thinking" giảm ~50% token cho tác vụ đọc
  // ảnh vốn không cần suy luận sâu. Param ngoài chuẩn OpenAI nên cast qua base type.
  const extra = disableThinking ? { thinking: { type: 'disabled' } } : {};
  if (jsonModeSupported) {
    try {
      return await client.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        ...extra,
      } as ChatCompletionCreateParamsNonStreaming);
    } catch (err) {
      if (statusOf(err) !== 400) throw err;
      jsonModeSupported = false; // endpoint không hỗ trợ json-mode — gọi lại không kèm
    }
  }
  return client.chat.completions.create({
    model,
    messages,
    ...extra,
  } as ChatCompletionCreateParamsNonStreaming);
}

// Rút object JSON từ output model: chịu ```json fences, lời dẫn trước/sau — dùng chung
// cho parseSceneJSON (vision) và parse kịch bản (script).
export function extractJson(raw: string | null | undefined): unknown {
  if (!raw || !raw.trim()) throw new Error('Model trả về không đúng JSON (rỗng)');
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Model trả về không đúng JSON');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Model trả về không đúng JSON');
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
  const res = await withRetry(() => createCompletion(client, config.model, messages, config.disableThinking));
  if (res.usage) {
    console.log(`[vision] ${filename ?? '?'} tokens=${res.usage.total_tokens}`);
  }
  return parseSceneJSON(res.choices[0]?.message?.content);
}
