---
phase: 3
title: "Job outputLanguage and persistence"
status: completed
priority: P1
effort: "3h"
dependencies: [2]
---

# Phase 3: Job outputLanguage and persistence

## Overview
`outputLanguage` đi cùng đường với `context` hiện có: Job → DTO → PATCH → UI → `.mtvproj` → bundle.

## Requirements
- `Job.outputLanguage: OutputLanguage` (`lib/jobs.ts`), `createJob(items, context, outputLanguage = 'vi')`, `setJobOutputLanguage()`.
- `JobStatusDTO.outputLanguage` (`lib/schema.ts`) + `toJobStatusDTO`.
- `PATCH /api/jobs/[id]` nhận `{ context?, outputLanguage? }` — ít nhất 1 field; giá trị lạ → 400 (không normalize im lặng ở API). Cập nhật thông báo lỗi body.
  Cho đổi khi job đang chạy (giống context: task chưa chạy dùng giá trị mới).
- Trang upload `app/page.tsx`: Select ngôn ngữ cạnh textarea ngữ cảnh (shadcn `components/ui/select.tsx`), lưu như `saveContext` (PATCH khi đổi; chặn "Tạo storyboard" nếu lưu hỏng).
  Đổi ngôn ngữ khi storyboard đã có nội dung vision → toast nhắc "nội dung đã đọc vẫn là ngôn ngữ cũ; Generate lại beat nếu cần" (không tự xoá).
- `.mtvproj`: `app/api/project/export/route.ts` ghi `outputLanguage` (chỉ khi ≠ 'vi' cho gọn, như context); import đọc + validate trong `lib/project.ts` (lạ → throw; thiếu → 'vi').
- Bundle CLI (`lib/bundle.ts` + `export-bundle` route + `scripts/render-video.mts`): mang `outputLanguage` để render CLI chọn giọng đúng (Phase 5). Kiểm shape bundle hiện có trước khi thêm; field optional, thiếu = 'vi', KHÔNG bump version nếu reader cũ bỏ qua field lạ được (xác minh khi làm).
- Trang video lấy được ngôn ngữ job (qua DTO storyboard hoặc GET job) để lọc giọng ở Phase 5.

## Related Code Files
- Modify: `lib/jobs.ts`, `lib/schema.ts`, `app/api/jobs/[id]/route.ts`, `app/api/jobs/route.ts` (nếu tạo job nhận field), `app/page.tsx`, `app/api/project/export/route.ts`, `app/api/project/import/route.ts`, `lib/project.ts`, `lib/bundle.ts`, `app/api/jobs/[id]/storyboard/export-bundle/route.ts`, `scripts/render-video.mts`

## Success Criteria
- [x] PATCH đổi ngôn ngữ, GET trả lại đúng; 400 với giá trị lạ.
- [x] Export/import `.mtvproj` giữ ngôn ngữ; project cũ → 'vi'.

## Risk Assessment
Đọc kỹ `node_modules/next/dist/docs/` nếu đụng API route mới (AGENTS.md: Next bản này có breaking change). Chỉ sửa route có sẵn nên rủi ro thấp.
