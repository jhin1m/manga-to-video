# Storyboard/Narration Stage 1.5: Hoàn Tất 5 Phase — Template Narration + SmartStitch Port + Region-Only Manifest

**Date**: 2026-07-06 15:39–2026-07-07 07:30+
**Severity**: High (Stage 2 dependency, 3 code review lỗi HIGH đã xử lý)
**Component**: Manga→Video pipeline: Storyboard (content → Beat + narration + region)
**Status**: Completed (code), Ready for Stage 2 (TTS/video pipeline)

## Sự Kiện Chính

Xây dựng Stage 1.5 từ brainstorm validate (Full) trong một phiên: biến manifest trang tích luỹ từ Stage 1 thành storyboard — chuỗi Beat có `narration` (lời đọc recap 1 giọng) + `region` (band trên ảnh) làm hợp đồng cho Stage 2 TTS/dựng video.

- **Phạm vi**: 5 phase tuyến tính (1→2→3→4→5), hoàn thành tuần tự không lệch.
- **Schema**: `Beat` + `StoryboardManifest v1` (versioned, region-only, không cắt ảnh).
- **Build output**: `lib/schema.ts` · `lib/storyboard-store.ts` · `lib/pdf.ts` · `lib/stitch.ts` (SmartStitch port) · `lib/smart-split.ts` · `lib/narration.ts` (template pre-fill) + 10 API route storyboard + UI `app/storyboard/[jobId]/` + export.
- **Verify gates**: `tsc --noEmit` ✓ · `eslint` ✓ · `next build` ✓ · dev boot ✓ · unit 44 assert ✓ · e2e 58 assert ×2 lượt ✓.

## Sự Thực Khó Khăn

Một phiên, ba sự cố lớn làm tổn thương:

1. **Build vỡ Phase 2: Turbopack bundle `pdf-to-img`**.
   - Lỗi: `pdf-to-img` (pdfjs + `@napi-rs/canvas` native binding) không thể bundle qua Turbopack trong app Next.js.
   - Cảm giác: Phát hiện sau khi 50% port SmartStitch xong, phải roll back, xử lý infra.
   - Fix: Thêm `serverExternalPackages: ['pdf-to-img']` vào `next.config.js` để exempting khỏi bundler.
   - Bài học: **Scout native deps trước port logic, không để phát hiện ở giữa implement.**

2. **Code review phát hiện 3 lỗi HIGH — e2e mock không bắt được**.
   - **H1 (ingest width slice webtoon)**: Webtoon dài (vd 800px wide × 12000px tall) downsample qua smart-split → payload crop region vượt MAX_EDGE (768). Kết quả: vision model nhận 104×1568 (aspect weird, chất lượng tệ), không phát hiện image.
     - Fix: `downscale` nhánh dải dọc kỉ kẹp width < MAX_EDGE (768), tỉ lệ khác trong bounds. Thêm `boundForVision` guard trước mọi vision call.
   - **H2 (race compose ghi đè narration sửa tay)**: Người dùng sửa narration beat → lưu DB (trong-memory) → cùng lúc compose (tính toán beat từ 2A re-extract) chạy → compose ghi đè luôn lần sửa tay.
     - Fix: `rev` counter per-beat (incrementing). Compose khi rev match; sửa tay bump rev → compose bị skip. Retry không apply compose.
   - **H3 (retry pages kẹt content snapshot)**: Retry page → system đọc content từ snapshot tại init (Stage 1) → nếu user sửa tay beat từ trang đó lúc retry bay, nội dung mất hoặc cũ.
     - Fix: `composeBeat` đọc content tươi từ `getJob()` thay snapshot, mỗi lần compose.
   - Cảm giác: Tức giận — e2e mock có thể qua ✓ nhưng những edge case này chỉ phát hiện qua read-thru code. Phải raise 3 fixes, deploy lại.

3. **Dev server phiên cũ giữ lock**. 
   - Tạo phiên mới dev → Next.js port 3000 bị chiếm → restart không được.
   - Fix: `lsof -i :3000` → `kill -9 PID`.
   - Không đáng đặc biệt nhưng mất 5 min debug.

## Chi Tiết Kỹ Thuật

**Phase 1 (Schema & Store):**
- `Beat`: `id`, `narration` (string), `region` (nullable `{x,y,w,h}`), `sourceIndex` (page number), `rev` (counter).
- `StoryboardManifest`: `version: "1.0"`, `title`, `beats[]`, metadata.
- `storyboard-store.ts`: `globalThis.__mrs_storyboard` bus (EventEmitter), thread-safe singleton.

**Phase 2 (Ingest & Banding):**
- **PDF render**: `pdf-to-img` (Node 24, no issues).
- **SmartStitch port** từ `jhin1m/manhwa-sticher` (Rust `lib.rs` → TypeScript):
  - Thuật toán: `find_split_position` tìm 2 chiều → safe-line giữa 2 slice.
  - Settings: `SPLIT_HEIGHT=1600` (default, lệch repo gốc 5000 vì band video phải đọc được sau shrink MAX_EDGE).
  - Test khớp: manual calc từ `lib.rs` (kỳ vọng safe-line pixel-row) với TS output → unit assert per-case.
- **2A strip** (webtoon/PDF only): `describeImage` per-band re-extract → narration mới.

**Phase 3 (Narration):**
- **Không LLM v1** (bỏ `NARRATION_MODEL`, `composeNarration` client): template pre-fill `"${description}\n${dialogue.map(d => d.speaker + ": " + d.text).join('\n')}"`.
- **Manga trang**: dùng content Stage 1 (1 trang = 1 beat, giữ nguyên).
- **Strip**: 2A re-extract, từ `describeImage` per-band.
- **Rev-guard**: mỗi beat có `rev` (increment khi sửa tay). Compose so check rev trước apply.

**Phase 4 (Storyboard UI & API):**
- **10 API route**: `/api/storyboard/{run,jobId/stream,export,items/[i]/image,retry,...}`.
- **10 route kỳ cụ**: `/api/storyboard/run` (start) · `/api/storyboard/[jobId]/stream` (SSE) · `/api/storyboard/[jobId]/retry` · `/api/storyboard/[jobId]/compose` (2A, POST) · `/api/storyboard/[jobId]/export` · `/api/storyboard/[jobId]/items/[i]/image` · PATCH beats · GET beats · import · preview.
- **UI**: `app/storyboard/[jobId]/page.tsx` (list beat + kéo-thả reorder + input narration + drag region, overlay xem band).

**Phase 5 (Export & Verify):**
- **Export**: JSON `StoryboardManifest` + zip ảnh gốc (filtered `__MACOSX`, `.DS_Store`, `._*`).
- **E2E 58 assert** (mock OpenAI `/v1/chat/completions`):
  - Ingest flow (pages/strip/PDF đơn/strip dây dài).
  - Compose 2A (post beat sửa tay).
  - Split/merge/reorder beat.
  - Retry, concurrent edit.
  - Import manifest + ảnh.
  - Export, content-length, format JSON.
  - Mock inject error (5xx, timeout) → graceful degrade.
- **Verify**: ×2 lượt unit + e2e mock (sáng + đêm session).

**Ghi chú scratchpad:**
- Test mock server (`mock-openai-server.ts`) + fixtures (manga samples, webtoon strip) lần này đã vào repo `scripts/` (bài học Stage 1: scratchpad mất).

## Lý Do Sâu Hơn (Root Cause)

- **Turbopack pdf-to-img**: Turbopack mới (Next 16) chưa hỗ trợ caching native deps giống webpack. Phải exempting server-only (rồi build giờ tạo Node layer riêng). Lỡ không scout.
- **3 lỗi High**: E2E mock chỉ cover happy-path + injection errors (401, 5xx). Edge case ingest (aspect tỉ lệ lạ), concurrency (rev-guard), snapshot stale không được mock. Phải thêm unit test per scenario.
- **Rev-guard cần thiết**: Compose là operation lâu (2A re-extract mỗi band) + async → race với sửa tay là bắt buộc (không phải ngoài scope).

## Bài Học

1. **Native deps = scout ngay, deploy đầu**: Không để `pdf-to-img` đến Phase 3. Verify build Phase 1 nếu cần external package.
2. **Mock test ≠ thorough test**: E2E mock qua ✓ nhưng edge case (downscale ratio, race edit, stale snapshot) phải unit test riêng. Thêm integration grid: source-kind (page/strip/PDF) × action (ingest/compose/retry/export).
3. **Concurrency = rev-guard bắt buộc**: Async compose + manual edit trên cùng resource → revision counter, không phải tùy chọn.
4. **Test artifact storage**: Lần 1 (Stage 1) để ở scratchpad → mất. Lần 2 (Stage 1.5) vào repo `scripts/` + npm scripts — lâu dài hơn, phục hồi được.
5. **Webtoon dimension quirks**: Aspect tỉ lệ dây dài + smart-split → downscale dimension có thể lạ. Ghi chú: `boundForVision` là gate cuối, luôn kiểm trước vision call.

## Tiếp Theo

- **Chưa commit**: Working tree sạch (toàn `?? content-extractor/`, `?? docs/`, `?? plans/`). User quyết định thời điểm commit.
- **Stage 2 (TTS/Video)**:
  - Nhận `StoryboardManifest` + zip ảnh.
  - Thực thi TTS mỗi beat.
  - Dựng video Ken Burns per-region.
  - Compose soundtrack + SFX.
  - Export mp4.
- **Known limitations chuyển tiếp** (ghi nhận v1, giải quyết v2+):
  - Split beat trang: retry cả 2 nửa → cùng narration full-page (compose pages không áp region).
  - Manifest v1 thiếu metadata bộ ảnh (filename, dims) → import nhầm bộ cùng số trang khó bắt.
  - Memory: canvas strip dài decode raw toàn phần khi smart-split (dev tool chấp nhận, ghi chú).
  - PDF trong zip bị bỏ qua (chỉ PDF upload trực tiếp).
  - Kéo-thả handle chỉnh band chưa có (overlay chọn + input số x/y/w/h, phương án plan đã duyệt).

---

**Status**: DONE
**Summary**: Build Stage 1.5 (5 phase, 1 phiên) xong: schema Beat/StoryboardManifest + pdf-to-img + SmartStitch port (TS/sharp) + template narration (không LLM) + 2A strip re-extract + 10 API route + UI storyboard/[jobId] + export; 3 High lỗi (width-slice downscale, rev-guard race, snapshot-stale) đã fix qua unit; e2e 58 assert ×2 ✓; chứng cứ vào repo `scripts/`.
