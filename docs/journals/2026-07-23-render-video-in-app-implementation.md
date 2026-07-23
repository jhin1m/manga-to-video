# Render video in-app tại stage video: 1 nút render server-side, DRY engine CLI↔route

**Date**: 2026-07-23 16:45
**Severity**: Low
**Component**: `content-extractor/` — `lib/render.ts` (mới), route `storyboard/render(/output)`, `app/video/[jobId]/page.tsx`
**Status**: Resolved — plan `260723-1527-render-video-in-app-tai-stage-video` (3 phase) hoàn thành, mọi gate PASS

## What Happened

Thực thi plan 3 phase trong 1 session. Trước đó render MP4 phải: trang video → "Export để render" tải `bundle.zip` → chạy tay `npm run render -- bundle.zip`. Sau: nút **"Render MP4"** ở stage video chạy engine ffmpeg **server-side** đọc thẳng store RAM, stream progress NDJSON theo shot, tự tải `results-<jobId>-<aspect>.zip` (MP4 + .srt + .timeline.json), có **Hủy** (kill ffmpeg) + **lock 1-render/job** (409). Zip export + CLI lùi vào menu "Nâng cao".

Cốt lõi là **DRY refactor**: tách orchestration render (đang inline trong `render-video.mts::main()`) thành `lib/render.ts::renderVideo(input, opts)` **source-agnostic** — CLI dựng `RenderInput` từ `bundle.zip`, route dựng từ store; cùng một engine. Thêm `onProgress` (phát `RenderEvent`) + `AbortSignal` (hủy → kill child ffmpeg). `lib/ffmpeg.ts` nhận `signal?` optional ở param cuối (giữ chữ ký cũ tương thích). Route đọc store dùng chung `lib/storyboard-render-input.ts` (trích từ export-bundle).

## Root Cause / Vì sao "chỉ CLI" là ảo

Engine render vốn ĐÃ là code Node server-side (`ffmpeg.ts`/`kenburns.ts`/`timeline.ts`/`tts.ts` thuần Node). "Chỉ chạy được từ CLI" chỉ vì `render-video.mts` đọc input từ zip còn route thì có store RAM — hai NGUỒN khác nhau, không phải hai ENGINE khác nhau. Tách nguồn ra khỏi orchestration (RenderInput) là đủ để một engine phục vụ cả hai client mỏng.

## Phát hiện ngoài dự kiến

1. **`verify-render.mts` grep stdout.** Test E2E render assert các chuỗi log `cache HIT` / `BGM duck` / `burn-in` / `thiếu filter subtitles`. `fmt(RenderEvent)` phía CLI phải tái tạo đúng các chuỗi này; cảnh báo libass-missing giữ nguyên `console.warn` bên trong `renderVideo` (stderr được `runCli` gộp vào out). Đọc test TRƯỚC khi đổi log là bước then chốt tránh vỡ gate.
2. **`import type` vs bundle client.** Định import `RenderEvent` từ `lib/render.ts` vào page client, nhưng `lib/render.ts` kéo theo sharp/ffmpeg/child_process. Dùng fallback plan đề xuất: khai `RenderLine` cục bộ ở client — không rủi ro leak Node code vào bundle trình duyệt (build cũng xác nhận).
3. **workDir vs outDir tách anh em.** workDir tạm = `.render/<job>-<aspect>-<pid>` (bands/shots), outDir = `.render/<job>-<aspect>` (output + results.zip). Là thư mục ANH EM (không lồng nhau) nên `rm(outDir)` không quét trúng workDir và ngược lại.

## Code Review → Fixes

`code-reviewer` subagent: sạch phần lớn, 7/7 acceptance criteria đạt, 1 lỗi thật:

- **H1 (High) — TOCTOU race ở lock.** `isRendering()` check ở đầu route nhưng `markRendering()` sau 2 `await` (parseForm + collectAudio) → 2 POST đồng thời cùng job cùng lọt qua check → cùng chui vào workDir (cùng pid) → clobber + cascade lock leak. Đây là REGRESSION so với mẫu `script/route.ts` (set cờ đồng bộ TRƯỚC await chính vì lý do này). **Vá:** giữ khóa NGAY sau check trước mọi await + cờ `handedOff`/`finally` gỡ khóa mọi early-return. Verify: 2 POST đồng thời `Promise.all` → đúng 1×200 + 1×409.
- **M1 (Med) — workDir leak khi Cancel/lỗi.** `renderVideo` chỉ `rm(workDir)` ở nhánh thành công. **Vá:** export `renderWorkDir()` (single source of truth cho path), route dọn ở `finally` vòng nền — GIỮ NGUYÊN hành vi CLI (CLI không truyền signal). Verify: workDir dọn sau cả success lẫn Cancel.
- **L3:** `assertSafeName(id)` đầu route (defense-in-depth). L1/L2/L4 là tradeoff/quyết định plan đã chốt → giữ.

## Verification

- `test:render` khớp baseline pre-refactor (9:16 = 6.00s) — bằng chứng engine không đổi hành vi.
- `test:e2e-video` xanh (export-bundle 34 assert không hồi quy sau khi trích helper chung).
- Smoke test route: NDJSON stream, 409, Cancel (`pgrep ffmpeg` → 0 + lock gỡ + workDir dọn), path-traversal 400, thiếu → 404, results.zip đúng 3 file.
- **UI thật (agent-browser):** progress phases "Dựng timeline → Render cảnh i/N", nút Hủy về nghỉ không toast lỗi giả, auto-download, results.zip trên đĩa, GET output 200.
- lint + `tsc --noEmit` + `build` sạch. Không thêm dependency (AdmZip sẵn có).

## Lessons

- Refactor "tách nguồn khỏi orchestration" biến 1 engine thành nhiều client mỏng — rẻ hơn nhiều so với viết engine thứ hai cho server.
- Khi thêm khóa concurrency, **bám mẫu race-free đã có trong repo** (`script/route.ts` set cờ đồng bộ trước await). Reviewer bắt đúng chỗ lệch mẫu — test tuần tự không lộ, phải test `Promise.all` mới thấy.
- AbortSignal threading: param `signal?` optional ở CUỐI mỗi hàm ffmpeg giữ mọi caller cũ chạy nguyên, refactor không vỡ chữ ký.
