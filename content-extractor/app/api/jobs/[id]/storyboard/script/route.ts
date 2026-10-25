import { NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';
import {
  generateScript,
  readScriptConfig,
  resolveMissingContent,
  type ScriptBeatInput,
} from '@/lib/script';
import {
  getStoryboard,
  getWorkingImage,
  setScript,
  setScriptGenerating,
  toScriptDTO,
} from '@/lib/storyboard-store';
import { applyAutoRegionsToSegments } from '@/lib/auto-region-io';
import { createNdjsonStream } from '@/lib/ndjson-stream';
import { readShotSplitSettings, splitTallShots } from '@/lib/shot-split';
import { toGray, type GrayImage } from '@/lib/smart-split';
import type { ScriptSegment } from '@/lib/schema';

export const runtime = 'nodejs';

// Giải mã ảnh xám cho các band mà kịch bản dùng, rồi nở shot quá cao + auto-region né bubble.
// Chỉ giải mã band THẬT SỰ được tham chiếu, mỗi band một lần — decode là phần đắt nhất.
async function splitTallShotsInJob(
  jobId: string,
  segments: ScriptSegment[],
): Promise<ScriptSegment[]> {
  const settings = readShotSplitSettings();
  const grays = new Map<number, GrayImage>();
  const buffers = new Map<number, Buffer>();
  const needed = new Set(segments.flatMap((s) => s.shots.map((sh) => sh.sourceIndex)));
  for (const sourceIndex of needed) {
    const working = getWorkingImage(jobId, sourceIndex);
    if (!working) continue;
    grays.set(sourceIndex, await toGray(working.buffer));
    buffers.set(sourceIndex, working.buffer);
  }
  const split = splitTallShots(segments, (i) => grays.get(i), settings);
  // Refine framing: né bubble trong từng mảnh (kể cả sau khi nở shot).
  return applyAutoRegionsToSegments(split, buffers);
}

// Tạo kịch bản AI cho cả chương: đọc content tươi từng band (mẫu composeBeat) → vision
// fallback cho band thiếu content → model text gộp/tách thành ScriptSegment[] → lưu store.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  if (state.progress.phase === 'queued' || state.progress.phase === 'processing') {
    return NextResponse.json({ error: 'Storyboard đang xử lý' }, { status: 409 });
  }
  if (state.scriptGenerating) {
    return NextResponse.json({ error: 'Đang tạo kịch bản, chờ xong đã' }, { status: 409 });
  }
  if (state.beats.length === 0) {
    return NextResponse.json({ error: 'Storyboard chưa có nhịp nào' }, { status: 404 });
  }
  // Đòi config sớm để fail với thông điệp rõ (mẫu route Generate).
  try {
    readScriptConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cấu hình script không hợp lệ';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Content đọc TƯƠI từ job (retry Stage 1 xong thì biên kịch ăn ngay); job vắng (import
  // từ manifest) → content nằm sẵn trên working image. Bản tươi chỉ được tin khi item còn
  // TRÙNG KHỚP working image (so kích thước): xoá band sau khi tạo storyboard làm job
  // re-index → items[sourceIndex] trỏ band KHÁC — khi đó dùng snapshot, không lấy nhầm lời.
  const job = getJob(id);
  const inputs: ScriptBeatInput[] = [...state.beats]
    .sort((a, b) => a.order - b.order)
    .map((beat) => {
      const working = state.working.find((w) => w.sourceIndex === beat.sourceIndex);
      const item = job?.items[beat.sourceIndex];
      const itemMatchesWorking =
        item && working && item.width === working.width && item.height === working.height;
      return {
        order: beat.order,
        sourceIndex: beat.sourceIndex,
        beatId: beat.id,
        content: (itemMatchesWorking ? item.content : null) ?? working?.content ?? null,
        region: beat.region,
        motion: beat.motion,
      };
    });

  // Guard đồng bộ đã qua → mở NDJSON stream. setScriptGenerating đặt TRƯỚC khi trả response
  // (đồng bộ) để request thứ hai racing thấy cờ → 409; reset trong finally của công việc nền.
  setScriptGenerating(id, true);
  const { response, write, close } = createNdjsonStream();

  void (async () => {
    try {
      const context = job?.context;
      const lang = job?.outputLanguage;
      const resolved = await resolveMissingContent(id, inputs, {
        context,
        lang,
        onProgress: (done, total) => write({ type: 'progress', phase: 'resolving', done, total }),
      });
      // Chốt pha 'writing' TRƯỚC khi gọi model → thứ tự nhãn resolving→writing→splitting luôn
      // đúng, kể cả khi stream bị lùi non-stream (không có onChars nào phát): counter đứng ở 0.
      write({ type: 'progress', phase: 'writing', chars: 0 });
      const segments = await generateScript(resolved, context, {
        onChars: (chars) => write({ type: 'progress', phase: 'writing', chars }),
        // attempt 0 = lần đầu (không phải "thử lại"); chỉ báo từ lần 2 (attempt+1).
        onAttempt: (attempt) => {
          if (attempt > 0) write({ type: 'progress', phase: 'writing', attempt: attempt + 1 });
        },
      }, lang);
      if (segments.length === 0) {
        write({
          type: 'error',
          status: 502,
          message: 'Model không trả về đoạn kịch bản hợp lệ nào — thử tạo lại',
        });
        return;
      }
      // Band cao hơn trần bị cắt thành nhiều shot ngắn (gutter-aware) — biên kịch chọn band
      // theo NỘI DUNG, việc band đó chiếu ra có quá cao hay không là chuyện hình ảnh, tách
      // riêng khỏi model.
      write({ type: 'progress', phase: 'splitting' });
      setScript(id, await splitTallShotsInJob(id, segments));
      write({ type: 'done', script: toScriptDTO(getStoryboard(id)!) });
    } catch (err) {
      write({
        type: 'error',
        status: 502,
        message: err instanceof Error ? err.message : 'Tạo kịch bản thất bại',
      });
    } finally {
      setScriptGenerating(id, false);
      close();
    }
  })();

  return response;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  if (!state.script) {
    return NextResponse.json({ error: 'Chưa có kịch bản cho job này' }, { status: 404 });
  }
  return NextResponse.json(toScriptDTO(state));
}
