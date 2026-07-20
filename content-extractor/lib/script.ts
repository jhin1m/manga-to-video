import OpenAI from 'openai';
import pLimit from 'p-limit';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { BeatRegion, MotionOverride, SceneContent, ScriptSegment } from './schema';
import { estimateSeconds } from './schema';
import { createPacer } from './pipeline';
import {
  completeJson,
  createCompletion,
  describeImage,
  extractJson,
  ModelOutputError,
  withRetry,
} from './vision';
import { isZaiProvider, readAiSettings, resolveApiKey } from './settings';
import { cropRegion } from './narration';
import { getStoryboard } from './storyboard-store';

// Tầng biên kịch (Stage 2): model text đọc content mọi band → viết kịch bản kể mạch lạc,
// được GỘP các band liền kề vào một đoạn kể hoặc TÁCH band dày thành nhiều đoạn.
// Provider-agnostic qua ENV (mẫu readVisionConfig) — mặc định dùng chung OPENAI_*,
// override SCRIPT_API_KEY/SCRIPT_BASE_URL khi biên kịch dùng nhà cung cấp khác vision.

export interface ScriptConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  disableThinking: boolean;
}

export function readScriptConfig(): ScriptConfig {
  // Có settings từ UI → settings áp cho CẢ biên kịch (một provider cho cả hai stage),
  // bỏ qua cặp SCRIPT_API_KEY/SCRIPT_BASE_URL vì key phải khớp provider đã chọn.
  // Nút "Dùng theo ENV" trong Settings xóa file → quay lại nhánh ENV thuần bên dưới.
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
      model: settings.scriptModel || process.env.SCRIPT_MODEL || 'gpt-4o',
      disableThinking: isZaiProvider(settings.provider) && settings.disableThinking,
    };
  }

  const apiKey = process.env.SCRIPT_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Thiếu SCRIPT_API_KEY hoặc OPENAI_API_KEY — khai báo trong .env.local (xem .env.example).',
    );
  }
  return {
    apiKey,
    baseURL: process.env.SCRIPT_BASE_URL || process.env.OPENAI_BASE_URL || undefined,
    model: process.env.SCRIPT_MODEL || 'gpt-4o',
    disableThinking: /^(true|1|yes)$/i.test(process.env.SCRIPT_DISABLE_THINKING ?? ''),
  };
}

// Input biên kịch: một band theo thứ tự đọc. content null = Stage 1 chưa chạy/lỗi
// (được vision fallback điền trước khi gọi model text).
export interface ScriptBeatInput {
  order: number;
  sourceIndex: number;
  beatId: string;
  content: SceneContent | null;
  region: BeatRegion | null; // vùng người dùng vẽ ở Storyboard — copy 1 chiều sang Shot
  motion?: MotionOverride; // ghi đè hiệu ứng của beat — copy 1 chiều, undefined = auto
}

const PROMPT_HEADER = `Bạn là biên kịch kiêm người dẫn chuyện cho video recap truyện tranh — lời kể sẽ được đọc thuyết minh (voice-over) trên video. Dưới đây là nội dung từng khung hình theo thứ tự đọc (đánh số index từ 0).

Trước khi viết: đọc TOÀN BỘ các khung để nắm mạch truyện (ai là ai, sự kiện nối nhau ra sao) rồi mới đặt bút — kể theo nhân quả, không chép máy móc mô tả từng khung.

Ngôi kể — quy tắc CỨNG:
- Lời kể LUÔN ở ngôi thứ ba, vai người kể chuyện đứng ngoài câu chuyện: gọi nhân vật bằng TÊN hoặc đại từ ngôi ba phù hợp (hắn, y, cô, nàng, cô ta, ông ta…).
- KHÔNG nhập vai nhân vật: cấm dùng "tôi/ta/mình" làm chủ ngữ của lời kể, kể cả khi khung là độc thoại nội tâm — độc thoại phải chuyển thành lời kể gián tiếp ("hắn thầm nghĩ…") hoặc trích dẫn ngắn trong ngoặc kép.
- Xưng hô ngôi nhất/ngôi hai (ta, ngươi, huynh, muội…) chỉ được nằm BÊN TRONG dấu ngoặc kép của thoại trích dẫn, giữ đúng cách các nhân vật xưng hô với nhau.

Nhiệm vụ:
- Viết lời kể tiếng Việt MẠCH LẠC, xâu chuỗi các khung thành một mạch truyện liền, thoại lồng vào lời kể dạng trích dẫn ngắn.
- Được GỘP các khung liền kề vào MỘT đoạn kể khi chúng cùng một diễn biến.
- Được TÁCH một khung dày nội dung thành NHIỀU đoạn kể liên tiếp.
- Mỗi index phải xuất hiện trong đúng một đoạn (không bỏ sót, không lặp).
Trả về DUY NHẤT một JSON thô (không markdown, không lời dẫn) đúng dạng:
{"segments":[{"narration": string, "shotIndices": [int, ...]}]}
— shotIndices là các index khung mà đoạn kể phủ, xếp theo thứ tự đọc.`;

// Export cho verify-script: khối context phải vào prompt, rỗng = prompt y cũ.
export function buildPrompt(inputs: ScriptBeatInput[], context?: string): string {
  const lines = inputs.map((inp, index) => {
    const desc = inp.content?.description?.trim() || '(không có mô tả)';
    const dialogue = inp.content?.dialogue?.length
      ? ` | Thoại: ${inp.content.dialogue.map((d) => `"${d}"`).join(' ')}`
      : '';
    // note của vision mang tín hiệu mạch truyện (chuyển cảnh, hồi tưởng, chi tiết nền) —
    // vứt đi là biên kịch mất đúng thứ giúp hiểu kịch bản.
    const note = inp.content?.note?.trim();
    return `[${index}] ${desc}${dialogue}${note ? ` | Lưu ý: ${note}` : ''}`;
  });
  // Cùng khối ngữ cảnh với vision (một nguồn từ Job) — xưng hô trong LỜI KỂ chốt ở tầng
  // biên kịch nên phải nhắc lại ở đây, không thể trông vào mô tả từng khung. Phải tách
  // rõ hai tầng xưng hô: nhân vật↔nhân vật (trong thoại) ≠ người kể→nhân vật (ngôi ba),
  // nếu không model áp "ta/ngươi/huynh/muội" của nhân vật vào giọng kể.
  const trimmed = context?.trim();
  const contextBlock = trimmed
    ? `\n\nNgữ cảnh chương (nhân vật, xưng hô, bối cảnh — người dùng cung cấp):
- Dùng để gọi ĐÚNG TÊN nhân vật trong lời kể và chọn đúng cách các nhân vật xưng hô với nhau TRONG THOẠI trích dẫn.
- Xưng hô trong ngữ cảnh là cách nhân vật nói VỚI NHAU — KHÔNG áp vào giọng người kể (lời kể vẫn ngôi thứ ba, gọi nhân vật bằng tên/đại từ ngôi ba).
- KHÔNG bịa thêm sự kiện ngoài nội dung các khung.
${trimmed}`
    : '';
  return `${PROMPT_HEADER}${contextBlock}\n\nNội dung các khung:\n${lines.join('\n')}`;
}

// Vision fallback (Validation S1): band content null → crop cả band → describeImage.
// Lỗi cô lập từng band (band hỏng → content vẫn null, mô tả rỗng trong prompt, không sập).
// Pacer + p-limit như composeStoryboard để chặn 429.
export async function resolveMissingContent(
  jobId: string,
  inputs: ScriptBeatInput[],
  opts?: { concurrency?: number; minIntervalMs?: number; context?: string },
): Promise<ScriptBeatInput[]> {
  const missing = inputs.filter((inp) => !inp.content);
  if (missing.length === 0) return inputs;
  const state = getStoryboard(jobId);
  if (!state) return inputs;
  const limit = pLimit(opts?.concurrency ?? 4);
  const pace = createPacer(opts?.minIntervalMs ?? 0);
  const resolved = new Map<string, SceneContent>();
  await Promise.all(
    missing.map((inp) =>
      limit(async () => {
        const working = state.working.find((w) => w.sourceIndex === inp.sourceIndex);
        if (!working) return;
        try {
          await pace();
          const cropped = await cropRegion(working, {
            x: 0,
            y: 0,
            w: working.width,
            h: working.height,
          });
          resolved.set(
            inp.beatId,
            await describeImage(cropped, `script-band#${inp.order}`, opts?.context),
          );
        } catch (err) {
          console.error(`[script] vision fallback band#${inp.order} lỗi:`, err);
        }
      }),
    ),
  );
  return inputs.map((inp) =>
    resolved.has(inp.beatId) ? { ...inp, content: resolved.get(inp.beatId)! } : inp,
  );
}

interface RawSegment {
  narration: string;
  shotIndices: number[];
}

// Parse output model → danh sách segment thô. Chịu fences/lời dẫn qua extractJson;
// shotIndices phải là mảng số — phần tử lạ bị loại ở bước validate biên.
export function parseScriptJSON(raw: string | null | undefined): RawSegment[] {
  const parsed = extractJson(raw) as Record<string, unknown>;
  if (!Array.isArray(parsed.segments)) {
    // ModelOutputError (không phải Error trần) để lỗi này cũng được retry + kèm output thô:
    // JSON hợp lệ nhưng sai shape là hỏng ngẫu nhiên y như JSON vỡ.
    throw new ModelOutputError('Model trả về không đúng dạng {segments:[...]}', raw);
  }
  return parsed.segments
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      narration: s.narration != null ? String(s.narration) : '',
      shotIndices: Array.isArray(s.shotIndices)
        ? s.shotIndices.filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
        : [],
    }));
}

// Map segment thô → ScriptSegment[]: shotIndices ngoài biên bị LOẠI + cảnh báo (không tự
// chèn — UI báo count lệch); segment không còn shot nào bị bỏ. Index bỏ sót chỉ cảnh báo.
export function toScriptSegments(
  rawSegments: RawSegment[],
  inputs: ScriptBeatInput[],
): ScriptSegment[] {
  const seen = new Set<number>();
  const segments: ScriptSegment[] = [];
  for (const raw of rawSegments) {
    const valid = raw.shotIndices.filter((idx) => {
      if (idx < 0 || idx >= inputs.length) {
        console.warn(`[script] shotIndex ${idx} ngoài biên [0,${inputs.length - 1}] — loại`);
        return false;
      }
      if (seen.has(idx)) {
        // Prompt cấm lặp nhưng model có thể vẫn lặp — giữ lần xuất hiện đầu, cảnh báo
        // (người duyệt quyết định qua gộp/tách ở UI).
        console.warn(`[script] shotIndex ${idx} lặp — giữ lần đầu, loại lần sau`);
        return false;
      }
      seen.add(idx); // add ngay để bắt cả lặp trong cùng một đoạn
      return true;
    });
    if (valid.length === 0) continue;
    segments.push({
      id: crypto.randomUUID(),
      order: segments.length,
      narration: raw.narration,
      shots: valid.map((idx) => {
        const { sourceIndex, region, motion } = inputs[idx];
        // Copy khối để Shot không chia sẻ object với Beat (sửa beat sau này không lây sang script)
        return {
          sourceIndex,
          region: region ? { ...region } : null,
          ...(motion !== undefined ? { motion: { ...motion } } : {}),
          weight: 1,
        };
      }),
      sourceBeatIds: valid.map((idx) => inputs[idx].beatId),
      durationHint: estimateSeconds(raw.narration),
    });
  }
  const missed = inputs.filter((_, idx) => !seen.has(idx));
  if (missed.length > 0) {
    console.warn(
      `[script] model bỏ sót ${missed.length} band (order: ${missed.map((m) => m.order).join(', ')}) — UI sẽ báo count lệch`,
    );
  }
  return segments;
}

// Gọi model text viết kịch bản cả chương. Throw khi model/parse hỏng hoàn toàn
// (route trả lỗi rõ); lỗi từng band đã được cô lập ở resolveMissingContent.
export async function generateScript(
  inputs: ScriptBeatInput[],
  context?: string,
): Promise<ScriptSegment[]> {
  if (inputs.length === 0) return [];
  const config = readScriptConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0, // tự quản lý retry bằng withRetry
  });
  const messages: ChatCompletionMessageParam[] = [
    { role: 'user', content: buildPrompt(inputs, context) },
  ];
  const rawSegments = await completeJson(
    client,
    config.model,
    messages,
    config.disableThinking,
    parseScriptJSON,
    `script ${inputs.length} band`,
  );
  return toScriptSegments(rawSegments, inputs);
}

// ==== Recap chương cho series-memory ====
// App không biết folder series trên đĩa (ingest qua upload) — user tải recap về tự đặt vào
// <series>/.mtv/summaries/. Format phải khớp hợp đồng của skill manga-to-video
// (references/series.md): ≤250 từ, ngôi ba, thuật nhân quả, chốt bằng dòng "Kết chương: ...".

export function buildRecapPrompt(segments: ScriptSegment[]): string {
  const story = [...segments]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.narration.trim())
    .filter(Boolean)
    .join('\n');
  return `Bạn là người tóm tắt cho video recap truyện tranh. Dưới đây là toàn bộ lời kể (voice-over) của MỘT chương, theo thứ tự.

Nhiệm vụ: viết recap diễn biến chương này để làm ngữ cảnh cho chương sau.
- Tối đa 250 từ, tiếng Việt, lời kể ngôi thứ ba, gọi nhân vật đúng tên như trong lời kể.
- Thuật theo nhân quả (ai làm gì → dẫn tới gì), 3-6 câu, đủ để người chưa đọc chương nắm mạch.
- Không bình luận, không suy đoán chương sau.
- Kết thúc bằng đúng một dòng bắt đầu bằng "Kết chương: " nêu tình huống đang treo.
Trả về DUY NHẤT phần recap dạng văn bản thuần (không markdown fence, không lời dẫn).

Lời kể của chương:
${story}`;
}

// Throw khi chưa có kịch bản/model hỏng — route trả lỗi rõ cho client.
export async function generateRecap(segments: ScriptSegment[]): Promise<string> {
  if (segments.length === 0) {
    throw new Error('Chưa có đoạn kịch bản nào để tóm tắt');
  }
  const config = readScriptConfig();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0, // tự quản lý retry bằng withRetry
  });
  const messages: ChatCompletionMessageParam[] = [
    { role: 'user', content: buildRecapPrompt(segments) },
  ];
  // jsonMode=false — recap là văn bản thuần; ép json_object làm model trả JSON sai format.
  const res = await withRetry(() =>
    createCompletion(client, config.model, messages, config.disableThinking, false),
  );
  const recap = res.choices[0]?.message?.content?.trim();
  if (!recap) {
    throw new Error('Model không trả về recap — thử lại');
  }
  return recap;
}
