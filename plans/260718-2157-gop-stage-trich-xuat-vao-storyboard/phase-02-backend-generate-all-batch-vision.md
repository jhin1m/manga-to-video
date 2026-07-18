---
title: "Phase 2: Frontend — thu gọn / thành trang nhận chapter"
status: done
priority: P1
dependencies: [1]
---

# Phase 2: Frontend — thu gọn `/` thành trang nhận chapter

## Overview

Lột phần vision + bảng kết quả khỏi `app/page.tsx`. `/` chỉ còn: upload → preview band (xoá band
rác) → ngữ cảnh chương → **Tạo storyboard**. Mọi việc nội dung dời sang Storyboard (Phase 3).

## Requirements

- Functional: giữ upload (drag/drop, chọn file/thư mục, zip/pdf), lưới preview band + nút xoá band,
  textarea context (PATCH khi blur + trước khi tạo storyboard), nút "Tạo storyboard", "Chapter mới".
- Functional: **bỏ** khỏi `/`: ô RPM, nút "Chạy tất cả", `handleRun`/`/run`, SSE `/stream` + poll vision,
  progress bar vision, bảng kết quả + draft/sửa/`saveEdit`/`retryItem`/Export JSON.
- Non-functional: `/` sau khi tạo storyboard điều hướng `/storyboard/{id}` (đã có). Tiêu đề/subtitle đổi
  từ "Trích xuất nội dung" → "Nhận chapter".

## Architecture

`page.tsx` hiện gộp 2 vai: (a) upload+preview, (b) run vision+results. Chỉ giữ (a).

- Job vẫn tạo qua `POST /api/jobs` (phase `ready`) → hiển thị lưới band từ `dto.items` (ItemDTO:
  `imageUrl/filename/index`). Không còn phase nào khác trên trang này (job đứng yên ở `ready`).
- `createStoryboard()` giữ nguyên: `saveContext` → `POST /storyboard` → `publish({hasStoryboard})` →
  `router.push('/storyboard/'+jobId)`.
- Xoá state/refs không dùng: `progress`, `drafts`, `rowBusy`, `rpm`, `esRef`, `pollRef`, `attachStream`,
  `pollUntilDone`, `stopPolling`, `refreshItems`, `handleRun`, `startEdit/cancelEdit/saveEdit`, `retryItem`,
  `phaseLabel`, `showResults/isReady/running/pct`. Giữ `busy`, `jobId`, `items`, `context`, `savedContext`,
  `sbBusy`, `removeItem`, `saveContext`, `handleUpload/handleSelection`, `resetAll`.
- Lưới preview: giữ khối `jobId && isReady` nhưng bỏ điều kiện `isReady` (job luôn `ready`), render khi
  `jobId && items.length`. Card toolbar chỉ còn context + "Tạo storyboard" + "Chapter mới".

## Related Code Files

- Modify: `content-extractor/app/page.tsx` — cắt lớn phần vision/results; giữ upload+preview+context.
- Modify: `content-extractor/app/layout.tsx` — metadata description "Trích xuất nội dung…" → mô tả luồng mới.
- Reference (không sửa phase này): `/api/jobs` POST, `/items/[i]` DELETE, `/items/[i]/image`.

## Implementation Steps

1. Xoá import không dùng (`Table*`, `Progress`, `Loader2/RotateCcw`, `JobProgress/JobStatusDTO` nếu hết dùng — giữ `JobStatusDTO` cho upload/context PATCH).
2. Xoá các hàm/effect vision/results liệt kê ở Architecture.
3. Rút gọn JSX: chỉ còn khối upload (`!jobId`) + khối preview (`jobId && items.length`). Bỏ khối tiến độ và bảng kết quả.
4. Toolbar preview: context textarea + `Button ai onClick={createStoryboard}` + `Button outline "Chapter mới"`. Bỏ ô "Nhịp" và nút "Chạy tất cả".
5. Đổi `PageShell title`/`subtitle` + `layout.tsx` description.
6. `npm run lint` + `npx tsc --noEmit` sạch (không còn biến/hàm thừa — lint react-hooks nghiêm, xem [[shadcn-cli4-react-hooks-lint]]).

## Success Criteria

- [ ] Upload ảnh/zip/pdf → lưới band hiện, xoá band chạy đúng (re-index)
- [ ] Nhập context → blur PATCH; "Tạo storyboard" lưu context rồi điều hướng `/storyboard/{id}`
- [ ] `/` không còn ô RPM, "Chạy tất cả", bảng kết quả, Export JSON
- [ ] `tsc --noEmit` + `lint` sạch; không import/biến chết

## Risk Assessment

- **Rủi ro:** cắt nhầm state còn dùng (vd `busy` chia sẻ giữa upload/delete). **Giảm thiểu:** giữ đúng danh sách "Giữ" ở Architecture; chạy `tsc` bắt lỗi tham chiếu.
- **Rủi ro:** mất khả năng sửa nội dung có-cấu-trúc (description/dialogue). **Chấp nhận:** user đã đồng ý — sửa ở narration Storyboard. Không phải hồi quy.
