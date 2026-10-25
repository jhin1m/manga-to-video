import sharp from 'sharp';
import pLimit from 'p-limit';
import type { BeatRegion, SceneContent } from './schema';
import { emptyBeat } from './schema';
import { getJob } from './jobs';
import { createPacer } from './pipeline';
import { classifyError, describeImage } from './vision';
import {
  getBeat,
  getStoryboard,
  setBeatError,
  setBeatResult,
  setWorkingContent,
  updateStoryboardProgress,
  type StoredBeat,
  type WorkingImage,
} from './storyboard-store';

// Narration v1 = TEMPLATE thuần, KHÔNG gọi LLM soạn lời: mô tả trước, mỗi thoại một dòng
// trong ngoặc kép — người biên tập sửa tay ở UI là chốt. (Nút "LLM chau chuốt" là mở rộng
// tương lai; điểm cắm là thay hàm này, không đổi hợp đồng Beat.)
export function fillNarration(scene: SceneContent): string {
  return [scene.description, ...scene.dialogue.map((d) => `"${d}"`)].filter(Boolean).join('\n');
}

// Khung nhịp trước compose: mỗi working image (band đã chia lúc upload) → 1 beat pending
// trọn ảnh (region null), order tăng dần toàn cục.
export function skeletonBeats(sources: Array<{ sourceIndex: number }>): StoredBeat[] {
  return sources.map((src, i) => ({
    ...emptyBeat({ order: i, sourceIndex: src.sourceIndex, region: null }),
    status: 'pending',
    rev: 0,
  }));
}

// Cắt vùng band từ working image — clamp vào biên ảnh để region người chỉnh tay
// không làm sharp.extract văng. (Dùng chung cho compose 2A + route crop preview.)
export async function cropRegion(working: WorkingImage, region: BeatRegion): Promise<Buffer> {
  const left = Math.max(0, Math.min(Math.round(region.x), working.width - 1));
  const top = Math.max(0, Math.min(Math.round(region.y), working.height - 1));
  const width = Math.max(1, Math.min(Math.round(region.w), working.width - left));
  const height = Math.max(1, Math.min(Math.round(region.h), working.height - top));
  return sharp(working.buffer, { limitInputPixels: false })
    .extract({ left, top, width, height })
    .jpeg({ quality: 80 })
    .toBuffer();
}

// Compose MỘT beat — dùng chung cho chạy hàng loạt, retry và nút Generate.
// Mặc định: content Stage 1 (đọc TƯƠI từ job — retry Stage 1 xong thì compose ăn ngay,
// không kẹt snapshot lúc dựng storyboard). opts.vision (nút Generate) hoặc nguồn strip
// (manifest cũ nạp lại): crop vùng nhịp → describeImage → template.
// Guard rev: người dùng sửa beat trong lúc chờ vision → kết quả compose bị BỎ,
// bản sửa tay luôn thắng.
export async function composeBeat(
  jobId: string,
  beatId: string,
  opts?: { vision?: boolean },
): Promise<void> {
  const state = getStoryboard(jobId);
  const beat = getBeat(jobId, beatId);
  if (!state || !beat) return;
  const revBefore = beat.rev;
  const untouched = () => getBeat(jobId, beatId)?.rev === revBefore;
  const working = state.working.find((w) => w.sourceIndex === beat.sourceIndex);
  if (!working) {
    setBeatError(jobId, beatId, `Không tìm thấy ảnh nguồn cho sourceIndex ${beat.sourceIndex}`);
    return;
  }
  try {
    let scene: SceneContent | null;
    const useVision = opts?.vision === true || state.sourceKind === 'strip';
    if (useVision) {
      const band = beat.region ?? { x: 0, y: 0, w: working.width, h: working.height };
      const cropped = await cropRegion(working, band);
      const job = getJob(jobId);
      scene = await describeImage(cropped, `beat#${beat.order}`, job?.context, job?.outputLanguage);
    } else {
      const freshContent = getJob(jobId)?.items[beat.sourceIndex]?.content;
      scene = freshContent ?? working.content ?? null;
    }
    if (!untouched()) return;
    const narration = scene ? fillNarration(scene) : '';
    if (!narration) {
      setBeatError(jobId, beatId, 'Nội dung trống — bấm Generate hoặc tự điền narration.');
      return;
    }
    // Persist content cho bước Kịch bản reuse — chỉ khi thành công và chỉ nhánh pages
    // (band↔beat 1:1); strip có nhiều beat chung một canvas, ghi content lên canvas sẽ lẫn
    // nội dung giữa các nhịp. Scene rỗng KHÔNG persist — beat lỗi thì fallback Kịch bản
    // còn thấy band này missing để tự vision lại.
    if (useVision && scene && state.sourceKind === 'pages') {
      setWorkingContent(jobId, beat.sourceIndex, scene);
    }
    setBeatResult(jobId, beatId, {
      narration,
      ...(scene && scene.dialogue.length > 0 ? { sourceDialogue: scene.dialogue } : {}),
    });
  } catch (err) {
    if (!untouched()) return;
    setBeatError(jobId, beatId, classifyError(err));
  }
}

// Compose hàng loạt. Lỗi từng beat được cô lập, không bao giờ sập cả job.
// - Mặc định (template): chỉ beat pending, pacer chỉ áp cho strip (nhánh gọi vision).
// - opts.vision (nút "Generate all"): chạy vision cho beat pending|error, luôn pace theo
//   minIntervalMs; beat done (đã compose/sửa tay) không bị đụng tới.
export async function composeStoryboard(
  jobId: string,
  opts: { concurrency: number; minIntervalMs?: number; vision?: boolean },
): Promise<void> {
  const state = getStoryboard(jobId);
  if (!state) return;
  const useVision = opts.vision === true;
  updateStoryboardProgress(jobId, { phase: 'processing' });
  const limit = pLimit(opts.concurrency);
  const pace = createPacer(
    useVision || state.sourceKind === 'strip' ? (opts.minIntervalMs ?? 0) : 0,
  );
  await Promise.all(
    state.beats
      .filter((b) => b.status === 'pending' || (useVision && b.status === 'error'))
      .map((beat) =>
        limit(async () => {
          await pace();
          updateStoryboardProgress(jobId, { currentIndex: beat.order });
          await composeBeat(jobId, beat.id, useVision ? { vision: true } : undefined);
        }),
      ),
  );
  updateStoryboardProgress(jobId, { phase: 'done', currentIndex: null });
}
