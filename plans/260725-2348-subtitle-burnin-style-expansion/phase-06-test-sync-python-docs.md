---
phase: 6
title: "Test + sync Python + docs"
status: pending
priority: P3
effort: "4h"
dependencies: [5]
---

# Phase 6: Test + sync Python + docs

## Overview

Khoá hành vi bằng test tự động, đồng bộ bản Python của skill `manga-to-video`, cập nhật tài liệu.

## Requirements

- Functional
  - `scripts/verify-subtitle-style.mts` phủ: mapping ASS, migration v1→v2, clamp, wrap, preset.
  - Test end-to-end nhẹ: burn thật một cue rồi assert stderr libass (`fontselect:`) trỏ font bundled.
  - `mtv/ffmpeg_cmd.py` hỗ trợ đủ field mới và cho phép truyền style từ ngoài.
  - README ghi rõ: catalog font, `SUBS_FONTS_DIR` là override, quy tắc chọn binary có libass.
- Non-functional
  - Test mới nối vào `pnpm test:unit` (chuỗi lệnh trong `package.json`).
  - Test burn thật phải tự bỏ qua (skip, không fail) khi không nguồn ffmpeg nào có libass.

## Architecture

### Test

| Nhóm | Assertion |
|---|---|
| Mapping | `toAssForceStyle` sinh đúng tên field; đối chiếu whitelist field ASS V4+ (bắt lỗi chính tả — libass bỏ qua im lặng nên không thể dựa vào exit code) |
| Mode viền | `border:'box'` → `BorderStyle=3` và màu hộp lấy từ `outlineColor`; `border:'none'` → `Outline=0` |
| Màu | `#ff0000` + opacity 1 → `&H000000FF`; opacity 0.5 → `&H800000FF` |
| Migration | fixture config v1 → v2 đúng; chuỗi ASS tương đương bản cũ |
| Clamp | giá trị rác không ném lỗi, kẹp đúng biên |
| Wrap | `wrapCaption` các ca biên; `maxCharsPerLine=0` giữ nguyên |
| Preset | mỗi preset merge ra style hợp lệ (qua được clamp không đổi giá trị) |
| Burn thật | render 1 cue 1 giây, stderr chứa `fontselect:` trỏ `public/fonts/…`; skip nếu không có libass |

### Sync Python

`~/.claude/skills/manga-to-video/scripts/mtv/ffmpeg_cmd.py`:
- `SUBTITLE_STYLE_DEFAULTS` cập nhật đủ field v2 (snake_case như hiện tại).
- `burn_subs` dựng `force_style` theo cùng bảng mapping (kể cả quy tắc `OutlineColour` mang hai nghĩa).
- `scripts/render.py` thêm `--subs-style <json>` để nhận style từ ngoài; không truyền → dùng defaults (giữ hành vi cũ).
- Skill có font riêng hay không: mặc định đọc `SUBS_FONTS_DIR`; ghi vào SKILL.md rằng thiếu font bundled thì libass fallback font hệ thống.

### Docs

- `content-extractor/README.md`: bảng env (`SUBS_FONTS_DIR` giờ là override), mục ffmpeg + libass, danh sách font catalog.
- `docs/` chỉ cập nhật nếu có file mô tả kiến trúc render — kiểm trước khi sửa, không thêm changelog nhiễu.

## Related Code Files

- Create: `content-extractor/scripts/verify-subtitle-style.mts`
- Modify: `content-extractor/package.json` — nối test vào `test:unit`
- Modify: `~/.claude/skills/manga-to-video/scripts/mtv/ffmpeg_cmd.py`
- Modify: `~/.claude/skills/manga-to-video/scripts/render.py`
- Modify: `~/.claude/skills/manga-to-video/SKILL.md`
- Modify: `content-extractor/README.md`

## Implementation Steps

1. Viết `verify-subtitle-style.mts` theo bảng test, dùng cùng phong cách `ok()` như các `verify-*.mts` hiện có.
2. Nối vào `test:unit` trong `package.json`.
3. Cập nhật `ffmpeg_cmd.py` + `render.py` + `SKILL.md`; chạy gate test của skill (`~/.claude/skills/manga-to-video/tests`).
4. Cập nhật README.
5. Chạy full: `pnpm test:unit`, `pnpm test:render`, `pnpm lint`, `next build`, `pnpm test:e2e-video`.

## Success Criteria

- [x] `pnpm test:unit` gồm `verify-subtitle-style.mts` + `verify-fonts.mts` + `verify-subtitle-render.mts`, PASS
- [x] Test burn thật PASS trên máy dev (libass qua bundled). Nhánh **SKIP chưa chạy được** — cần máy không có libass ở cả PATH lẫn bundled; code nhánh đó là `if (!bin) { skip }`, đã typecheck
- [x] Gate test của Python skill PASS sau khi sync (`run_smoke.py`: 16 case OK; `test_auto_region.py`: PASS)
- [x] `pnpm test:e2e-video` PASS (E2E_SCRIPT_VIDEO_ALL_PASS, chạy với 3 mock + `next start :3105`)
- [x] README phản ánh đúng hành vi mới: `SUBS_FONTS_DIR` là override, thêm mục 2 quirk libass

Ngoài plan: thêm `scripts/verify-subtitle-render.mts` (đo pixel) và 2 script tiện ích
`preview-subtitle-presets.mts` (xuất frame mẫu) + `preview-parity-harness.mts` (dựng HTML so
preview với frame).

## Risk Assessment

| Rủi ro | Giảm thiểu |
|---|---|
| Test burn thật chậm/giòn trên CI | Chỉ 1 cue, 1 giây, khung 320×180; skip khi thiếu libass |
| Sync Python trôi tiếp trong tương lai | Ghi bảng mapping vào docstring `burn_subs` kèm trỏ tới `lib/subtitle-style.ts` |
| README lệch thực tế | Sửa README sau cùng, đọc lại trước khi ghi |
