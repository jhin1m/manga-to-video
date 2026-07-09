# Code Review — UI unification shadcn + file project .mtvproj

- **Ngày:** 2026-07-08 · **Reviewer:** code-reviewer (read-only, không chạy lệnh)
- **Plan:** `plans/260708-2300-ui-unification-shadcn-project-file/`
- **Scope:** components/* (shell, stepper, project-context, theme-toggle, page-shell, region-cropper), lib/project.ts, app/api/project/{export,import}, app/script/[jobId], 4 trang reskin, lib/schema.ts (+PROJECT_*), lib/bundle.ts (export helpers), scripts/verify-project.mts, e2e-storyboard.mts, globals.css/layout.tsx, package.json
- **Suite (theo đề bài, không tự chạy):** lint/build/test:unit/e2e-storyboard/e2e-script-video/test:render pass, 243 assertions

## Đánh giá chung

Kiến trúc .mtvproj vững: validate tập trung tại `readProject` trước khi đụng store, path-safety qua `assertSafeName` + allowlist regex entry, invariant "không re-ingest" được chứng minh bằng verify-project Test 2 (đổi MAX_EDGE không lệch region). Audio round-trip giữ đúng hợp đồng "text tại thời điểm synth" (tts route chốt `narration.trim()` trước await → export lưu nguyên văn → import `setSegmentAudio` nguyên văn → `collectAudio` so `stored.text !== seg.narration.trim()` hành xử y hệt trước/sau import). Cache HIT: key = basename mp3Path gốc (sha256 text+voice+model), ghi lại đúng `<TTS_CACHE_DIR>/<key>.mp3` + sidecar `{durationSec}` khớp shape `synthSegment` đọc.

Không có finding Critical. 1 High (draft staleness ở storyboard master-detail), 2 Medium.

## Acceptance criteria

| # | Tiêu chí | Kết luận |
|---|----------|----------|
| 1 | 4 trang chung shell + token | **PASS** — chỉ PageShell/AppShell giữ `max-w-*`; variant `ai`/`success` khai báo đúng chuẩn cva + token `--ai`/`--success` cả light/dark. Còn amber-* gõ tay ở cảnh báo script page + contextRegions cropper (chưa có token warning — chấp nhận, xem L8) |
| 2 | Mở phiên bằng 1 file .mtvproj | **PASS** — import không import lib ingest (chỉ jobs/project/storyboard-store); region validate biên tại readProject:137; audio ghi về TTS_CACHE_DIR với key gốc → HIT khi cùng text/voice/model; e2e B2 phủ round-trip + tamper 400 + route cũ 404 |
| 3 | /script route + master-detail + cropper | **PASS có finding** — H1 (draft staleness), M1 (cropper draw ngoài biên) |
| 4 | Stage Video logic không đổi | **PASS (giới hạn xác minh)** — `app/video/` chưa từng commit nên không diff được baseline; xác nhận bằng đọc: buildTimeline/planKenburns/allocateCaptions/synth/export-bundle giữ nguyên luồng Stage 2, chỉ thay control shadcn; container cqw/cqh cho Ken Burns giữ nguyên; test:render + e2e-script-video pass |
| 5 | Public contracts | **PASS** — writeBundle/readBundle logic không đổi (chỉ export thêm assertSafeName/parseEntryJson); SCRIPT/RENDER_CONFIG/MANIFEST/STORYBOARD_VERSION đều 1; xoá 2 route cũ là scope đã chốt (e2e assert 404) |

## Findings

### Critical

Không có.

### High

**H1 — Draft nhịp stale sau khi compose xong: "Lưu nhịp" có thể xoá trắng narration AI vừa generate**
`app/storyboard/[jobId]/page.tsx:162-172` (adjust-state-during-render chỉ nạp lại draft khi `selected.id` đổi) + `refresh()` :83-94.

Luồng chuẩn tái hiện: từ trang Trích xuất bấm "Tạo storyboard" → vào trang khi compose đang chạy → beat đầu auto-select, draft nạp `narration: ''` → compose xong, SSE done → `refresh()` thay `dto` (beats đã có narration) nhưng `draftBeatId` không đổi → textarea vẫn rỗng trong khi list bên trái hiện text mới; `dirtyDraft` = true nên "Lưu nhịp" bật — bấm là PATCH `narration: ''` đè bản AI. Tương tự sau `recreate()`.

Đề xuất: thêm cờ `userTouched` (set trong onChange của textarea/cropper, clear khi nạp draft); trong `refresh()`/`replaceBeat`, nếu `!userTouched` thì đồng bộ draft theo beat mới. KHÔNG reset `draftBeatId` trần trong refresh — PATCH giữa lúc compose vẫn được phép (gap last-write-wins đã ghi nhận từ review Stage 1.5), reset trần sẽ mất text người đang gõ.

### Medium

**M1 — RegionCropper: kéo vẽ vượt mép ảnh bị "tịnh tiến" thay vì cắt — khung phình về phía chưa kéo**
`components/region-cropper.tsx:94-101` (draw) + `clampRegion` :24-30. Pointer capture cho toạ độ ra ngoài ảnh (p.x âm hoặc > width); draw tính `w = |p.x - startX|` rồi clampRegion giữ nguyên w và dời x. Ví dụ: bắt đầu x=50, kéo ra ngoài mép trái tới -100 → w=150, clamp x=0 → khung [0..150] thay vì [0..50] như người dùng thấy mình kéo. Preview hiển thị đúng khung sai này nên user có thể lưu nhầm.

Đề xuất (2 dòng): clamp ngay trong `toWorking` — `x: Math.min(width, Math.max(0, ...))`, tương tự y. Move mode không đổi hành vi (clamp-translate là đúng cho move).

**M2 — readProject: shot.region không được check biên (beat.region thì có), width/height working không check > 0**
`lib/project.ts:143-153` chỉ check `shot.sourceIndex` có ảnh/meta; `:123-128` không validate `w.width/height` là số dương. Comment :61-62 tuyên bố "validate đủ TRƯỚC khi caller đụng store" nhưng file sửa tay/tampered mang shot.region vượt biên (hoặc width=0 → chia 0 ở UI `pct()`) đi qua import sạch sẽ, rồi nổ muộn ở CLI render (sharp extract OOB) với lỗi khó hiểu — đúng loại lỗi "region vượt biên" mà .mtvproj sinh ra để diệt. Threat model: file là artifact chia sẻ được giữa máy/người (tự nhận trong comment lib/bundle.ts:54-56).

Đề xuất: lặp `shot.region` qua cùng check biên như beat (dòng 137), thêm `Number.isInteger && > 0` cho ProjectWorkingMeta/ProjectItemMeta width/height.

### Low

**L1 — Import đặt storyboard phase='done' vô điều kiện** — `app/api/project/import/route.ts:96-101`: project lưu ngay sau banding (mọi beat pending) mở lại sẽ hiện "Hoàn tất 0/N nhịp" và `storyboardDone` mở khoá bước Kịch bản dù chưa có narration; lệch với chính nhánh Stage 1 cùng file (`processed > 0 ? 'done' : 'ready'`, :72). Đề xuất: `phase: doneCount > 0 ? 'done' : 'ready'` cho nhất quán.

**L2 — RegionCropper thiếu onPointerCancel/onLostPointerCapture** — `region-cropper.tsx:160-165`: touch-cancel để `dragRef` + preview treo tới pointer event kế tiếp. Kèm: click (không kéo) trong khung ở move mode luôn bắn `onChange` với region y hệt (draw có ngưỡng 3px, move không) — hiện vô hại vì parent chỉ set draft + so JSON, nhưng là contract noise nếu tái dùng nơi onChange = PATCH. Đề xuất: thêm `onPointerCancel` reset drag; move chỉ onChange khi toạ độ thực sự đổi.

**L3 — Trang Trích xuất không publish dirty khi mutate** — `app/page.tsx` saveEdit/removeItem/retryItem (:240-298) không `publish({ dirty: true })` trong khi storyboard/script/video đều có. Sau lần "Lưu project", sửa nội dung band ở bảng kết quả không bật chấm "chưa lưu". Đề xuất: publish dirty khi mutation thành công.

**L4 — Import ghi cache TTS không atomic** — `import/route.ts:115-120` dùng `writeFile` thường trong khi lib/tts.ts:106-114 cố tình `.tmp → rename` ("cache không bao giờ chứa file ghi dở"). mp3 ghi dở do crash sẽ HIT cache vĩnh viễn (`existsSync`) và không tự lành (sidecar json hỏng thì tự lành qua re-probe, mp3 hỏng thì không). Đề xuất: export `writeAtomic` từ lib/tts và tái dùng.

**L5 — Import hydrate không nguyên tử** — lỗi ném ở đoạn audio (mkdir/writeFile) → 500 nhưng job + storyboard đã vào store (rác in-memory; client không nhận jobId nên không lộ ra UI). Chấp nhận được cho tool local; nếu muốn sạch: try/catch cuối gọi deleteStoryboard + xoá job.

**L6 — Không cap kích thước .mtvproj** — AdmZip inflate toàn bộ vào RAM khi import. Theo threat model (tool local, 1 người dùng, file tự lưu) là chấp nhận được — ghi nhận, không yêu cầu fix.

**L7 — `app/globals.css` thiếu newline cuối file.**

**L8 — Màu amber gõ tay còn ở 2 chỗ có chủ đích** — script page cảnh báo band sót (`app/script/[jobId]/page.tsx:192`), contextRegions cropper (`region-cropper.tsx:171`), chấm dirty (`app-shell.tsx:98`). Token set chưa có `--warning`; chấp nhận, hoặc thêm token warning nếu muốn triệt để AC1.

## Path-safety .mtvproj — kiểm chủ động, XÁC NHẬN AN TOÀN

- `SAFE_NAME /^[\w.-]+$/` + reject `'.'`/`'..'` (lib/bundle.ts:57-64) chặn `/`, `\`, traversal; giá trị nhiều dấu chấm (`...`) vẫn kẹt trong cacheDir vì không chứa separator.
- Mọi giá trị vào path đều qua assertSafeName TRƯỚC khi dùng: jobId (project.ts:74), seg.id (:97), audio segId + key (:173-174). `path.join(cacheDir, key + '.mp3')` không thể thoát cacheDir.
- Entry lạ bị bỏ qua theo allowlist regex (`working/\d+.jpg`, `items/band-\d+.jpg`, `audio/seg-[\w.-]+.mp3`); audio bytes chỉ được dùng khi có meta hợp lệ trong project.json VÀ segId thuộc script (import/route.ts:112). verify-project Test 3–4 phủ đúng các case (traversal jobId/key, entry `../../evil.txt`).
- Export Content-Disposition với jobId: an toàn vì `getStoryboard(jobId)` phải tìm thấy job (id server-generated UUID) trước khi build header.
- Beat `error` round-trip đủ qua toBeat/toStoryboardManifest → import khôi phục status 'error' đúng.

## Pattern repo

Khớp: route `runtime='nodejs'` + params Promise + lỗi NextResponse tiếng Việt; store mutators; `<img>` + eslint-disable; SSE snapshot + poll fallback; comment giải thích bất biến thay vì nhãn plan. Lệch nhỏ: import route gán `state.createdAt` trực tiếp thay vì qua mutator (chấp nhận được — store trả live object, có comment chủ đích).

## Đề xuất hành động (ưu tiên)

1. **H1** — thêm cờ userTouched + đồng bộ draft trong refresh (storyboard page).
2. **M1** — clamp toạ độ pointer trong `toWorking` (region-cropper).
3. **M2** — validate shot.region + width/height dương trong readProject; bổ sung case vào verify-project.mts.
4. L1–L4 gộp một commit dọn nhỏ khi tiện.

## Plan status

Cả 4 phase đã hiện diện trong code + verify-project.mts được wire vào `test:unit`. `plan.md` còn status `pending` và checkbox acceptance chưa tick — lead nên cập nhật sau khi xử lý H1/M1/M2 (không blocker cho các checkbox trừ AC3 nếu tính H1 vào "master-detail" đạt chuẩn).

## Unresolved

- AC4 chỉ xác minh được bằng đọc logic (app/video chưa từng commit → không có baseline diff); tin cậy dựa trên test:render + e2e-script-video pass.
