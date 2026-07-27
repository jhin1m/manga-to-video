import type { BeatRegion, ScriptSegment, Shot } from './schema';
import {
  readSplitSettings,
  splitGray,
  type GrayImage,
  type SplitSettings,
} from './smart-split';

// Cắt shot quá cao thành nhiều shot ngắn hơn, SAU khi kịch bản đã xong.
//
// Band do ingest cắt ra được tối ưu cho vision (trọn nhân vật + bong bóng thoại của nó),
// nên thường cao gấp 2–3 lần bề rộng. Chiếu nguyên band vào khung ngang thì ảnh chỉ chiếm
// ~29% bề rộng, còn lia dọc để lấp khung thì người xem phải đuổi theo ảnh chạy. Cắt band
// thành mảnh thấp hơn giải quyết cả hai: mỗi mảnh đứng yên mà vẫn to.
//
// Cắt tại GUTTER bằng chính thuật toán ingest (splitGray) chứ không chia đều — chia đều sẽ
// xẻ ngang mặt nhân vật và bong bóng thoại. Khác ingest ở đúng một chỗ: trần chiều cao nhỏ
// hơn nhiều.
//
// Chạy ở tầng kịch bản nên KHÔNG phụ thuộc khung hình (aspect chỉ được chọn ở trang video,
// sau bước này) — trần tính bằng pixel, không phải theo tỉ lệ khung.
//
// Thời lượng tự khớp: allocate_shots chia audio của đoạn cho các shot theo weight, nên
// thêm shot chỉ làm mỗi shot ngắn lại, tổng không đổi. Weight chia theo chiều cao mảnh để
// mảnh nhiều nội dung được nhiều thời gian hơn.

// Hai số dưới đây CHỐT BẰNG MẮT trên chương thật, không suy từ chỉ số. Đã render và so
// hai mức; mức cắt sâu hơn (trần 720, sàn 0.35×) cho ảnh rộng gấp đôi — 56% bề rộng khung
// so với 37% — và loại sạch cảnh lia dọc, NHƯNG bị đánh giá là khó xem hơn: 281 shot trên
// 5.6 phút là cắt cảnh mỗi 1.2 giây, và mảnh nhỏ hay đứt ngang giữa khung truyện.
//
// Mức hiện tại cắt dè: 150 mảnh, ~2.3s mỗi shot. Đổi lại vẫn còn ~65 mảnh đủ cao để lia
// dọc — chấp nhận có chủ ý, không phải sót.
export const SHOT_MAX_HEIGHT_DEFAULT = 1100;
// Sàn 0.6× như ingest. mergeLowInkBands gộp mảnh cuối vào mảnh trước khi nó thấp hơn sàn,
// nên sàn cao khiến trần chỉ có hiệu lực với band ≥ ~1760px — band 1148 cắt ra 700+448 thì
// mảnh 448 bị gộp ngược, band về nguyên. Đó KHÔNG phải rò rỉ cần vá: nó giữ mảnh nguyên
// vẹn và là một nửa lý do mức này dễ xem hơn. Hạ xuống 0.35× thì trần siết đúng nhưng
// mảnh vụn nhiều hơn hẳn.
export const MIN_BAND_RATIO = 0.6;

export function readShotSplitSettings(): SplitSettings {
  const parsed = Number.parseInt(process.env.SHOT_MAX_HEIGHT ?? '', 10);
  const maxBandHeight =
    Number.isFinite(parsed) && parsed >= 1 ? parsed : SHOT_MAX_HEIGHT_DEFAULT;
  return {
    ...readSplitSettings(),
    minBandHeight: Math.round(MIN_BAND_RATIO * maxBandHeight),
    maxBandHeight,
  };
}

// Ảnh xám giới hạn trong region — splitGray cần toạ độ bắt đầu từ 0 nên phải cắt thật,
// không truyền offset.
export function cropGray(img: GrayImage, r: BeatRegion): GrayImage {
  const data = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const src = (r.y + y) * img.width + r.x;
    data.set(img.data.subarray(src, src + r.w), y * r.w);
  }
  return { data, width: r.w, height: r.h };
}

// Một shot → 1..N shot. Trả về chính shot đó (cùng tham chiếu) khi không cần cắt, để
// nhánh "band vốn đã đủ thấp" không đụng gì tới dữ liệu sẵn có.
export function splitShot(
  shot: Shot,
  img: GrayImage,
  settings: SplitSettings,
): Shot[] {
  const rect: BeatRegion = shot.region ?? {
    x: 0,
    y: 0,
    w: img.width,
    h: img.height,
  };
  if (rect.h <= settings.maxBandHeight) return [shot];

  const parts = splitGray(cropGray(img, rect), settings);
  if (parts.length <= 1) return [shot];

  return parts.map((p) => ({
    ...shot,
    // splitGray trả toạ độ trong khung region → dời về toạ độ ảnh gốc.
    region: { x: rect.x + p.x, y: rect.y + p.y, w: p.w, h: p.h },
    weight: (shot.weight * p.h) / rect.h,
  }));
}

// Nở mọi shot quá cao trong kịch bản. `gray` trả ảnh xám của band theo sourceIndex —
// thiếu ảnh thì shot đó giữ nguyên (không đoán mò kích thước).
export function splitTallShots(
  segments: ScriptSegment[],
  gray: (sourceIndex: number) => GrayImage | undefined,
  settings: SplitSettings = readShotSplitSettings(),
): ScriptSegment[] {
  return segments.map((seg) => ({
    ...seg,
    shots: seg.shots.flatMap((shot) => {
      const img = gray(shot.sourceIndex);
      return img ? splitShot(shot, img, settings) : [shot];
    }),
  }));
}
