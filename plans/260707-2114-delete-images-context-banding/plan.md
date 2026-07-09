---
title: Xoá ảnh + Cắt band giữ ngữ cảnh
description: >-
  Thêm xoá ảnh ở upload + storyboard; rework smart-split sang cắt theo gutter
  dày giữ nhân vật kèm bong bóng. TDD.
status: completed
priority: P2
branch: main
tags:
  - content-extractor
  - banding
  - ux
blockedBy: []
blocks: []
created: '2026-07-07T14:14:39.548Z'
createdBy: 'ck:plan'
source: skill
---

# Xoá ảnh + Cắt band giữ ngữ cảnh

## Overview

Hai tính năng độc lập cho `content-extractor/` (Next.js 16, store in-memory, không DB), làm theo TDD:

1. **Xoá ảnh** — thêm `deleteItem`/`deleteBeat` + route `DELETE` + nút xoá ở khu upload (preview band) và ở storyboard (từng nhịp). Hard-delete, re-index, không undo.
2. **Cắt band giữ ngữ cảnh** — rework `lib/smart-split.ts`: chỉ cắt tại gutter dày (`≥ MIN_GUTTER_HEIGHT`), bỏ qua khe hẹp nhân vật↔bong bóng, gộp band non nội dung. Giữ chữ ký `detectBands()`/`BeatRegion` và bất biến band liền mạch phủ kín canvas.

Brainstorm đã duyệt: `docs/brainstorms/2026-07-07-delete-images-and-context-aware-banding.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Delete images (TDD)](./phase-01-delete-images-tdd.md) | Completed |
| 2 | [Context-aware banding (TDD)](./phase-02-context-aware-banding-tdd.md) | Completed |
| 3 | [Verify & docs](./phase-03-verify-docs.md) | Completed |

## Dependencies

- Phase 1 và Phase 2 **độc lập** (không đụng file chung): P1 = jobs/store/routes/UI; P2 = smart-split/verify-banding. Có thể làm song song.
- Phase 3 `blockedBy: [1, 2]` — chạy full test + cập nhật docs sau khi cả hai xong.
- Kế thừa (không chặn) hai plan đã `completed`: `260706-1405-content-extractor`, `260706-2239-storyboard-narration-stage-1-5`.

## Acceptance (tổng hợp)

- Xoá band ở preview `ready` → re-index 0..n-1, `progress.total` cập nhật, chặn khi đang chạy.
- Xoá nhịp ở storyboard → `order` re-sequence, chặn khi `queued/processing`.
- Band synthetic [khối nhân vật | khe hẹp < MIN_GUTTER | khối bong bóng] KHÔNG bị cắt ở giữa.
- Gutter dày ≥ MIN_GUTTER sau MIN_BAND_HEIGHT LÀ điểm cắt; band ∈ [min,max] trừ band cuối; liền mạch Σh = chiều cao; band gần trắng bị gộp.
- `pnpm test:unit` + `pnpm test:e2e` PASS; `eslint` + `tsc --noEmit` + `next build` sạch.

## Ngoài phạm vi

Không connected-component; không UI band-size/preview vạch cắt; không phân nhánh pages/strip; không undo/multi-select/GC buffer; không xoá ở bảng kết quả vision.

## Ghi chú môi trường

Chạy qua Node 24 (Herd nvm — `nvm use 24` trước lệnh). E2E chạy `build` + `next start :3105` với env mock (không kill dev :3000). pnpm 11 `allowBuilds` cho sharp.
