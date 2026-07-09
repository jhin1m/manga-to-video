---
phase: 4
title: "Storyboard master-detail + Script route"
status: completed
priority: P2
effort: ""
dependencies: [1]
---

# Phase 4: Storyboard master-detail + Script route

## Overview

Làm lại Stage Storyboard theo 3 điểm đau đã chốt: (1) **chọn vùng region bằng kéo-thả trực quan** thay ô số x/y/w/h; (2) **bố cục master–detail 2 cột** thay "canvas 1/4 + list dọc dài"; (3) **tách Kịch bản AI thành route riêng `/script/[jobId]`** (đang nhồi ở đáy trang storyboard). Không đổi API/endpoint storyboard/script — chỉ đổi UI + tách route.

## Requirements

- Functional:
  - Storyboard: cột trái = list nhịp gọn (thumbnail + số thứ tự + reorder ▲▼ giữ nguyên); cột phải = chi tiết nhịp đang chọn (ảnh working lớn + overlay chọn vùng kéo-thả + editor narration + Generate + xoá).
  - Chọn vùng: kéo khung chữ nhật trên ảnh working → set region (px trên toạ độ working thật). Numeric x/y/w/h giữ lại trong khối "Nâng cao" thu gọn (đồng bộ 2 chiều với khung kéo).
  - Kịch bản: chuyển `ScriptPanel` (đang trong `app/storyboard/[jobId]/page.tsx`) sang route mới `app/script/[jobId]/page.tsx`. Điều hướng qua stepper. Nút "Dựng video" giữ nguyên hành vi (mở khi confirmed).
- Non-functional: giữ mọi mutator hiện có (PATCH beat/region, generate, reorder, delete; script merge/split/reorder/confirm); không regression đồng bộ audio; a11y cho crop (bàn phím chỉnh được qua numeric nâng cao).

## Architecture

- **Master–detail Storyboard (`app/storyboard/[jobId]/page.tsx`):**
  - Layout 2 cột (`lg:flex`): trái `w-72` list nhịp (`Card` mỏng, thumbnail `beat.cropUrl`, click chọn → `selectedBeat`); phải `flex-1` panel chi tiết.
  - Với **strip**: canvas dọc (working[0]) vẫn hiện ở panel chi tiết làm ngữ cảnh, overlay band như cũ nhưng nằm bên detail (không còn aside 1/4 riêng). Với **pages**: detail hiện trang của nhịp.
  - Reorder ▲▼ + xoá + Generate + narration editor: giữ nguyên logic (`beatOp`/`removeBeat`/`generateBeat`/`saveEdit`), chỉ bố trí lại trong detail. Tiến độ compose → `Progress` shadcn.
- **Crop trực quan (`components/region-cropper.tsx`, mới):**
  - Input: ảnh working (`imageUrl`, `width`, `height`), region hiện tại (px), onChange(region|null).
  - Kéo khung chọn (pointer events) trên ảnh hiển thị co giãn; quy đổi từ px hiển thị → px working thật theo tỉ lệ (giống cách overlay strip hiện tính `%`). Có handle resize 4 cạnh/góc (KISS: bắt đầu bằng vẽ khung mới + kéo di chuyển; resize handle nếu còn thời gian).
  - Toggle "Cả trang" = region null. Numeric nâng cao đọc/ghi cùng state (mẫu `BeatDraft` hiện tại, parse lúc set).
  - Ràng buộc: x/y ≥ 0, w/h ≥ 1, không vượt biên `width×height` (mẫu validate PATCH beat).
- **Route Kịch bản (`app/script/[jobId]/page.tsx`, mới):**
  - Chuyển nội dung `ScriptPanel` thành trang: fetch storyboard (cần `working` cho cảnh báo band sót + thumbnail shot) + script; giữ generate/merge/split/reorder/confirm/cảnh báo count-mismatch.
  - Gỡ `<ScriptPanel/>` khỏi trang storyboard. `storyboardReady` gating chuyển thành gating stepper (Kịch bản mở khi storyboard done + beats>0).
  - "Dựng video" giữ nguyên → `/video/{jobId}`.
  - Reskin bằng shadcn (Card/Button/Textarea/Badge), thumbnail shot + nút ✂ tách giữ nguyên.
- **project-context:** storyboard page publish `storyboardDone`; script page publish `scriptConfirmed` (sau confirm) để stepper mở Video.

## Related Code Files

- Create: `app/script/[jobId]/page.tsx`, `components/region-cropper.tsx`.
- Modify: `app/storyboard/[jobId]/page.tsx` (master–detail + dùng cropper + gỡ ScriptPanel), `components/project-context.tsx` (readiness), `README.md` (luồng Kịch bản ở route riêng).
- Delete: `app/storyboard/[jobId]/script-panel.tsx` (chuyển thành route) — hoặc giữ file, import lại từ route mới nếu muốn tách trình bày. Ưu tiên chuyển hẳn thành page để 1 nguồn.

## Implementation Steps

1. Viết `region-cropper.tsx` (kéo khung + quy đổi tỉ lệ + numeric nâng cao đồng bộ + validate biên). Test thủ công strip (canvas cao) + pages.
2. Chuyển storyboard sang master–detail: list trái + detail phải; nhúng cropper vào detail; nối `saveEdit`/`generateBeat`/`beatOp`/`removeBeat` như cũ. Overlay strip đưa vào detail.
3. Tạo `app/script/[jobId]/page.tsx` từ `ScriptPanel`; gỡ `<ScriptPanel/>` khỏi storyboard; chuyển gating sang stepper.
4. Nối readiness vào `project-context`; kiểm điều hướng stepper Storyboard→Kịch bản→Video.
5. `npm run build` + `npm run lint` + `npm run test:e2e` (+ `test:e2e-video`) đảm bảo luồng storyboard→script→video không vỡ.

## Success Criteria

- [x] Region chọn được bằng kéo-thả trên ảnh; numeric nâng cao đồng bộ; validate biên đúng; "Cả trang" = null.
- [x] Storyboard là master–detail; không còn aside canvas 1/4 + list dọc dài; mọi thao tác nhịp (sửa/generate/reorder/xoá) giữ nguyên.
- [x] Kịch bản ở `/script/[jobId]`; storyboard không còn nhồi 2 stage; merge/split/reorder/confirm + cảnh báo band sót hoạt động.
- [x] Stepper điều hướng 4 bước đúng gating; "Dựng video" mở sau confirm.
- [x] Build/lint xanh; e2e storyboard + video pass.

## Risk Assessment

- Quy đổi toạ độ crop (hiển thị co giãn ↔ px working thật) dễ lệch → tái dùng đúng công thức tỉ lệ overlay strip hiện có; verify bằng nhập numeric rồi so khung vẽ.
- Tách route script có thể làm mất context `working` cần cho cảnh báo band sót → route script tự fetch storyboard (như video page đã làm).
- Đồng bộ audio Stage 2 không đổi (chỉ di chuyển UI) — nhưng kiểm confirmed→video vẫn gating đúng.
- Strip canvas rất cao trong detail: giữ `max-h + overflow-y-auto` để không phá layout.
