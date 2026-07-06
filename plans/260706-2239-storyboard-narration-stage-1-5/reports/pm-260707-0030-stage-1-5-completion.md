# PM Report — Stage 1.5 Storyboard/Narration hoàn tất

**Ngày:** 2026-07-07 · **Plan:** `plans/260706-2239-storyboard-narration-stage-1-5` · **Status:** completed (5/5 phase)

## Kết quả

| Phase | Deliverable | Verify |
|-------|-------------|--------|
| 1 | `lib/schema.ts` (Beat/StoryboardManifest v1) + `lib/storyboard-store.ts` | tsc + unit narration |
| 2 | `lib/pdf.ts` (pdf-to-img ✓ Node 24) · `lib/source-kind.ts` · `lib/stitch.ts` · `lib/smart-split.ts` (port SmartStitch) | unit banding 20 assert — khớp kỳ vọng tính tay từ `lib.rs` |
| 3 | `lib/narration.ts` (template, không LLM; 2A strip; rev-guard) | unit narration 18 assert |
| 4 | 10 API route storyboard + import · UI `app/storyboard/[jobId]/page.tsx` + main page | build 20 route + e2e |
| 5 | Export route + mock vision + e2e | e2e 58 assert PASS ×2 lượt |

## Gates

- `tsc --noEmit` · `eslint` · `next build` · dev boot: 0 lỗi
- Unit: `npm run test:unit` (ingest 6 + banding 20 + narration 18) PASS
- E2E: `npm run test:e2e` qua mock OpenAI (pages/strip/PDF/edit/split-merge-reorder/import/export) 58 PASS
- Test scripts đã vào repo: `content-extractor/scripts/` (không còn ở scratchpad)

## Code review (code-reviewer subagent): DONE_WITH_CONCERNS → đã xử lý

| Finding | Fix |
|---------|-----|
| H1 ingest nghiền width slice webtoon | `downscale` nhánh dải dọc chỉ kẹp width; `boundForVision` chặn payload ≤ MAX_EDGE; default `SPLIT_HEIGHT` 1600 |
| H2 compose ghi đè sửa tay | `rev` per-beat: sửa/tách/gộp vô hiệu compose đang bay |
| H3 retry pages kẹt snapshot | `composeBeat` đọc content tươi từ `getJob()` |
| M1 TOCTOU double-POST | re-check 409 đồng bộ sau await |
| M2 crop band vượt MAX_EDGE | gộp vào `boundForVision` |
| M3 import validate lỏng | region chuẩn PATCH + chặn id trùng |
| M5 test ở scratchpad | chuyển vào `scripts/` + npm scripts |
| Low (crop 500, channels=2, nút storyboard ở ready) | đã fix |

## Known limitations (chấp nhận v1, ghi nhận cho Stage 2)

- Split beat nhánh pages: retry cả 2 nửa cho cùng narration full-page (compose pages bỏ qua region).
- Manifest chưa nhúng metadata bộ ảnh (filename/dims) — import nhầm bộ ảnh cùng số lượng chỉ bị bắt khi region vượt biên. Cân nhắc manifest v2.
- Memory: canvas strip rất dài decode raw toàn phần khi smart-split (dev tool chấp nhận; đã ghi chú).
- PDF nằm TRONG zip bị bỏ qua (chỉ nhận PDF upload trực tiếp).
- Kéo-thả handle chỉnh band chưa có — dùng overlay chọn + input số x/y/w/h (phương án "chắc" plan đã duyệt).

## Chưa commit

Toàn bộ thay đổi nằm ở working tree (repo chưa có commit nào). Người dùng quyết định thời điểm commit.
