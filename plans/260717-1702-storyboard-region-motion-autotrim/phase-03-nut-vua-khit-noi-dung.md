---
phase: 3
title: "Nút Vừa khít nội dung (thủ công)"
status: done
priority: P3
effort: "~2h"
dependencies: [1, 2]
---

# Phase 3: Nút "Vừa khít nội dung" (thủ công)

## Overview

Một nút trên cropper: co region bám sát vùng có nội dung, bỏ lề trắng. **Chỉ thủ công — auto-trim đã
bị spike bác bỏ bằng số đo.**

**Spike:** [`spike-260717-1720-ink-bbox-calibration-tren-corpus-that-report.md`](./reports/spike-260717-1720-ink-bbox-calibration-tren-corpus-that-report.md)
— đo trên chương thật (38 slice → 27 band).

## Vì sao phase này co lại (auto-trim đã chết)

| Chỉ số đo thật | Giá trị |
|---|---|
| Tiết kiệm diện tích TB | **7.3%** |
| Band đạt ngưỡng đáng-trim (≥15%) | **2/27** |
| Lề ngang thật | ~8px/bên (720→704) ≈ 2% |

Band có 10–66% pixel trắng nhưng bbox **không co được** — khoảng trắng nằm **giữa ảnh** (bong bóng
thoại, nền panel), **không ở lề**. Webtoon full-bleed ngang: không có lề để cắt.

→ Auto-trim = 5–7h công để đạt gần như không gì. **Bỏ.** Nhưng 2/27 band trim được đáng kể (#14:
33.6%, #26: 15.9%) → **nút thủ công vẫn có ích**, và rẻ.

## Những thứ spike đã loại (đừng mang lại)

| Thứ | Vì sao bỏ |
|---|---|
| Auto-trim lúc tạo storyboard | 7.3% — không đáng. Bỏ luôn móc `skeletonBeats`/`buildAndCompose`, `pLimit`, decode server |
| Reference-color-distance + fuzz | Đo chứng minh `< 250` gray **đủ** (band #14 co 33.6%) → gutter đủ gần trắng tinh. Không cần đọc RGB, không đổi kiến trúc |
| Otsu | Research bác (fail trên gradient); giờ càng không cần |
| Ngưỡng "đáng trim" 80-85% | Nút thủ công: người dùng bấm = muốn trim. bbox = cả ảnh → no-op tự nhiên |
| Hằng số border riêng cho watermark | Chưa thấy vấn đề trong corpus. YAGNI — thêm khi có bằng chứng |
| Phát hiện viền đen scan | Research tự nhận là suy luận chưa kiểm chứng; webtoon màu hiếm gặp. YAGNI |
| Env settings kiểu `readSplitSettings` | Chỉ một nút, hằng số trong module là đủ |

## Architecture

Client-side hoàn toàn — **không API mới, không đụng server**.

```
Cropper đã nạp <img> → canvas → ctx.getImageData() → RGBA
  → inkBBox() (module thuần) → BeatRegion | null
  → onChange(region)   ← đúng đường PATCH sẵn có, không thêm gì
```

```ts
// lib/ink-bbox.ts — thuần: không sharp, không React
export interface RawImage {
  data: Uint8Array | Uint8ClampedArray;  // RGBA (client) hoặc RGB
  width: number;
  height: number;
  channels: 3 | 4;
}
export function inkBBox(img: RawImage, s?: Partial<InkBBoxSettings>): BeatRegion | null;
```

Trả `null` = "không có gì để trim" → caller giữ nguyên region.

**Tách module riêng dù chỉ có 1 consumer** — vì nó là logic thuần, test được bằng ảnh tổng hợp
(mẫu `verify-banding.mts` tự sinh ảnh). Nhét thẳng vào component là không test nổi.

### Thuật toán (đã calibrate)

1. Gray theo **đúng công thức repo** `(299R+587G+114B)/1000` (`smart-split.ts:81`) — KHÔNG dùng
   `sharp.greyscale()`/công thức khác, giữ nhất quán với ngưỡng 250.
2. Projection profile hàng + cột; hàng/cột "có nội dung" khi **≥1% pixel** có gray `< 250`.
   → Ngưỡng **tỉ lệ**, không phải "gặp pixel mực đầu tiên" (đó là lỗi của ImageMagick `-trim` mặc
   định: 0% dung sai → 1 pixel nhiễu JPEG là dừng trim ngay).
3. Padding: **3–5% cạnh bbox, tối thiểu 12–16px** (lấy max). Khung video cần "thở" —
   đừng bám sát nét vẽ.
4. Clamp vào biên ảnh; bbox chạm cả 4 cạnh → trả `null`.

**Run-length filter (research khuyên bắt buộc): làm đơn giản trước.** Ngưỡng 1% trên hàng 700px = 7
pixel — bản thân nó đã lọc nhiễu single-pixel khá tốt. Nếu thấy bbox nhảy lung tung thì mới thêm
run-length. Nút thủ công có preview tức thì → phát hiện ngay, rủi ro thấp.

### Cạm bẫy phải xử lý

⚠️ **Canvas hạ cỡ.** Cropper vẽ canvas ở `PREVIEW_MAX_EDGE = 800` (`region-cropper.tsx:60`). Tính
bbox trên bản thu nhỏ → **phải scale ngược về px working thật**. Quên bước này = region sai hoàn
toàn. Padding hấp thụ sai số vài px nên không cần canvas full-res.

⚠️ **Trim đổi hiệu ứng.** Spike xác nhận: band #14 `720×1129` (tallness 1.57 → `zoom`) sau trim thành
`516×1046` (tallness 2.03 → **`pan-v`**). Bấm "Vừa khít" có thể đổi mode. Chấp nhận được vì Phase 2
đã có đường ghi đè, và preview sống cho thấy ngay — nhưng chip mode phải cập nhật tức thì để người
dùng thấy.

## Related Code Files

- Create: `content-extractor/lib/ink-bbox.ts` — module thuần
- Modify: `content-extractor/components/region-cropper.tsx` — nút "Vừa khít nội dung"
- Read-only: `lib/smart-split.ts:65-85` (công thức gray), `scripts/verify-banding.mts` (mẫu sinh ảnh
  tổng hợp để test)

## Implementation Steps

1. `lib/ink-bbox.ts`: `inkBBox()` thuần + hằng số (`INK_MAX = 250`, `ROW_PCT = 0.01`,
   `PAD_PCT = 0.04`, `PAD_MIN_PX = 14`). Trả `null` khi không đáng trim.

2. Nút **"Vừa khít nội dung"** ở cropper, cạnh Switch "Cả trang" (`region-cropper.tsx:329-346`):
   - Vẽ ảnh vào canvas tạm (tái dùng mẫu `ShotPreview` dòng 105-116) → `getImageData`
   - `inkBBox` → **scale ngược** về px working → `clampRegion` (dòng 47-53, đã có) → `onChange`
   - `null` → không làm gì (có thể nháy nhẹ báo "không có lề để cắt")
   - Luôn bấm được, kể cả sau khi sửa tay
   - `disabled` khi cropper `disabled`

3. Test module bằng ảnh tổng hợp (mẫu `verify-banding.mts`): ảnh có lề trắng biết trước → bbox đúng;
   ảnh full-bleed → `null`; ảnh trắng hết → `null`.

4. **Verify**:
   ```bash
   nvm use 24
   pnpm build
   ```
   Rồi thử tay trên chương thật: band #14 (band cao ~1129px, trim được 33.6%) phải co rõ; band
   full-bleed phải không đổi.

## Success Criteria

- [ ] Bấm "Vừa khít nội dung" trên band có lề → region co, còn padding thở, preview cập nhật ngay
- [ ] Band full-bleed (đa số corpus) → không đổi gì, không lỗi
- [ ] Region sau trim vẫn nằm trong biên ảnh working (`clampRegion`)
- [ ] Chip mode cập nhật nếu trim làm đổi hiệu ứng (band #14: zoom → pan-v)
- [ ] Không thêm API route nào; không đụng `pipeline.ts`/`detectBands`/`.mtvproj`
- [ ] `inkBBox` có test bằng ảnh tổng hợp
- [ ] `pnpm build` xanh

## Risk Assessment

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Quên scale ngược từ canvas 800px → region sai toàn bộ | Trung | Test bằng ảnh tổng hợp có lề biết trước; thử tay trên band thật |
| Trim đổi mode ngoài ý muốn | Thấp | Phase 2 đã có ghi đè; preview + chip cập nhật tức thì |
| Padding chưa hợp mắt | Thấp | Nút thủ công, thấy ngay, chỉnh hằng số 1 dòng |
| Truyện khác (nền tối/watermark to) trim sai | Thấp | Thủ công + preview → người dùng tự thấy và undo bằng Switch "Cả trang" |

## Notes

- **Nợ phát hiện trong spike, ngoài phạm vi:** rất nhiều band có `tallness` đúng `3.11 = 2240/720` =
  chạm trần `MAX_BAND_HEIGHT` → **bị ép cắt**, không phải cắt tại gutter. Nghĩa là chuyển động camera
  đang bị điều khiển bởi một hằng số config chứ không phải nội dung truyện. Đáng điều tra riêng sau
  P1+P2 — có khi giá trị hơn cả trim.
- Spike chỉ đo 1 chương của 1 truyện. Nút thủ công nên rủi ro thấp, không chặn.
