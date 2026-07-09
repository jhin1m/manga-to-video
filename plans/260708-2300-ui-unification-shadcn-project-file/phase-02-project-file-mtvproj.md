---
phase: 2
title: "Project File mtvproj"
status: completed
priority: P1
effort: ""
dependencies: [1]
---

# Phase 2: Project File (.mtvproj)

## Overview

Thay "Nạp lại storyboard từ manifest + ảnh" (fragile, re-ingest, phụ thuộc env) bằng **1 file project `.mtvproj`** (zip) chứa cả data + ảnh working + audio. Mở lại = giải nén → hydrate store, **không re-ingest, không phụ thuộc env, toạ độ region khớp 100%**. Gộp thành cặp nút **Lưu project / Mở project** trên top bar; giữ nguyên `bundle.zip` cho CLI render.

## Requirements

- Functional:
  - `GET /api/project/export?jobId=...` → stream `.mtvproj` (zip) gồm mọi state hiện có của job.
  - `POST /api/project/import` (multipart 1 file `.mtvproj`) → hydrate Job + Storyboard + Script + Audio → trả `{ jobId }` → điều hướng tới stage phù hợp (storyboard, hoặc script/video nếu đã có).
  - Nút "Lưu project"/"Mở project" ở top bar (Phase 1 đã đặt stub) nối vào 2 endpoint này.
  - Gỡ cặp export/import storyboard JSON cũ.
- Non-functional: chống path-traversal; versioned; audio mp3 tái tạo về `TTS_CACHE_DIR` đúng để CLI/preview tái dùng; không đổi `bundle.zip`.

## Architecture

- **Định dạng `.mtvproj`** (zip, tái dùng khuôn `lib/bundle.ts` + `assertSafeName`):
  ```
  project.json          # { version: PROJECT_VERSION, jobId, createdAt, sourceKind, has: {manifest,script,config,audio,bgm} }
  manifest.json         # (tuỳ) Manifest Stage 1 — toManifest(job)
  storyboard.json       # StoryboardManifest — toStoryboardManifest(...)
  script.json           # (tuỳ) ScriptManifest — toScriptManifest(...) + confirmed flag
  render-config.json    # (tuỳ) RenderConfig
  working/<sourceIndex>.jpg  # ảnh working storyboard (strip=canvas, pages=trang) — buffer từ WorkingImage
  items/band-<index>.jpg     # (tuỳ) ảnh band Job Stage 1 (StoredItem.buffer) để rehydrate lưới/bảng Stage 1
  audio/seg-<segId>.mp3      # (tuỳ) SegmentAudio — đọc bytes từ mp3Path
  bgm/<file>            # (tuỳ) nếu có
  ```
  - **Quyết định (KISS):** embed thẳng ảnh working + items → import KHÔNG gọi `ingestBandItems`/`stitchSlices` lại (không phụ thuộc `MAX_EDGE`/`SPLIT_HEIGHT`, khớp toạ độ tuyệt đối). Pages: `working/<i>.jpg` == `items/band-<i>.jpg` về nội dung → được phép trùng để giữ đơn giản (tool nội bộ, dung lượng không phải ràng buộc).
  - `project.json.version = PROJECT_VERSION` (mới, thêm vào `lib/schema.ts`). Import từ chối version lệch.
- **`lib/project.ts`** (mới): `writeProject(data): Buffer` + `readProject(buf): ProjectData`. Tái dùng `AdmZip` + `assertSafeName` (cân nhắc export `assertSafeName`/`parseEntryJson` từ `lib/bundle.ts` để DRY thay vì copy).
  - `ProjectData`: `{ project, manifest?, storyboard, script?, config?, working: Map<number,Buffer>, items?: Map<number,Buffer>, audio?: Map<string,{buffer,durationSec,text}>, bgm? }`.
  - **Audio nuance:** `SegmentAudio = { mp3Path, durationSec, text }` trỏ file đĩa. Export phải đọc bytes từ `mp3Path` (bỏ qua nếu file đã bị dọn). `audio/seg-<id>.mp3` cần kèm `durationSec` + `text` → lưu trong `script.json` (một map `audioMeta: { [segId]: { durationSec, text } }`) hoặc `project.json`. Import ghi mp3 vào `TTS_CACHE_DIR` và set `mp3Path` mới → preview/CLI tái dùng cache.
- **Export route** `app/api/project/export/route.ts` (`runtime=nodejs`): đọc `getJob(jobId)` + `getStoryboard(jobId)`; gom working buffers (`state.working`), items (`job.items`), script (`getScript`+`scriptConfirmed`), ttsAudio (đọc từng `mp3Path`), bgm nếu lưu; `writeProject(...)`; trả zip attachment `project-<jobId>.mtvproj`.
- **Import route** `app/api/project/import/route.ts` (`runtime=nodejs`): `readProject(buf)` → `createJob(items)` (band Stage 1; nếu không có items thì dựng từ working) → `createStoryboard({ jobId: job.id, sourceKind, working, beats })` → nếu có script: `setScript` + `setScriptConfirmed` → nếu có audio: ghi cache + `setSegmentAudio` → `updateStoryboardProgress(phase:'done')` → trả `toStoryboardDTO`. Không có compose chạy nền. Không phụ thuộc env.
- **Top bar wiring (Phase 1 stub → thật):** "Lưu project" gọi export (blob download); "Mở project" mở file picker `.mtvproj` → POST import → `router.push` tới `/storyboard/{jobId}` (hoặc `/script`/`/video` theo trạng thái). Cập nhật `project-context` dirty=false sau lưu.

## Related Code Files

- Create: `lib/project.ts`, `app/api/project/export/route.ts`, `app/api/project/import/route.ts`, `scripts/verify-project.mts`.
- Modify: `lib/schema.ts` (thêm `PROJECT_VERSION` + interface `ProjectFile`), `lib/bundle.ts` (export `assertSafeName`/`parseEntryJson` để DRY — không đổi hành vi bundle), `components/app-shell.tsx` (nối handler Lưu/Mở), `components/project-context.tsx` (dirty flag), `README.md` (mục Luồng sử dụng: thay reload bằng .mtvproj), `package.json` (script `test:project` nếu muốn).
- Delete: `app/api/storyboard/import/route.ts`; nút "Export storyboard" + route `app/api/jobs/[id]/storyboard/export/route.ts` (thay bằng project). Giữ Stage 1 `/api/jobs/[id]/export` (manifest JSON) như export dữ liệu nhẹ.

## Implementation Steps

1. Thêm `PROJECT_VERSION` + kiểu `ProjectFile`/audio-meta vào `lib/schema.ts`.
2. Refactor nhẹ `lib/bundle.ts`: export `assertSafeName` + `parseEntryJson` (giữ nguyên logic bundle).
3. Viết `lib/project.ts` (`writeProject`/`readProject`) + validate version + path-safety + kiểm mọi `shot/beat.sourceIndex` có ảnh working tương ứng (mẫu `readBundle`).
4. Viết export route (đọc mp3 từ `mp3Path`, bỏ qua file đã dọn, cảnh báo mềm).
5. Viết import route (hydrate Job/Storyboard/Script/Audio; ghi mp3 về `TTS_CACHE_DIR`).
6. Nối top bar Lưu/Mở project + điều hướng theo trạng thái + dirty flag.
7. Gỡ `/api/storyboard/import` + storyboard export route + block `<details>` reload trong `app/page.tsx` (đầy đủ ở phase 3, nhưng gỡ block reload ở đây để tránh 2 lối).
8. Viết `scripts/verify-project.mts`: round-trip export→import trên fixture (strip + pages, có/không script, có/không audio) → assert beats/region/script/confirmed/audio khớp; assert KHÔNG gọi ingest lại (kiểm bằng toạ độ region giữ nguyên khi đổi env `MAX_EDGE`).
9. `npm run build` + `npm run lint` + chạy `verify-project.mts` + `npm run test:unit`.

## Success Criteria

- [x] Export tạo `project-<jobId>.mtvproj`; import mở lại đúng job ở stage phù hợp, KHÔNG cần chọn ảnh rời.
- [x] Region/beat/script/confirmed/audio khớp sau round-trip; đổi `MAX_EDGE` khi import vẫn khớp toạ độ (không re-ingest).
- [x] Audio synth đã lưu tái dùng được sau import (cache hit, không gọi ElevenLabs).
- [x] Route/nút storyboard-JSON import/export cũ đã gỡ; `bundle.zip` không đổi.
- [x] `verify-project.mts` + `test:unit` pass.

## Risk Assessment

- Audio path portability: nếu quên ghi mp3 về cache + set `mp3Path`, CLI/preview miss cache → xử lý ở bước 5, cover ở verify.
- Đồng bộ bất biến Stage 2: import phải giữ `SegmentAudio.text` gốc để logic loại audio-cũ (khi narration đổi) vẫn đúng.
- DRY bundle: khi export `assertSafeName`/`parseEntryJson`, chạy lại verify-render để chắc bundle không vỡ.
- Xoá route cũ có thể còn link/nút tham chiếu → grep sạch trước khi xoá.
