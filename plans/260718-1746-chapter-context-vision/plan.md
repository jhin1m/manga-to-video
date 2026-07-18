# Chapter context cho vision + script (phương án B)

Status: done (2026-07-18) · Branch: main · Single-phase
Verified: test:unit PASS · lint PASS · next build PASS · e2e-storyboard E2E_ALL_PASS · code-review 9/10 (2 finding minor/nit đã fix)

## Mục tiêu
Khối ngữ cảnh tĩnh cấp chương (nhân vật/xưng hô/bối cảnh, người dùng nhập) tiêm GIỐNG NHAU vào mọi call vision Stage 1 + prompt biên kịch Stage 2. Không đổi kiến trúc concurrency (Promise.all + p-limit + pacer). Context rỗng = hành vi y cũ.

## Acceptance criteria
1. `buildVisionPrompt('')`/undefined → đúng PROMPT cũ; có context → PROMPT + khối guardrail (chỉ dùng gọi tên/xưng hô, cấm mô tả thứ không có trong ảnh).
2. Mọi đường gọi vision dùng context của job: processChapter, composeBeat (generate/retry beat), resolveMissingContent, retry route Stage 1.
3. `generateScript(inputs, context)` chèn cùng khối context vào prompt biên kịch; route script đọc context từ job.
4. UI: textarea "Nhân vật & bối cảnh chương (tuỳ chọn)" ở màn preview ready, lưu qua PATCH `/api/jobs/[id]`; giá trị hiện lại từ `JobStatusDTO.context`.
5. `.mtvproj` round-trip: export ghi `project.context` (khi không rỗng), import hydrate lại vào job; file cũ không có field mở bình thường (không bump PROJECT_VERSION).
6. `pnpm test:unit` + `lint` + `build` sạch; test mới cho prompt-with-context và project round-trip.

## Files
- `lib/vision.ts` — export `buildVisionPrompt(context?)`; `describeImage(buffer, filename?, context?)`.
- `lib/script.ts` — export `buildPrompt(inputs, context?)`; `generateScript(inputs, context?)`; `resolveMissingContent` opts.context.
- `lib/jobs.ts` — `Job.context`, `createJob(items, context?)`, `setJobContext`, DTO kèm context.
- `lib/schema.ts` — `JobStatusDTO.context`, `ProjectFile.context?`.
- `lib/pipeline.ts`, `lib/narration.ts` — truyền context xuống describeImage.
- `app/api/jobs/[id]/route.ts` — thêm PATCH {context} (cap độ dài).
- `app/api/jobs/[id]/items/[i]/retry/route.ts`, `app/api/jobs/[id]/storyboard/script/route.ts` — truyền context.
- `app/api/project/export/route.ts`, `app/api/project/import/route.ts` — persist/hydrate context.
- `app/page.tsx` — textarea + PATCH on blur.
- `scripts/verify-script.mts`, `scripts/verify-project.mts` — test mới.

## Risks / rollback
- Context bleed → guardrail wording; đổi context giữa chừng không invalidate kết quả cũ (chấp nhận, người dùng tự chạy lại).
- Rollback: revert commit — không có migration, không đổi version file.
