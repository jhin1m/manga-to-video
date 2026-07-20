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
import { readShotSplitSettings, splitTallShots } from '@/lib/shot-split';
import { toGray, type GrayImage } from '@/lib/smart-split';
import type { ScriptSegment } from '@/lib/schema';

export const runtime = 'nodejs';

// Giải mã ảnh xám cho các band mà kịch bản dùng, rồi nở shot quá cao. Chỉ giải mã band
// THẬT SỰ được tham chiếu, mỗi band một lần — decode là phần đắt nhất ở đây.
async function splitTallShotsInJob(
  jobId: string,
  segments: ScriptSegment[],
): Promise<ScriptSegment[]> {
  const settings = readShotSplitSettings();
  const grays = new Map<number, GrayImage>();
  const needed = new Set(segments.flatMap((s) => s.shots.map((sh) => sh.sourceIndex)));
  for (const sourceIndex of needed) {
    const working = getWorkingImage(jobId, sourceIndex);
    if (!working) continue;
    grays.set(sourceIndex, await toGray(working.buffer));
  }
  return splitTallShots(segments, (i) => grays.get(i), settings);
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

  setScriptGenerating(id, true);
  try {
    const context = job?.context;
    const resolved = await resolveMissingContent(id, inputs, { context });
    const segments = await generateScript(resolved, context);
    if (segments.length === 0) {
      return NextResponse.json(
        { error: 'Model không trả về đoạn kịch bản hợp lệ nào — thử tạo lại' },
        { status: 502 },
      );
    }
    // Band cao hơn trần bị cắt thành nhiều shot ngắn (gutter-aware) — biên kịch chọn band
    // theo NỘI DUNG, việc band đó chiếu ra có quá cao hay không là chuyện hình ảnh, tách
    // riêng khỏi model.
    setScript(id, await splitTallShotsInJob(id, segments));
    return NextResponse.json(toScriptDTO(getStoryboard(id)!));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tạo kịch bản thất bại';
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    setScriptGenerating(id, false);
  }
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
