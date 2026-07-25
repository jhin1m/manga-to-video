---
phase: 5
title: "Preview parity + wrap dòng"
status: pending
priority: P2
effort: "5h"
dependencies: [4]
---

# Phase 5: Preview parity + wrap dòng

## Overview

Overlay caption trong preview đang tự map style bằng `textShadow` hack (`app/video/[jobId]/page.tsx:524-550`). Chuyển sang dùng `toPreviewCss()` từ Phase 2, và thêm wrap dòng + IN HOA áp chung cho cả preview lẫn file `.srt`.

## Requirements

- Functional
  - Preview dùng đúng `toPreviewCss(style)`; không còn CSS style phụ đề viết tay trong trang.
  - `toSrt` áp `uppercase` và wrap theo `maxCharsPerLine` (ngắt ở khoảng trắng, không cắt giữa từ, không đổi số cue).
  - Preview ngắt dòng ở cùng vị trí với `.srt`.
  - `maxCharsPerLine = 0` → hành vi y hệt hiện tại.
- Non-functional
  - Wrap là hàm thuần trong `lib/timeline.ts`, cạnh `splitSentences` (dòng 124-131) để preview import chung.

## Architecture

### Bảng quy đổi ASS → CSS

| ASS | CSS |
|---|---|
| `Outline=w` + `OutlineColour` (mode outline) | `paint-order: stroke fill` + `-webkit-text-stroke: {w*2}px {color}` (CSS stroke căn giữa, ASS căn ngoài → nhân đôi) |
| `BorderStyle=3` (mode box) | `background: {outlineColor@opacity}` + `padding: {outlineWidth}` + `box-decoration-break: clone` |
| `Shadow=d` + `BackColour` | `text-shadow: {d}px {d}px 0 {shadowColor}` |
| `Spacing` | `letter-spacing` |
| `Bold/Italic/Underline` | `font-weight/font-style/text-decoration` |
| `MarginV` | `top`/`bottom` theo `position` (đã dùng `cqh`) |
| `MarginL/R` | `padding-inline` theo `cqw` (thay `px-[4cqw]` cứng ở `:526`) |
| đơn vị @PlayResY=288 | `calc({v} / 2.88 * 1cqh)` |

`opacity` áp vào `color` bằng `rgba()` chứ không dùng thuộc tính `opacity` (tránh làm mờ cả viền).

### Wrap

```ts
// lib/timeline.ts
export function wrapCaption(text: string, maxChars: number): string  // trả chuỗi có '\n'
```

- `maxChars <= 0` → trả nguyên văn.
- Ngắt tham lam theo từ; từ dài hơn `maxChars` thì để tràn (không cắt giữa từ — tiếng Việt không có từ dài bất thường).
- `toSrt` gọi `wrapCaption(uppercase ? text.toUpperCase() : text, maxCharsPerLine)`; SRT cho phép cue nhiều dòng nên số cue không đổi.
- Preview: `white-space: pre-line` + cùng hàm wrap → xuống dòng cùng chỗ.

**Ràng buộc**: `toSrt(timeline, segments)` hiện chưa nhận style. Thêm tham số thứ ba `style?: SubtitleStyle` (optional để CLI/test cũ không vỡ); `lib/render.ts:157` truyền `config.subtitles`.

## Related Code Files

- Modify: `content-extractor/lib/timeline.ts` — `wrapCaption` (mới), `toSrt` nhận style
- Modify: `content-extractor/lib/render.ts:157` — truyền `config.subtitles` vào `toSrt`
- Modify: `content-extractor/app/video/[jobId]/page.tsx:524-550` — overlay dùng `toPreviewCss` + `wrapCaption`
- Modify: `content-extractor/lib/subtitle-style.ts` — hoàn thiện `toPreviewCss`

## Implementation Steps

1. Viết `wrapCaption` + test nhanh các ca: rỗng, một từ dài, `maxChars=0`, câu dài nhiều từ.
2. `toSrt` thêm tham số style; áp uppercase + wrap. Giữ mặc định không style = hành vi cũ.
3. `lib/render.ts` truyền style.
4. Hoàn thiện `toPreviewCss` theo bảng quy đổi.
5. Sửa overlay trong trang: bỏ `textShadow` hack, bỏ `px-[4cqw]` cứng, dùng `pre-line` + `wrapCaption`.
6. Đo giá trị `maxCharsPerLine` mặc định hợp lý cho 9:16 @ `sizePct 4.5`: render thử vài mốc (28/32/36/40) rồi chốt (open question của plan).
7. So preview vs frame: chụp preview ở mốc t, trích frame MP4 cùng t, đối chiếu vị trí/độ dày/điểm ngắt dòng.

## Success Criteria

- [x] Overlay preview không còn CSS phụ đề viết tay — chỉ spread `toPreviewCss()`
- [x] `wrapCaption('...', 0)` trả nguyên văn; `verify-render` vẫn thấy đúng 4 caption như trước (KHÔNG so byte — so số cue + nội dung qua test hiện có)
- [x] Bật `uppercase` → `.srt` và frame MP4 đều IN HOA (preset "Đậm nổi" render ra IN HOA)
- [x] Preview và frame MP4 ngắt dòng cùng vị trí — kiểm trên harness `preview-parity-harness.mts` + frame `preview-subtitle-presets.mts`: preset "Đậm nổi" khớp 5/5 dòng; metric chữ lệch ≤5% (ink 708 vs 676px ở cùng em)
- [x] Chốt `maxCharsPerLine` mặc định = **0 (tắt)**. Đo: ở 9:16 style mặc định libass tự wrap đã tôn trọng lề (bbox 73..534 nằm trong vùng an toàn 36..572), wrap thủ công chỉ làm dòng ngắn hơn cần thiết. Wrap là tuỳ chọn cho file `.srt` rời
- [x] `pnpm test:unit` PASS

**Phát sinh ngoài plan — 2 bug hình học của libass, tìm ra nhờ đo pixel:**
1. Cỡ chữ: libass render nhỏ hơn 1,5× so với `PlayResY=288` → thêm `FONT_SIZE_DIVISOR = 432`.
   Trước đây "Cỡ chữ 4,5%" thực tế ra ~3% chiều cao khung.
2. Vị trí: `force_style` dùng hệ căn lề SSA v4 cũ → `top` phải là **6**, `middle` là **10**
   (mã cũ dùng numpad 8/5 nên "Trên" ra giữa-căn-trái, "Giữa" ra trên-căn-trái).

Cả hai khoá lại bằng `scripts/verify-subtitle-render.mts` (đo pixel frame thật).

## Risk Assessment

| Rủi ro | Giảm thiểu |
|---|---|
| CSS stroke ≠ ASS outline về hình học | Nhân đôi độ dày + `paint-order`; badge "Preview xấp xỉ" vẫn giữ |
| Hộp CSS bo/padding ≠ hộp libass | Chấp nhận sai số; ghi rõ trong tooltip panel |
| `toSrt` đổi chữ ký làm vỡ CLI/test cũ | Tham số style là optional, mặc định giữ hành vi cũ |
| Wrap ở preview và ở `.srt` lệch nhau | Bắt buộc dùng chung `wrapCaption`, cấm wrap bằng CSS `max-width` |
