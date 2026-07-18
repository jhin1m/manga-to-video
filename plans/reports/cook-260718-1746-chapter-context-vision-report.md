# Report: Chapter context cho vision + script (phương án B)

Plan: `plans/260718-1746-chapter-context-vision/plan.md` · Status: DONE

## Đã làm
- `lib/vision.ts`: `buildVisionPrompt(context?)` (export) — context rỗng/trắng → PROMPT y cũ; có context → thêm khối guardrail chống context-bleed. `describeImage(buffer, filename?, context?)`.
- `lib/script.ts`: `buildPrompt(inputs, context?)` (export, khối context trước "Nội dung các khung"), `generateScript(inputs, context?)`, `resolveMissingContent` nhận `opts.context`.
- `lib/jobs.ts`: `Job.context`, `createJob(items, context='')`, `setJobContext`, DTO kèm context. `lib/schema.ts`: `JobStatusDTO.context` (required), `ProjectFile.context?` (optional — không bump PROJECT_VERSION).
- 4 đường vision truyền context: `pipeline.processChapter`, `narration.composeBeat`, `script.resolveMissingContent`, route retry Stage 1. Route script truyền vào cả `generateScript`.
- API: PATCH `/api/jobs/[id]` `{context}` (validate string, cap 4000). Export/import `.mtvproj` persist/hydrate context; `readProject` từ chối context sai kiểu.
- UI `app/page.tsx`: textarea "Nhân vật & bối cảnh chương (tuỳ chọn)" ở màn preview ready; lưu onBlur + await trước Chạy/Tạo storyboard, lưu hỏng → CHẶN hành động (fix theo review).
- Test mới: `verify-script.mts` Test 1b (prompt vision + biên kịch, trim, guardrail, thứ tự khối); `verify-project.mts` (round-trip context, file cũ không field → undefined, sai kiểu → reject).

## Verify
- `pnpm test:unit` PASS (cả 7 file verify) · `pnpm lint` sạch · `next build` pass (typecheck) · e2e-storyboard qua mock vision :3105/:3106 → `E2E_ALL_PASS`.
- Code-reviewer subagent: 9/10, DONE_WITH_CONCERNS — finding 1 (saveContext nuốt lỗi) + finding 2 (comment PATCH mid-run sai) đã fix, lint+build lại sạch; finding 3-4 nit bỏ qua có chủ đích (PATCH thừa vô hại khi chỉ đổi whitespace; vị trí khối context sau phần định dạng JSON là prompt-engineering, có guardrail).

## Không làm (chủ đích)
- Không chaining tuần tự giữa band (phá concurrency + khuếch đại lỗi — quyết định đã chốt với user).
- Không auto-sinh context (primer pass) — YAGNI, nhập tay trước.
- Không re-hydrate textarea ở trang chủ khi mở .mtvproj (trang chủ không có session-restore; context server-side vẫn đúng cho Generate/kịch bản).

## Đề xuất tiếp theo
- Cập nhật `docs/` (system-architecture/codebase-summary) nếu muốn ghi nhận field mới `.mtvproj` + PATCH route — chưa làm trong lượt này.
- Chưa commit — chờ người dùng quyết.

## Unresolved
- Không.
