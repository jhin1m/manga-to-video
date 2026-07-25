---
status_note: "Hoàn tất 2026-07-26. Ngoài scope ban đầu: sửa thêm 2 bug hình học của libass (cỡ chữ chia 432, căn lề hệ SSA v4) tìm ra khi đo pixel — chi tiết trong phase-05."
title: "Mở rộng tuỳ chọn phụ đề burn-in"
description: "Panel phụ đề đầy đủ (font bundle, màu/alpha, viền, bóng, nền hộp, kiểu chữ, lề, wrap) + sửa lỗi burn-in không chạy vì ffmpeg PATH thiếu libass"
status: pending
priority: P1
effort: "3-5d"
tags: [render, ffmpeg, subtitles, ui]
created: 2026-07-25
brainstorm: ../reports/brainstorm-260725-2335-subtitle-burnin-style-expansion-report.md
---

# Mở rộng tuỳ chọn phụ đề burn-in

## Overview

Panel "Phụ đề" hiện có 7 control, engine map đúng 5 field ASS. Mở rộng thành bộ tuỳ chọn đầy đủ (font catalog bundled, màu + độ mờ, viền dày/màu, bóng, nền hộp, bold/italic/underline/IN HOA, giãn chữ, lề ngang, wrap dòng, preset) — giữ nguyên pipeline SRT → `subtitles` filter, chỉ nạp đủ `force_style`.

Kèm 1 bug fix chặn đường: **trên máy dev hiện tại burn-in KHÔNG chạy** — ffmpeg trên PATH (brew 8.1.2) build thiếu libass, mà `resolveBin` ưu tiên PATH.

## Kiểm chứng thực nghiệm (2026-07-25, đã chạy)

Mọi quyết định dưới đây dựa trên đo thật, không phải giả định:

| # | Phát hiện | Bằng chứng |
|---|---|---|
| 1 | ffmpeg PATH (brew 8.1.2) **KHÔNG có** filter `subtitles`/`ass` | `ffmpeg -filters \| grep subtitles` → 0 dòng; chạy filter → `No such filter: 'subtitles'` |
| 2 | ffmpeg bundled (`ffmpeg-static` 5.3.0 = ffmpeg 6.0) **CÓ** libass 0.17.0 | config có `--enable-libass --enable-libfreetype --enable-fontconfig`; `-filters` liệt kê cả `ass` và `subtitles` |
| 3 | `force_style` nhận đủ field dự định | Render OK với `Bold, Italic, Underline, Spacing, OutlineColour, BackColour, BorderStyle=1\|3, Outline, Shadow, Alignment, MarginL/R/V`, alpha `&H80…` |
| 4 | **Màu hộp khi `BorderStyle=3` là `OutlineColour`, KHÔNG phải `BackColour`** | `BorderStyle=3 + OutlineColour=&H0000FF00` → hộp xanh lá; `BackColour` đỏ không ảnh hưởng hộp |
| 5 | `BorderStyle=1`: viền = `OutlineColour`, bóng = `BackColour` | `OutlineColour=&H000000FF` + `BackColour=&H00FF0000` → viền đỏ, bóng xanh dương |
| 6 | Alpha PrimaryColour hoạt động | `&H80FFFFFF` → chữ mờ 50% |
| 7 | **Field sai tên bị bỏ qua IM LẶNG** | `FieldKhongCoThat=9` → exit 0, không cảnh báo |
| 8 | Font không tồn tại → fallback im lặng, nhưng libass **log ra stderr** | `fontselect: (KhongTonTai123, 400, 0) -> /System/Library/Fonts/Helvetica.ttc, -1, Helvetica` |

**Hệ quả thiết kế:**
- (1)(2) → cần chọn binary theo năng lực libass cho bước burn (Phase 1).
- (4)(5) → schema dùng `outlineColor` cho CẢ viền lẫn hộp (đổi nhãn UI theo mode), `shadowColor` riêng → `BackColour`. Đây là **sửa lại** so với thiết kế brainstorm ban đầu (nhầm hộp = BackColour).
- (7) → test không được dựa vào exit code ffmpeg; phải assert chuỗi `force_style` sinh ra.
- (8) → dòng `fontselect:` là assertion tin cậy cho "render dùng đúng font bundled".

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Burn-in chạy được trên máy có ffmpeg PATH thiếu libass | P1 |
| 2 | Bộ tuỳ chọn style đầy đủ, một nguồn sự thật cho render + preview | P1 |
| 3 | Font bundled → render giống nhau trên mọi máy, preview khớp render | P1 |
| 4 | Preset dựng sẵn + panel UI dùng được, không rối | P2 |
| 5 | Wrap dòng + lề ngang để chữ không chạy sát mép | P2 |
| 6 | Không lệch TS ↔ Python skill | P3 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Chọn ffmpeg có libass cho burn](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Schema v2 + subtitle-style module](./phase-02-schema-v2-subtitle-style-module.md) | Pending |
| 3 | [Phase 3: Font bundle + catalog](./phase-03-font-bundle-catalog.md) | Pending |
| 4 | [Phase 4: UI panel + presets](./phase-04-ui-panel-presets.md) | Pending |
| 5 | [Phase 5: Preview parity + wrap dòng](./phase-05-preview-parity-wrap-dong.md) | Pending |
| 6 | [Phase 6: Test + sync Python + docs](./phase-06-test-sync-python-docs.md) | Pending |

Phụ thuộc: tuyến tính 1 → 2 → 3 → 4 → 5 → 6. Phase 1 độc lập về giá trị (ship riêng được).

## Schema đích (v2)

```ts
interface SubtitleStyle {
  export: boolean; burnIn: boolean;              // giữ nguyên
  font: string;                                   // family name từ catalog
  sizePct: number;                                // % chiều cao khung
  color: string; opacity: number;                 // → PrimaryColour &HAABBGGRR
  bold: boolean; italic: boolean; underline: boolean;
  uppercase: boolean;                             // transform lúc sinh cue
  letterSpacing: number;                          // → Spacing
  border: 'none' | 'outline' | 'box';             // → BorderStyle 1(+Outline=0) | 1 | 3
  outlineWidth: number;                           // 0–4 → Outline (mode box: padding hộp)
  outlineColor: string; outlineOpacity: number;   // → OutlineColour (viền HOẶC nền hộp)
  shadowDepth: number;                            // 0–4 → Shadow
  shadowColor: string;                            // → BackColour
  position: 'top' | 'middle' | 'bottom';          // → Alignment 8|5|2
  marginPct: number;                              // → MarginV
  sideMarginPct: number;                          // → MarginL = MarginR
  maxCharsPerLine: number;                        // wrap trong toSrt (0 = tắt)
}
```

`RENDER_CONFIG_VERSION` 1 → 2. Migration: `outline: true → outlineWidth 2 + border 'outline'`, `false → outlineWidth 0 + border 'none'`.

## Success Criteria

- [ ] Render in-app trên máy dev hiện tại **có** chữ burn vào MP4 (hiện tại: bị skip + warning)
- [ ] Mọi option trong panel đổi → frame MP4 đổi tương ứng (kiểm bằng trích frame)
- [ ] Font trong catalog → stderr libass in `fontselect: (<family>, …) -> <đường dẫn trong public/fonts>`
- [ ] Preview CSS và frame MP4 cùng mốc thời gian: cùng font, cùng vị trí, cùng kiểu viền/nền
- [ ] bundle.zip config v1 cũ render không lỗi (migration)
- [ ] `pnpm test:unit` + `verify-subtitle-style.mts` PASS; `pnpm lint` + `next build` PASS
- [ ] ffmpeg không có libass ở CẢ hai nguồn → vẫn degrade cảnh báo, không chết

## Out of scope

Sinh `.ass` (fade/karaoke/blur/per-cue) · preset tự lưu của user · persist `renderConfig` vào `.mtvproj` · upload font riêng · đổi thuật toán chia thời lượng caption.

## Open questions

- Weight bundle: chỉ Regular+Bold, hay thêm ExtraBold cho Montserrat/Kanit? → chốt ở Phase 3 sau khi cân dung lượng thật.
- `maxCharsPerLine` mặc định cho 9:16 ở `sizePct` 4.5 → đo thực nghiệm ở Phase 5.

<!-- slug: subtitle-burnin-style-expansion -->
