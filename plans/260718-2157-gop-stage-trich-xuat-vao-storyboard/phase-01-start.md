---
title: "Phase 1: Backend — Generate all batch vision"
status: done
priority: P1
dependencies: []
---

# Phase 1: Backend — Generate all batch vision

## Overview

Thêm khả năng chạy vision hàng loạt cho **mọi beat** ngay trong Storyboard (thay batch của Stage 1).
Phase này **thuần additive** — không đụng UI, không xoá gì; test cũ vẫn xanh sau phase.

## Requirements

- Functional: một endpoint batch chạy `describeImage` cho tất cả beat cần nội dung, có pacing RPM +
  concurrency, tiến độ phát qua SSE `sb:{jobId}` sẵn có.
- Functional: fresh storyboard (job không có content Stage 1) → beats ở trạng thái `pending` **sạch**,
  KHÔNG bị set `error: "Nội dung trống"`.
- Non-functional: DRY — tái dùng `composeBeat`, `composeStoryboard`, `createPacer`, progress/bus hiện có.
  Beat người dùng đã sửa tay không bị đè (rev-guard sẵn có trong `composeBeat`).

## Architecture

<!-- Updated: Validation Session 1 - persist SceneContent vào working.content (chống double-vision ở bước Kịch bản) -->

Điểm mấu chốt: `composeBeat(jobId, beatId, {vision:true})` đã crop vùng nhịp → `describeImage` →
`fillNarration`. Chỉ cần một vòng batch gọi nó cho các beat pending/error, có pacer.

**QUAN TRỌNG (từ validation):** Bước Kịch bản (`storyboard/script/route.ts`) đọc `content`
(SceneContent), KHÔNG đọc `beat.narration`; content thiếu thì `resolveMissingContent` (`lib/script.ts:99`)
**chạy lại vision, KHÔNG cache**. Nếu Generate-all chỉ ghi `narration`, Kịch bản sẽ chạy vision **lần 2**
cho cả chương (và lặp mỗi lần regen). → `composeBeat` (nhánh vision) phải **ghi `scene` vào
`working.content`** để Kịch bản reuse (`inputs.content = item.content ?? working.content`) → 0 band
missing → `resolveMissingContent` no-op. `resolveMissingContent` GIỮ nguyên làm fallback cho nhịp chưa
Generate (user bỏ qua Generate-all vẫn ra script — không thêm gate, xem plan Q4).

- Mở rộng `composeStoryboard(jobId, opts)` thêm `opts.vision?: boolean`:
  - khi `vision` → gọi `composeBeat(jobId, beat.id, {vision:true})` và **luôn pace** (`minIntervalMs`),
    lọc beat `status === 'pending' || status === 'error'`.
  - khi không `vision` (đường cũ) → giữ nguyên hành vi template hiện tại.
- Sửa `buildAndCompose` (route `storyboard/route.ts`): sau `setBeats(skeleton)`, **chỉ** template-compose
  khi job có ít nhất một item `content != null`; nếu không có content nào → **bỏ** compose, set progress
  `phase:'done'` (không có gì để soạn) để trang không kẹt "processing" và beats giữ `pending` sạch.
- Route mới `POST /api/jobs/[id]/storyboard/generate` (mẫu `jobs/[id]/run/route.ts`):
  - đọc `{rpm?}`, resolve theo `readVisionConfig().rpm` + kẹp `MAX_RPM`, `minIntervalMs = ceil(60000/rpm)`.
  - `readVisionConfig()` để fail sớm 400 nếu thiếu key.
  - 409 nếu `progress.phase` đang `queued|processing`.
  - `updateStoryboardProgress(id,{phase:'queued'})` đồng bộ, rồi fire-and-forget
    `composeStoryboard(id,{concurrency, minIntervalMs, vision:true})`.
- Sửa message lỗi empty-narration trong `composeBeat` (narration.ts): bỏ chữ "chạy trích xuất Stage 1"
  → `"Nội dung trống — bấm Generate hoặc tự điền narration."` (Stage 1 không còn tồn tại).
- Thêm store mutator `setWorkingContent(jobId, sourceIndex, content)` trong `storyboard-store.ts`;
  `composeBeat` gọi khi vision trả `scene` != null (chỉ khi `untouched()`), trước/cùng `setBeatResult`.

## Related Code Files

- Modify: `content-extractor/lib/narration.ts` — `composeStoryboard` (+`vision` opt, pace-khi-vision, filter pending|error); sửa message lỗi + persist `working.content` trong `composeBeat`.
- Modify: `content-extractor/lib/storyboard-store.ts` — thêm `setWorkingContent(jobId, sourceIndex, content)` (ghi `w.content` cho working khớp sourceIndex).
- Modify: `content-extractor/app/api/jobs/[id]/storyboard/route.ts` — `buildAndCompose` skip template khi không có content.
- Create: `content-extractor/app/api/jobs/[id]/storyboard/generate/route.ts` — batch vision route.
- Reference (không sửa): `lib/pipeline.ts` (`createPacer`), `lib/vision.ts` (`readVisionConfig`), `lib/script.ts` (`resolveMissingContent` — fallback giữ nguyên).

## Implementation Steps

1. `storyboard-store.ts`: thêm `setWorkingContent(jobId, sourceIndex, content)` — tìm `w.sourceIndex===sourceIndex` gán `w.content = content`.
2. `composeBeat` (nhánh vision, sau `describeImage` cho `scene`, khi `untouched()` và `scene`): gọi `setWorkingContent(jobId, beat.sourceIndex, scene)` rồi `setBeatResult`. Sửa chuỗi lỗi empty-narration.
3. `composeStoryboard`: thêm param `opts.vision`. Trong map, khi `vision` gọi `composeBeat(jobId, beat.id, {vision:true})`, filter `b.status === 'pending' || b.status === 'error'`; pacer bật khi `vision || sourceKind==='strip'`.
4. `buildAndCompose`: `const hasContent = job.items.some(it => it.content != null)`. Nếu `!hasContent` → sau `setBeats`, `updateStoryboardProgress(jobId,{phase:'done',currentIndex:null})` và return (không gọi `composeStoryboard`). Nếu có → giữ như cũ.
5. Tạo `storyboard/generate/route.ts` copy khung từ `run/route.ts` (resolveRpm/MAX_RPM/readVisionConfig/409), gọi `composeStoryboard(id,{concurrency:config.concurrency, minIntervalMs, vision:true})`, trả `toStoryboardDTO(getStoryboard(id)!)`.

## Success Criteria

- [ ] `POST /storyboard/generate` trên job không content → mọi beat có `narration` (mock vision), `phase:'done'`
- [ ] Sau Generate-all, `working.content` được set cho các beat → bước Kịch bản `resolveMissingContent` thấy 0 missing (KHÔNG chạy vision lần 2)
- [ ] Beat đã `status:'done'` (sửa tay) KHÔNG bị đổi bởi Generate-all
- [ ] Fresh storyboard (no content) sau tạo → beats `pending`, `progress.phase:'done'`, KHÔNG error
- [ ] `readVisionConfig` lỗi → route trả 400 message rõ; đang chạy → 409
- [ ] `npm run test:unit` + `npm run test:e2e` (bản cũ) vẫn xanh — phase additive

## Risk Assessment

- **Rủi ro:** thay đổi filter/logic `composeStoryboard` làm hồi quy đường template cũ (import/pages-có-content).
  **Giảm thiểu:** nhánh `vision` tách hẳn; đường cũ giữ nguyên chữ ký khi `vision` falsy. E2E cũ còn chạy để bắt hồi quy trước khi Phase 5 viết lại.
- **Rủi ro:** Generate-all đè beat vừa sửa nếu race. **Giảm thiểu:** rev-guard `untouched()` trong `composeBeat` đã xử lý; filter loại beat `done`.
