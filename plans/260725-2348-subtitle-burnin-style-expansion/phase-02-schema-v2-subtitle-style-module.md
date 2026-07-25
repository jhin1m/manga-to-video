---
phase: 2
title: "Schema v2 + subtitle-style module"
status: pending
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 2: Schema v2 + subtitle-style module

## Overview

Mở rộng `SubtitleStyle` lên 18 field, và tách toàn bộ logic map style → ASS / → CSS vào một module thuần `lib/subtitle-style.ts` để render và preview không còn hai nguồn sự thật.

## Requirements

- Functional
  - `toAssForceStyle(style)` sinh chuỗi `force_style` đủ field, escape an toàn.
  - `toPreviewCss(style)` sinh object CSS tương ứng (Phase 5 dùng).
  - `parseConfig` migrate config v1 → v2 và clamp mọi giá trị.
  - Config v1 cũ (có `outline: boolean`, thiếu field mới) render ra kết quả gần y hệt trước đây.
- Non-functional
  - Module thuần, không import `node:*` → test bằng `tsx` không cần ffmpeg, và client component import được.
  - Không có field nào chỉ tồn tại ở một phía (ASS/CSS) mà không ghi chú lý do.

## Architecture

### Mapping ASS (đã kiểm chứng thực nghiệm)

| Field style | ASS | Ghi chú |
|---|---|---|
| `font` | `FontName` | lọc ký tự phá cú pháp như hiện tại (`lib/ffmpeg.ts:375`) |
| `sizePct` | `FontSize` | `round(sizePct/100 * 288)`, tối thiểu 8 |
| `color` + `opacity` | `PrimaryColour` | `&HAABBGGRR`, `AA = round((1-opacity)*255)` |
| `bold/italic/underline` | `Bold/Italic/Underline` | `1`/`0` |
| `letterSpacing` | `Spacing` | đơn vị @PlayResY=288 |
| `border: 'outline'` | `BorderStyle=1` + `Outline=outlineWidth` | |
| `border: 'box'` | `BorderStyle=3` + `Outline=outlineWidth` | `Outline` = padding hộp |
| `border: 'none'` | `BorderStyle=1` + `Outline=0` | |
| `outlineColor` + `outlineOpacity` | `OutlineColour` | **màu viền ở mode outline, MÀU HỘP ở mode box** (đo thực nghiệm) |
| `shadowDepth` | `Shadow` | |
| `shadowColor` | `BackColour` | alpha cố định `00` |
| `position` | `Alignment` | `top→8`, `middle→5`, `bottom→2` |
| `marginPct` | `MarginV` | `round(marginPct/100 * 288)` |
| `sideMarginPct` | `MarginL` = `MarginR` | `round(sideMarginPct/100 * 384)` — **PlayResX = 384**, không phải 288 |
| `uppercase` | — | áp lúc sinh cue trong `toSrt` (Phase 5), không có field ASS |
| `maxCharsPerLine` | — | wrap lúc sinh cue (Phase 5) |

`assColor(hex, opacity)` mở rộng từ hàm `assColor` hiện có (`lib/ffmpeg.ts:345-352`) — thêm tham số alpha, giữ nguyên fallback `&H00FFFFFF` khi hex hỏng.

### Clamp + migrate

```ts
export function migrateSubtitleStyle(raw: unknown): SubtitleStyle  // v1 → v2 + clamp
```

| Field | Biên | v1 → v2 |
|---|---|---|
| `sizePct` | 1–20 | giữ |
| `opacity`, `outlineOpacity` | 0–1 | thiếu → 1 |
| `outlineWidth`, `shadowDepth` | 0–4 | `outline:true → 2`, `false → 0` |
| `letterSpacing` | -2–10 | thiếu → 0 |
| `marginPct` | 0–40 | giữ |
| `sideMarginPct` | 0–25 | thiếu → 6 |
| `maxCharsPerLine` | 0 hoặc 12–80 | thiếu → 0 (tắt, giữ hành vi cũ) |
| `border` | enum | `outline:true → 'outline'`, `false → 'none'` |
| `color/outlineColor/shadowColor` | `^#[0-9a-f]{6}$` (chấp nhận không có `#`) | sai → default |
| `font` | trim, rỗng → default | giữ |
| `position` | enum | giữ |

## Related Code Files

- Create: `content-extractor/lib/subtitle-style.ts`
- Modify: `content-extractor/lib/schema.ts` — interface `SubtitleStyle`, `defaultRenderConfig`, `RENDER_CONFIG_VERSION` 1→2
- Modify: `content-extractor/lib/ffmpeg.ts` — `burnSubs` dùng `toAssForceStyle`, xoá code map inline (dòng 344-390)
- Modify: `content-extractor/lib/storyboard-render-input.ts:75` — `parseConfig` gọi `migrateSubtitleStyle`

## Implementation Steps

1. Cập nhật interface + `defaultRenderConfig()` trong `lib/schema.ts` (default: `border: 'outline'`, `outlineWidth: 2`, `outlineColor: '#000000'`, `outlineOpacity: 1`, `shadowDepth: 0`, `shadowColor: '#000000'`, `opacity: 1`, `letterSpacing: 0`, `sideMarginPct: 6`, `maxCharsPerLine: 0`, bold/italic/underline/uppercase `false`).
2. Tạo `lib/subtitle-style.ts`: `assColor()`, `toAssForceStyle()`, `toPreviewCss()`, `migrateSubtitleStyle()`, hằng `PLAY_RES = { x: 384, y: 288 }`.
3. `burnSubs` bỏ phần dựng `forceStyle` inline, gọi `toAssForceStyle(style)`; giữ nguyên `escapeFilterPath` và `fontsdir`.
4. `parseConfig` thay `subtitles: { ...d.subtitles, ...(r.subtitles ?? {}) }` bằng `subtitles: migrateSubtitleStyle(r.subtitles)`.
5. Chạy `pnpm test:unit` + `pnpm test:render` để bảo đảm chưa vỡ gì.

## Success Criteria

- [x] `toAssForceStyle(defaultRenderConfig().subtitles)` chứa đúng 16 cặp `key=value`, không field nào sai chính tả (đối chiếu danh sách ASS V4+)
- [x] Config v1 `{outline:true, sizePct:4.5, color:'#ffffff', position:'bottom', marginPct:8}` → v2 với `border:'outline'`, `outlineWidth:2`, chuỗi ASS tương đương bản cũ (trừ field mới ở giá trị trung tính)
- [x] Giá trị rác (`sizePct: 999`, `color: 'javascript:'`, `border: 'xyz'`) → clamp/fallback, không ném lỗi
- [x] `pnpm test:unit`, `pnpm test:render`, `pnpm lint` PASS

## Risk Assessment

| Rủi ro | Giảm thiểu |
|---|---|
| Sai tên field ASS → bị libass bỏ qua im lặng (đã đo: không báo lỗi) | Test đối chiếu chuỗi sinh ra với danh sách field cứng; Phase 6 thêm test trích frame |
| PlayResX/PlayResY nhầm lẫn (384 vs 288) → lề ngang sai tỉ lệ | Hằng `PLAY_RES` một chỗ, comment rõ; nghiệm thu bằng frame ở Phase 5 |
| Client component import module có `node:path` → vỡ build | `subtitle-style.ts` tuyệt đối không import `node:*`; `escapeFilterPath` ở lại `ffmpeg.ts` |
