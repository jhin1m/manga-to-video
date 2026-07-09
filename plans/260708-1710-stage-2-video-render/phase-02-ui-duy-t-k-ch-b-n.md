---
phase: 2
title: "UI duyệt kịch bản"
status: completed
priority: P2
dependencies: [1]
effort: ""
---

# Phase 2: UI duyệt kịch bản

## Overview

Cửa xác nhận tay cho kịch bản AI: hiện `ScriptSegment[]` đề xuất, cho **gộp/tách/sửa text/re-order**, cảnh báo khi số segment lệch nhiều so với số band, chốt `edited=true`. AI đề xuất — người quyết.

## Requirements

- **Functional:** nút "Tạo kịch bản AI" (chỉ hiện khi storyboard `ready`/`done`) → gọi P1 route → render danh sách segment (narration + thumbnail các shot). Thao tác: sửa narration inline, gộp 2 segment liền kề, tách 1 segment, đổi thứ tự, xoá. Cảnh báo count-mismatch. "Xác nhận kịch bản" khoá lại → mở đường sang "Dựng video" (P4).
- **Non-functional:** mẫu edit inline + rev-guard của storyboard hiện tại; SSE/poll không bắt buộc (thao tác đồng bộ).

## Architecture

- Mở rộng `app/storyboard/[jobId]/page.tsx` (hoặc tách component `ScriptPanel`): state client giữ `segments` sau khi POST `/storyboard/script`.
- **Routes sửa segment** (mẫu per-beat PATCH/DELETE hiện có), thêm dưới `app/api/jobs/[id]/storyboard/script/`:
  - `PATCH segments/[segId]` → `{ narration? }` (cập nhật + `edited=true`, `durationHint` tính lại).
  - `POST segments/merge` → `{ segIds: [a,b] }` → gộp shots + nối narration (người sửa lại).
  - `POST segments/split` → `{ segId, atShotIndex }` → tách shots thành 2 segment.
  - `DELETE segments/[segId]` → xoá + re-order.
  - `POST segments/reorder` → `{ segId, to }`.
  - Mọi mutator gọi hàm store P1; `409` khi đang compose.
- **Cảnh báo count:** so `segments.flatMap(shots).length` (số band phủ) với số band gốc — thiếu band nào → badge "Band #k chưa vào kịch bản".
- Mỗi shot hiển thị thumbnail qua route working image sẵn có: `/api/jobs/{id}/storyboard/working/{sourceIndex}/image`.

## Related Code Files

- Modify: `content-extractor/app/storyboard/[jobId]/page.tsx` (nút "Tạo kịch bản AI" + panel duyệt segment + "Dựng video")
- Create: `content-extractor/app/api/jobs/[id]/storyboard/script/segments/[segId]/route.ts` (PATCH/DELETE)
- Create: `content-extractor/app/api/jobs/[id]/storyboard/script/segments/{merge,split,reorder}/route.ts`
- Modify: `content-extractor/lib/storyboard-store.ts` (nếu mutator gộp/tách chưa đủ ở P1)

## Implementation Steps

1. Nút "Tạo kịch bản AI" → POST script → nạp segments vào state, hiện panel.
2. Render segment: narration (textarea inline), dải thumbnail shots, badge count-mismatch.
3. Routes PATCH/DELETE/merge/split/reorder → gọi store mutators (P1).
4. Thao tác gộp/tách/sửa/reorder cập nhật state + gọi route; undo bằng "Tạo lại" (regenerate).
5. "Xác nhận kịch bản" → chốt; hiện nút "Dựng video" điều hướng `/video/[jobId]` (P4).

## Success Criteria

- [x] Bấm "Tạo kịch bản AI" → hiện segment đề xuất kèm thumbnail shots.
- [x] Gộp/tách/sửa/xoá/reorder segment hoạt động, `edited=true` sau sửa.
- [x] Band bị bỏ sót → cảnh báo rõ (không cho "Dựng video" mặc kệ, hoặc cảnh báo mạnh).
- [x] "Dựng video" chỉ mở khi đã xác nhận kịch bản.

## Risk Assessment

- **AI regroup sai** → thao tác gộp/tách + "Tạo lại" phải dễ; đây là cửa duyệt chính.
- **Route sprawl** → gom mutator vào store P1; route mỏng. Cân nhắc 1 endpoint `PUT script` lưu cả mảng nếu PATCH lẻ quá vụn (chọn theo mức phức tạp thực tế).
