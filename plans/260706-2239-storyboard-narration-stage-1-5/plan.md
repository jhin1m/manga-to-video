---
title: "Storyboard / Narration (Stage 1.5)"
description: "Biến manifest trích xuất theo trang (Stage 1) thành storyboard: chuỗi Beat có lời đọc recap 1 giọng + vùng hình (band) — hợp đồng cho Stage 2 TTS/video."
status: completed
priority: P2
branch: "main"
tags: ["nextjs", "vision-llm", "internal-tool", "manga-pipeline", "storyboard", "tts"]
blockedBy: []
blocks: []
created: "2026-07-06T15:39:41.790Z"
createdBy: "ck:plan"
source: skill
---

# Storyboard / Narration (Stage 1.5)

## Overview

Thêm **stage "Storyboard"** vào app `content-extractor/` (Next.js hiện tại). Nhận đầu ra Stage 1
(manifest trang: `description` + `dialogue[]` + `note`) → sinh chuỗi **Beat (nhịp)** có `narration`
(lời đọc recap 1 giọng, tiếng Việt) gắn với **region (band)** trên ảnh trang → sửa tay → export
`StoryboardManifest` versioned làm hợp đồng cho Stage 2 (TTS + dựng video Ken Burns).

Giải quyết 2 nỗi đau gốc: (a) "không biết đọc phần nào" → `narration` là **một** dòng text đã ghép;
(b) "ảnh không liên kết nội dung" → `region` trỏ chính xác vùng hình cho từng lời.

Nguồn: manga trang rời · manhua · manhwa/webtoon dải dọc · **PDF dài**. Giữ triết lý Stage 1:
KISS, ENV-driven, in-memory (export JSON là bản lưu), no DB/auth/queue.

Report brainstorm: [`docs/brainstorms/2026-07-06-stage-1.5-storyboard-narration.md`](../../docs/brainstorms/2026-07-06-stage-1.5-storyboard-narration.md)

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Schema & Store](./phase-01-schema-store.md) | Completed |
| 2 | [Ingest & Banding](./phase-02-ingest-banding.md) | Completed |
| 3 | [Narration Pipeline](./phase-03-narration-pipeline.md) | Completed |
| 4 | [Storyboard UI & API](./phase-04-storyboard-ui-api.md) | Completed |
| 5 | [Export & Verify](./phase-05-export-verify.md) | Completed |

## Locked decisions (brainstorm + validate — không re-research)

- Kiểu video: **thuyết minh 1 giọng (recap)**, thoại lồng dạng trích.
- Đơn vị hình: **region/band trên ảnh làm việc**, không cắt ảnh vật lý (`region:{x,y,w,h}|null`). Manifest **region-only** — hướng pan/zoom để Stage 2 tự suy.
- Vị trí tool: **stage mới trong app Next hiện tại**, tiếp session (ảnh còn RAM) + đường nạp lại từ manifest.
- **Cắt band = port thuật toán SmartStitch** từ repo của user [`jhin1m/manhwa-sticher`](https://github.com/jhin1m/manhwa-sticher) (Rust, MIT) sang TS/sharp qua **`/ck:xia`** — tìm safe-line hai chiều, né bubble/SFX. Model **KHÔNG xuất toạ độ pixel**.
- **Stitch chỉ cho webtoon/PDF dải dọc** (gộp slices → 1 canvas → smart-split); manga trang rời **giữ trang** (cả-trang = 1 nhịp).
- Nội dung↔band **hybrid theo nguồn**: strip → **2A** (crop band → re-extract vision `describeImage`); manga trang → dùng lại content Stage 1.
- **Narration v1 = template pre-fill + sửa tay, KHÔNG dùng LLM** (mô tả + "X nói: <thoại>"). Nút "LLM chau chuốt" để dành cho sau (ngoài scope v1).
- **Lib PDF→ảnh: `pdf-to-img`** (pdfjs + `@napi-rs/canvas`) — verify build lúc Phase 2.

## Scope boundary

- **Trong scope:** tới file `StoryboardManifest` (beats + narration + region), sửa tay, export.
- **Ngoài scope (Stage 2):** TTS thật · dựng video Ken Burns · nhạc/hiệu ứng · multi-voice · xuất mp4.

## Acceptance (toàn plan)

- [x] Nạp storyboard từ session Stage 1 **và** từ upload lại (manifest JSON + ảnh).
- [x] PDF dài render ra ảnh trang, vào pipeline.
- [x] Webtoon/PDF → stitch + smart-split (SmartStitch port) đề xuất band né bubble; người kéo chỉnh được.
- [x] Mỗi Beat có `narration` (template + sửa tay) + `region` + `sourceIndex` hợp lệ.
- [x] Manga trang chạy cả-trang=1-nhịp; webtoon/PDF chạy 2A (re-extract per band).
- [x] Export `StoryboardManifest` đúng shape, versioned.
- [x] Gates: `tsc --noEmit` · `lint` · `build` · dev boot · e2e mock.

## Top risks (chi tiết trong từng phase)

- **PDF renderer native-dep**: chọn lib render ổn trên Node 24 (ưu tiên pure-JS/wasm). → verify Phase 2.
- **Port SmartStitch lệch hành vi / safe-line sai trên nền phức tạp**: test đối chiếu repo gốc + ngưỡng chỉnh được + chỉnh tay là chốt chặn. → Phase 2.
- **2A tốn nhiều lượt vision**: `p-limit` + chỉ áp cho dải dọc. → Phase 3.
- **In-memory mất khi restart**: export là bản lưu + đường nạp lại. → Phase 1/4.

## Dependencies

Linear 1→2→3→4→5. Kế thừa Stage 1 (`plans/260706-1405-content-extractor`, đã `completed` — không blocking).
Không có plan đang chạy nào chồng lấn. Downstream Stage 2 (TTS/video) sẽ tiêu thụ `StoryboardManifest`.

## Môi trường

Node **24** (Herd nvm — `nvm use 24` trước mọi lệnh). App tại `./content-extractor/`, git root = repo root.

## Validation Log

### Session 1 (2026-07-06, `/ck:plan validate`)

**Verification (tier Full, 5 phase) — claims vs codebase:**
- VERIFIED: `lib/{jobs,pipeline,schema,vision}.ts` tồn tại; `jobs.ts` = EventEmitter bus trên `globalThis` (`__mrs_bus`); `pipeline.ts` = AdmZip+sharp+pLimit+natural-sort; API nest `app/api/jobs/[id]/**` (8 route: `export`, `items/[i]/image`, `retry`, `stream`, `run`…). Sharp `extract/raw/greyscale` khả dụng (sharp 0.35).
- CORRECTION (Phase 3): `withRetry`/`createCompletion` trong `vision.ts` là **private** → nếu tái dùng phải export, hoặc dùng thẳng `describeImage` (đã export). Không dùng client thô nữa (narration v1 bỏ LLM).
- UNVERIFIED: mock server e2e Stage 1 nằm ở scratchpad session cũ (đã mất) → Phase 5 dựng lại.
- Failed: 0.

**Quyết định chốt (5 câu hỏi qua 2 lượt):**
1. PDF lib → **`pdf-to-img`** (verify build Phase 2).
2. Banding → **port SmartStitch** từ `jhin1m/manhwa-sticher` (Rust→TS/sharp) qua `/ck:xia`, thay heuristic tự viết. Thuật toán: `find_split_position` tìm 2 chiều tới safe-line, `min_distance=40% split_height`, settings `split_height`/`scan_line_step`/pixel-diff tolerance (xem `src-tauri/src/lib.rs`, `ALGORITHM_IMPROVEMENTS.md`).
3. Narration → **template pre-fill + sửa tay, KHÔNG LLM** (bỏ `NARRATION_MODEL`/composeNarration LLM khỏi v1).
4. Manifest → **region-only**, Stage 2 tự suy pan/zoom.
5. Stitch scope → **chỉ webtoon + PDF dải dọc**; manga trang rời giữ trang.

**Propagate:** Phase 2 (stitch+smart-split port), Phase 3 (bỏ LLM, template), plan locked-decisions/acceptance đã cập nhật.

**Whole-plan consistency sweep:** rà `plan.md` + 5 phase — không còn tham chiếu "LLM soạn narration"/"heuristic gutter tự viết"/"2B LLM chia nhịp" mâu thuẫn. 0 mâu thuẫn tồn đọng.

**Khuyến nghị:** proceed to implement (Failed: 0).
