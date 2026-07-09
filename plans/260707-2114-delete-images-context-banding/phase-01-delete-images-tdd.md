---
phase: 1
title: Delete images (TDD)
status: completed
priority: P2
dependencies: []
effort: S
---

# Phase 1: Delete images (TDD)

## Overview

Cho phép xoá ảnh ở hai bề mặt độc lập: band ở khu upload (job item, trước storyboard) và nhịp ở storyboard (beat). Hard-delete + re-index, chặn khi pipeline đang chạy. Không undo/soft-delete/GC buffer.

## Requirements

- **Functional**: xoá 1 band ở preview `ready` → biến mất, phần còn lại re-index; xoá 1 nhịp ở storyboard → biến mất, `order` re-sequence. Cả hai cập nhật `progress.total`/`done`. Chặn xoá khi đang chạy.
- **Non-functional**: giữ store in-memory; không đụng schema/manifest contract; không phá mapping `sourceIndex` (xoá item chỉ ở phase `ready`, TRƯỚC khi tạo storyboard — an toàn).

## Architecture

- `StoredItem.index` là vị trí mảng và là identity ở route `/items/[i]`. Xoá ⇒ splice + gán lại `.index` cho các phần tử sau. Client refetch DTO, render lại theo index mới.
- `StoredBeat` có `order`. Xoá ⇒ splice theo `id` + gán lại `order` 0..n-1. Working image để orphan (KISS).
- Chặn thời điểm: item chỉ xoá khi `phase ∈ {ready, done, failed}`; beat chỉ xoá khi `phase ∉ {queued, processing}`. Enforce ở route (trả 409).

## Related Code Files

- Modify: `content-extractor/lib/jobs.ts` — thêm `deleteItem(id, index): Job | undefined`.
- Modify: `content-extractor/lib/storyboard-store.ts` — thêm `deleteBeat(jobId, beatId): StoryboardState | undefined`.
- Modify: `content-extractor/app/api/jobs/[id]/items/[i]/route.ts` — thêm handler `DELETE` (cạnh `PATCH`).
- Modify: `content-extractor/app/api/jobs/[id]/storyboard/beats/[beatId]/route.ts` — thêm handler `DELETE`.
- Modify: `content-extractor/app/page.tsx` — nút ✕ trên ô band ở lưới preview.
- Modify: `content-extractor/app/storyboard/[jobId]/page.tsx` — nút "Xoá" trong hàng nút mỗi nhịp.
- Modify (test): `content-extractor/scripts/verify-ingest.mts` — unit assert `deleteItem`/`deleteBeat`.
- Modify (test): `content-extractor/scripts/e2e-storyboard.mts` — e2e assert route `DELETE`.

## Implementation Steps (TDD — test trước, code sau)

1. **RED — unit** (`verify-ingest.mts`): thêm assert cho:
   - `deleteItem`: tạo job 3 item, xoá index giữa → còn 2 item, `.index` = `[0,1]`, `progress.total = 2`, `done` khớp `recomputeDone`. Xoá index ngoài biên → no-op (job không đổi). Xoá item cuối → `total = 0`.
   - `deleteBeat`: seed storyboard 3 beat, xoá beat giữa → còn 2, `order = [0,1]`, `progress.total = 2`. Xoá `beatId` không tồn tại → no-op.
   Chạy `pnpm test:unit` → assert mới FAIL (hàm chưa có).
2. **GREEN — store**:
   - `jobs.ts::deleteItem`: guard `store.get(id)`; index hợp lệ → `items.splice(index,1)`; `items.forEach((it,i)=>it.index=i)`; `updateProgress(id, { total: items.length, done: recomputeDone(job), currentIndex: null })`; trả `job`.
   - `storyboard-store.ts::deleteBeat`: `findIndex` theo id; `-1` → trả state nguyên; splice; `beats.forEach((b,i)=>b.order=i)`; `updateStoryboardProgress(jobId, { total, done: recomputeDone(state), currentIndex: null })`; trả state.
   Chạy `pnpm test:unit` → xanh.
3. **RED — e2e** (`e2e-storyboard.mts`): thêm assert:
   - `DELETE /api/jobs/{id}/items/{i}` khi `ready` → 200, DTO còn ít item hơn, index liên tục.
   - `DELETE` khi job đang `processing` (hoặc mô phỏng) → 409.
   - `DELETE /api/jobs/{id}/storyboard/beats/{beatId}` → 200, beat biến mất; `beatId` lạ → 404; khi `queued/processing` → 409.
4. **GREEN — routes**:
   - `items/[i]/route.ts` `DELETE`: parse `index`; 404 nếu job/item không có; 409 nếu `phase ∈ {queued, processing}`; gọi `deleteItem`; trả `toJobStatusDTO(job)`.
   - `beats/[beatId]/route.ts` `DELETE`: 404 nếu storyboard/beat không có; 409 nếu `phase ∈ {queued, processing}`; gọi `deleteBeat`; trả `toStoryboardDTO(state)`.
   Chạy `pnpm test:e2e` → xanh.
5. **UI** (không có harness — kiểm bằng build + tay):
   - `page.tsx`: trong `figure` của lưới preview, thêm nút ✕ góc trên phải; onClick gọi `DELETE`, set `items` từ DTO; `disabled={busy}`. Đặt `figure` `relative`, nút `absolute`.
   - `storyboard/[jobId]/page.tsx`: thêm nút "Xoá" cạnh ▲▼ trong nhánh không-edit; onClick `DELETE` rồi `setDto(next)` + `setRev`; `disabled={isBusy || running}`. Dùng lại `stopPropagation` như các nút khác.

## Success Criteria

- [ ] Unit `deleteItem`/`deleteBeat` PASS (re-index, re-order, progress, no-op biên).
- [ ] E2E `DELETE` item + beat: 200 khi hợp lệ, 404 id lạ, 409 khi đang chạy.
- [ ] UI: ✕ ở preview xoá band (disabled khi busy); "Xoá" ở storyboard xoá nhịp (disabled khi running).
- [ ] Xoá phần tử cuối → danh sách rỗng, không crash.
- [ ] `eslint` + `tsc --noEmit` + `next build` sạch.

## Risk Assessment

- **Xoá giữa lúc chạy**: chặn bằng 409 theo phase + `disabled` ở UI. Rủi ro thấp.
- **Lệch mapping `sourceIndex`**: chỉ cho xoá item ở phase `ready` (trước storyboard); beat thao tác trên `state.beats` độc lập job. Không đụng nhánh compose.
- Rollback: revert theo file; không có migration/contract thay đổi.
