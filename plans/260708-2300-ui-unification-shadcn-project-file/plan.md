---
title: "Đồng bộ UI 4 Stage + File project (.mtvproj)"
description: "Redesign toàn bộ UI content-extractor bằng shadcn/ui (Tailwind v4 + React 19 + Next 16): app shell + stepper 4 bước, file project .mtvproj thay reload manifest+ảnh, tách Kịch bản thành route riêng, storyboard master-detail + crop trực quan. Giữ nguyên logic Stage Video."
status: completed
priority: P2
branch: "main"
tags: [ui, shadcn, refactor, project-file]
blockedBy: []
blocks: []
created: "2026-07-08T16:00:50.448Z"
createdBy: "ck:plan"
source: skill
---

# Đồng bộ UI 4 Stage + File project (.mtvproj)

## Overview

App `content-extractor` có 4 stage (Trích xuất → Storyboard → Kịch bản → Video) nhưng UI rời rạc: `layout.tsx` rỗng nên không có app shell chung, mỗi trang tự dựng header + điều hướng, màu/bề rộng gõ tay, "nạp lại storyboard từ manifest + ảnh" fragile do phải re-ingest. Plan này redesign toàn bộ bằng **shadcn/ui** (stack đã xác minh: Tailwind v4 CSS-first, React 19.2, Next 16.2), thêm **app shell + stepper**, thay reload bằng **file project `.mtvproj`** (zip chứa cả data + ảnh → không re-ingest, không phụ thuộc env), tách **Kịch bản** thành route `/script/[jobId]`, và làm lại **Storyboard** thành master-detail + chọn vùng trực quan.

Nguồn: `docs/brainstorms/2026-07-08-ui-unification-project-file.md` (đã chốt qua hỏi–đáp).

**Bất biến giữ nguyên:** logic ingest/vision/smart-split, Ken Burns/timeline/render CLI, đồng bộ audio-là-nhạc-trưởng của Stage 2. Không DB/auth/queue. Job vẫn in-memory; file (`.mtvproj` / `bundle.zip` / manifest JSON) là bản lưu.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation & Shell](./phase-01-foundation-shell.md) | Completed |
| 2 | [Project File mtvproj](./phase-02-project-file-mtvproj.md) | Completed |
| 3 | [Reskin Extract + Video](./phase-03-reskin-extract-video.md) | Completed |
| 4 | [Storyboard master-detail + Script route](./phase-04-storyboard-master-detail-script-route.md) | Completed |

## Dependency graph

- Phase 1 (Foundation): không phụ thuộc. Là nền cho mọi phase sau.
- Phase 2 (Project file): phụ thuộc Phase 1 (dùng shell top-bar + toast).
- Phase 3 (Reskin Extract+Video): phụ thuộc Phase 1. Stage 1 gỡ block reload → dùng nút "Mở project" của Phase 2 (nếu làm Phase 3 trước Phase 2, để nút Mở project ở trạng thái stub).
- Phase 4 (Storyboard + Script route): phụ thuộc Phase 1. Tái dùng pattern component từ Phase 3 (không block).

Thứ tự khuyến nghị: 1 → 2 → 3 → 4. Phase 2 trước Phase 3 để nút "Mở project" hoạt động khi gỡ khối reload cũ.

## Cross-plan

Mọi plan trong `plans/` đều `completed` → không có phụ thuộc chéo. Plan này kế thừa các artifact Stage 1/1.5/2 đã hoàn thành.

## Acceptance criteria (toàn plan)

- [x] 4 trang dùng chung app shell (top bar + stepper) + bộ token shadcn; không còn `max-w`/màu nút gõ tay lệch nhau.
- [x] Mở lại phiên làm việc chỉ bằng 1 file `.mtvproj` (không chọn ảnh rời, không lỗi "region vượt biên"/env).
- [x] Kịch bản ở route `/script/[jobId]`; storyboard chọn vùng bằng kéo-thả + bố cục master-detail.
- [x] Stage Video: hành vi player/timeline/export bundle KHÔNG đổi.
- [x] `npm run build` + `npm run lint` sạch; `npm run test:unit` + verify scripts hiện có pass; thêm `scripts/verify-project.mts` pass.

## Non-goals

- Không đổi logic ingest/vision/smart-split/Ken Burns/timeline/render CLI.
- Không thêm DB/auth/queue/persistence server-side.
- Không drag-reorder nhịp (không nằm trong phạm vi đã chốt).
- Không đổi định dạng `bundle.zip` (hand-off CLI giữ nguyên).

## Rủi ro chính

- Redesign toàn bộ = blast radius lớn → chia phase, giữ logic, không xoá route/endpoint cũ tới khi bản mới xanh.
- Radix trên React 19 / Tailwind v4 → verify từng primitive khi thêm; dùng đường cài shadcn cho Tailwind v4.
- `.mtvproj` phải rehydrate cả Job (Stage 1) lẫn Storyboard/Script/Audio mà KHÔNG re-ingest → embed đủ bytes ảnh; audio mp3 phải tái tạo về `TTS_CACHE_DIR` với `mp3Path` đúng.
