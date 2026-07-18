---
title: "Phase 5: Tests + docs"
status: done
priority: P1
dependencies: [1, 2, 3, 4]
---

# Phase 5: Tests + docs

## Overview

Viết lại E2E theo luồng gộp (không còn `/run`), kiểm `.mtvproj` round-trip khi `content=null`, cập nhật
README/metadata mô tả pipeline 3 stage.

## Requirements

- `npm run test:unit` + `npm run test:e2e` xanh với luồng mới.
- README + docs không còn mô tả màn Trích xuất như stage riêng; nêu "Generate all" trong Storyboard.

## Architecture

<!-- Updated: Validation Session 1 - viết lại CẢ e2e-script-video (dùng /run:87); verify-project không cần đổi -->

### E2E — **cả hai** file (validation: `/run` bị 2 test gọi)
**`scripts/e2e-storyboard.mts`** (2 call `/run` tại line ~163 và ~439):
- Khối A: upload → `POST /run` → `POST /storyboard` → check narration từ content. **Viết lại:** upload →
  `POST /storyboard` (beats pending) → `POST /storyboard/generate` (mock vision, rpm 600) → check mọi beat có
  `MOCK_NARRATION`; sửa 1 beat tay → `generate` lại → beat đã sửa giữ nguyên.
- Call `/run` thứ 2 (~439): thay bằng `/storyboard/generate` tương ứng ngữ cảnh khối đó.
- Giữ assert: band lỗi cô lập, edit/PATCH beat, reorder, storyboard export cũ 404. **Thêm:** `/run`→404, `/export`→404.

**`scripts/e2e-script-video.mts`** (call `/run` tại line 87):
- Thay `POST /run {rpm:600}` bằng: `POST /storyboard` → `POST /storyboard/generate {rpm:600}` (mock vision fill
  narration + `working.content`) → tiếp `/script` → video như cũ.
- **Assert mới (decision cache content):** sau generate-all, tạo `/script` → mock `describeImage` KHÔNG bị gọi
  thêm (content reuse từ `working.content`). Nếu khó đếm call mock, tối thiểu assert script tạo được không lỗi.

### verify-* (`scripts/verify-narration.mts`, `verify-project.mts`)
- `verify-narration`: giữ case template-mode (`vision` falsy). Thêm case `vision:true` + assert `working.content`
  được set sau compose (mock `describeImage`) — phủ decision cache content ở đơn vị, rẻ hơn E2E.
- `verify-project`: **KHÔNG cần đổi** — test tự dựng fixture manifest (content non-null ở index 0, null ở index 1,
  `verify-project.mts:66-67`), kiểm serialization round-trip, KHÔNG phụ thuộc luồng live. Chạy để xác nhận vẫn xanh.

### Docs
- `README.md`: mục "ba stage" → **hai stage phía trước** (Nhận chapter + Storyboard) + Kịch bản + Video.
  Xoá "Luồng sử dụng (Stage 1)" batch; mô tả Storyboard có "Generate all" (batch vision, RPM) + per-beat Generate.
  Giữ bảng ENV ingest/vision (vision vẫn dùng, chỉ đổi nơi kích hoạt).
- `app/layout.tsx`: metadata (đã sửa ở Phase 2 — xác nhận).
- `content-extractor/AGENTS.md`: không liên quan (chỉ note Next.js) — bỏ qua.

## Related Code Files

- Modify: `content-extractor/scripts/e2e-storyboard.mts` — 2 call `/run` → generate-all; assert route cũ 404.
- Modify: `content-extractor/scripts/e2e-script-video.mts` — call `/run:87` → storyboard+generate-all; assert content reuse.
- Modify (nếu cần): `content-extractor/scripts/verify-narration.mts` — case vision batch + assert `working.content` set.
- Verify (không đổi): `content-extractor/scripts/verify-project.mts` — chạy để xác nhận vẫn xanh (fixture riêng).
- Modify: `content-extractor/README.md` — mô tả pipeline mới.
- Verify: `content-extractor/app/layout.tsx` (đã sửa Phase 2).

## Implementation Steps

1. Chạy env test (xem [[next16-e2e-next-start]]): `SETTINGS_FILE=/dev/null` + mock vision → `next build` + `next start :3105` hoặc `npm run dev` theo README script.
2. Sửa `e2e-storyboard.mts` (2 call `/run`) + `e2e-script-video.mts` (`/run:87`) sang generate-all; thêm assert `/run`+`/export` → 404.
3. Chạy `npm run test:e2e` + `npm run test:e2e-video`; sửa tới xanh. Lưu ý known-issue e2e-video parseScript 502 KHÔNG phải hồi quy ([[e2e-video-parsescript-preexisting-fail]]) — tách bằng cây sạch nếu nghi.
4. Chạy `npm run test:unit` (verify-project không đổi, chỉ xác nhận xanh).
5. Cập nhật README + xác nhận layout metadata.
6. `npm run build` lần cuối.

## Success Criteria

- [ ] `npm run test:e2e` + `npm run test:e2e-video` xanh: generate-all fill mọi beat, band lỗi cô lập, edit giữ qua generate-all, script reuse content (vision không chạy lần 2), route cũ 404
- [ ] `npm run test:unit` xanh (verify-project không đổi; verify-narration phủ `working.content` set)
- [ ] README mô tả đúng: Nhận chapter → Storyboard (Generate all) → Kịch bản → Video; không còn "Chạy tất cả" ở Stage 1
- [ ] `npm run build` xanh

## Risk Assessment

- **Rủi ro:** nhầm known-issue e2e-video (502 parseScript) với hồi quy của plan này. **Giảm thiểu:** so cây sạch trước sửa (memory [[e2e-video-parsescript-preexisting-fail]]).
- **Rủi ro:** mock vision batch pacing làm E2E chậm/timeout. **Giảm thiểu:** đặt RPM cao trong test (vd 600) để `minIntervalMs` nhỏ.
