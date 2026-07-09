---
phase: 3
title: "Reskin Extract + Video"
status: completed
priority: P2
effort: ""
dependencies: [1]
---

# Phase 3: Reskin Trích xuất + Video

## Overview

Reskin 2 stage **không đổi cấu trúc**: ① Trích xuất (`app/page.tsx`) và ④ Video (`app/video/[jobId]/page.tsx`) bằng component shadcn của Phase 1. **Giữ nguyên toàn bộ logic** (upload/vision/SSE/poll ở Stage 1; player/Ken Burns/timeline/TTS/export-bundle ở Video — user khen "rất OK"). Chỉ thay lớp trình bày + gỡ header/nút cục bộ (đã lên shell).

## Requirements

- Functional: hành vi 2 trang giữ nguyên byte-cho-byte về logic; chỉ đổi component + bỏ header trùng shell + banner lỗi → toast.
- Non-functional: nhất quán token/spacing với shell; light+dark; a11y (label, focus) theo shadcn.

## Architecture

- **Stage 1 (`app/page.tsx`):**
  - Bỏ `<h1>`/mô tả/cụm nút điều hướng cục bộ (đã ở shell). Dùng `page-shell` (title slot).
  - Dropzone → `Card` + trạng thái drag; nút "Chọn file"/"Chọn thư mục" → `Button`.
  - Lưới band preview → `Card`/grid shadcn, nút xoá ✕ → `Button` icon (`lucide-react` X) + `Tooltip`.
  - Ô "Nhịp req/phút" → `Input` number + label; nút "Chạy tất cả"/"Tạo storyboard"/"Chapter mới" → `Button` (primary/ai/outline theo token).
  - Bảng kết quả → shadcn `Table`; sửa inline → `Textarea` + `Button`; badge lỗi + "Thử lại" → `Badge` destructive + `Button`.
  - **Gỡ block `<details>` "Nạp lại storyboard"** (đã thay bằng "Mở project" top bar ở Phase 2).
  - Banner lỗi `<div>` → `toast.error(...)` (Sonner).
  - Publish readiness vào `project-context` (jobId, hasStoryboard sau khi tạo) để stepper mở bước.
- **Stage Video (`app/video/[jobId]/page.tsx`):**
  - **KHÔNG đụng:** state playback (rAF clock), Ken Burns CSS (`planKenburns`), timeline (`buildTimeline`/`allocateCaptions`/`splitSentences`), audio/BGM effect, `synthAudio`, `exportBundle`.
  - Chỉ thay control panel bên phải: các `<section>` → `Card`; `<input type=range>` → `Slider`; `<select>` → `Select`; checkbox → `Switch`; text/number → `Input`; nút Synth/Export/Kịch bản → `Button` (ai/success/outline). Transport ▶/⏸ → `Button` + `lucide` icon.
  - Header cục bộ → shell + `page-shell`; banner lỗi → toast; badge "Preview xấp xỉ" giữ nguyên (đổi sang `Badge`).
  - Giữ nguyên `containerType:size` + `cqw/cqh` của player (Ken Burns phụ thuộc) — chỉ reskin quanh, không đổi khung player.

## Related Code Files

- Create: none (dùng component Phase 1).
- Modify: `app/page.tsx`, `app/video/[jobId]/page.tsx`.
- Delete: block `<details>` reload trong `app/page.tsx` (state `importManifest`/`importImages`/`importBusy` + hàm `importStoryboard`).

## Implementation Steps

1. Stage 1: thay dropzone/nút/lưới/bảng bằng shadcn; chuyển error→toast; gỡ block reload + state/hàm import cũ; nối readiness vào context. Kiểm SSE/poll/tạo storyboard/xoá band/retry vẫn chạy.
2. Video: thay control panel bằng Slider/Select/Switch/Input/Card; **không chạm** logic player/timeline/synth/export. Kiểm phát/seek/audio-mode/BGM duck/synth/export-bundle vẫn đúng.
3. Đối chiếu light+dark, focus ring, tab order.
4. `npm run build` + `npm run lint` + `npm run test:e2e` + `npm run test:e2e-video` (nếu chạy được cục bộ theo memory next-start) để chắc luồng không vỡ.

## Success Criteria

- [x] Stage 1: upload→preview→run→edit→export + tạo storyboard hoạt động y cũ, giao diện shadcn, không còn block reload.
- [x] Video: phát/seek/audio thật/BGM/synth/export-bundle hoạt động y cũ; MP4 CLI vẫn render từ bundle không đổi.
- [x] Không còn header/nút điều hướng trùng lặp (đã lên shell); lỗi hiện qua toast.
- [x] Build/lint xanh; e2e video pass.

## Risk Assessment

- Video là stage "OK" — rủi ro lớn nhất là reskin làm lệch container/cqw-cqh phá Ken Burns → chỉ đổi control ngoài khung player, giữ nguyên khung.
- Table dày dữ liệu: shadcn Table phải giữ khả năng cuộn ngang (`overflow-x-auto`) như hiện tại.
- Gỡ state import cũ phải xoá hết tham chiếu (grep) tránh lỗi biên dịch.
