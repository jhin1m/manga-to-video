---
title: "Gộp stage Trích xuất vào Storyboard"
description: "Bỏ màn Trích xuất riêng; đưa batch vision vào Storyboard qua nút Generate all; stepper còn 3 bước."
status: completed
priority: P1
effort: "1-1.5d"
tags: [refactor, ui, pipeline, stage-merge]
created: 2026-07-18
---

# Gộp stage Trích xuất vào Storyboard

## Overview

Hiện pipeline 4 stage: **Trích xuất (Stage 1)** → **Storyboard (1.5)** → Kịch bản → Video.
Trích xuất và Storyboard chạy trên **cùng danh sách band** (1 band = 1 item = 1 nhịp, 1:1:1) và
**dùng chung `describeImage`**. Kết quả: có **hai nơi chạy vision** — nút "Chạy tất cả" (batch,
Stage 1) và nút "Generate" per-beat (Storyboard). Trích xuất chỉ là một batch mù (chạy xong mới
thấy kết quả) và không có gì Storyboard chưa có.

Plan này **gộp Trích xuất vào Storyboard**: bỏ màn Trích xuất riêng, chuyển batch vision thành
nút **"Generate all"** ngay trong Storyboard (thấy từng nhịp fill live qua SSE + regenerate lẻ),
rút stepper còn **3 bước (Storyboard → Kịch bản → Video)**. `/` thành trang **nhận chapter** thuần
(upload + preview band + xoá band rác + ngữ cảnh chương → Tạo storyboard).

**Giữ nguyên:** save/load `.mtvproj` (manifest nội bộ round-trip). **Bỏ:** nút "Export JSON"
standalone (`/api/jobs/[id]/export`) — không route nào đọc lại file này.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Một nơi duy nhất chạy vision cho band: "Generate all" trong Storyboard | P1 |
| 2 | Bỏ màn Trích xuất; `/` chỉ còn upload + preview + context | P1 |
| 3 | Stepper 3 bước; điều hướng nhất quán | P1 |
| 4 | Xoá route/hàm chết của Stage 1 (YAGNI) | P2 |
| 5 | `.mtvproj` save/load còn nguyên; test + docs cập nhật | P1 |

## Data flow (sau khi gộp)

```
Upload (/)  → POST /api/jobs         → job.items[] = band (content=null, KHÔNG chạy vision)
            → xoá band rác + nhập context
            → "Tạo storyboard" → POST /api/jobs/{id}/storyboard  → beats pending (1/band)
Storyboard  → "Generate all" → POST /api/jobs/{id}/storyboard/generate {rpm}
            → composeStoryboard(vision:true) → mỗi beat: crop → describeImage → scene
              → narration (beat) + working.content = scene  ← LƯU content để Kịch bản reuse
            → SSE sb:{jobId} cập nhật tiến độ; per-beat "Generate"/sửa tay như cũ
→ Kịch bản (đọc working.content, KHÔNG chạy vision lại) → Video (không đổi)
```

> **Quyết định validation:** vision chạy MỘT lần ở Generate-all, `scene` được ghi vào `working.content`
> nên bước Kịch bản (`resolveMissingContent`) không chạy vision lần 2. `resolveMissingContent` giữ làm
> fallback cho nhịp chưa Generate (không thêm gate bắt buộc Generate-all trước Kịch bản).

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Backend — Generate all batch vision](./phase-01-start.md) | Done |
| 2 | [Frontend — thu gọn `/` thành nhận chapter](./phase-02-backend-generate-all-batch-vision.md) | Done |
| 3 | [Frontend — Storyboard Generate-all + stepper 3 bước](./phase-03-frontend-rewire-upload-storyboard-stepper.md) | Done |
| 4 | [Xoá route/hàm chết của Stage 1](./phase-04-remove-dead-extract-routes.md) | Done |
| 5 | [Tests + docs](./phase-05-tests-and-docs.md) | Done |

**Thứ tự bắt buộc:** 1 (additive, non-breaking) → 2 → 3 (UI hết gọi route cũ) → 4 (mới được xoá route) → 5.
Mỗi phase shippable độc lập.

## Success Criteria

- [x] Fresh chapter: upload → Tạo storyboard → beats pending sạch (KHÔNG badge lỗi "Nội dung trống")
- [x] "Generate all" chạy vision mọi beat pending/error, tiến độ live qua SSE, tôn trọng RPM
- [x] Vision chạy 1 lần: `working.content` được lưu ở Generate-all → Kịch bản KHÔNG chạy vision lần 2
- [x] Per-beat "Generate" + sửa narration tay vẫn hoạt động; beat đã sửa KHÔNG bị Generate-all đè
- [x] Stepper hiển thị 3 bước; `/` reachable qua logo; khoá bước đúng readiness
- [x] `.mtvproj` Lưu → Mở round-trip đúng (beats + narration nguyên vẹn), dù `manifest.items[].content = null`
- [x] Không còn tham chiếu tới `/run`, `/stream`, `/export`, items PATCH/retry trong UI (app/components)
- [x] `npm run test:unit` + `npm run test:e2e` + `npm run test:e2e-video` xanh (CẢ 2 e2e viết lại theo luồng mới)

## Execution Log

### Session 2 — 2026-07-18 (thực thi, /ak:cook)

- Cả 5 phase hoàn tất theo thứ tự; mỗi phase chốt bằng tsc/lint (+build ở Phase 4-5).
- Verify cuối: `tsc --noEmit` + `lint` + `next build` sạch; `test:unit` ALL PASS (verify-narration
  thêm Test 5: mock vision in-process đếm call — persist `working.content`, re-run 0 call);
  `test:e2e` + `test:e2e-video` ALL PASS (next start :3105 + 3 mock server).
- Code review (subagent): 8/10, 0 Critical. Đã fix M1 (xoá hết band → `/` kẹt trắng: gate preview
  theo `jobId`, giữ "Chapter mới"), M2 (persist `working.content` chuyển ra SAU guard narration
  rỗng — scene rỗng không persist để script fallback còn thấy band missing), L2 (comment cũ
  nhắc `/run` trong `jobs/route.ts`).
- Ghi nhận không sửa: L1 `pendingCount` UI đếm theo `!narration.trim() || error` (BeatDTO không
  expose status — đúng spec Phase 3; chỉ over-count khi cố tình lưu narration rỗng). L3 project
  mới re-import chạy vision lại ở bước Kịch bản (content không ghi ngược item — đúng quyết định
  Q4, fallback giữ nguyên).

## Open Questions

- Không có. (Đã xác nhận với user: manifest.json không dùng độc lập; luôn đích video → gộp an toàn.)

## Validation Log

### Session 1 — 2026-07-18

**Verification (Full tier, 5 phase):**
- Claims checked: ~12 | Verified: 10 | Failed: 2 | Unverified: 0
- VERIFIED: `composeStoryboard`/`composeBeat` chữ ký; `createPacer`; `buildAndCompose`; message lỗi empty-narration (narration.ts:85); `run/route.ts` pattern; `items/[i]/route.ts` có PATCH(34)+DELETE(72); `processChapter` chỉ `/run` gọi; `toManifest` không qua route `/export`; stepper/storyboard symbols.
- **FAILED-1 (bổ khuyết):** Bước Kịch bản đọc `content` không phải `beat.narration`; `resolveMissingContent` (script.ts:99-137) chạy lại vision, KHÔNG cache → luồng gộp gây double-vision. → sửa Phase 1: persist `scene` vào `working.content`.
- **FAILED-2 (bổ khuyết):** `/run` còn bị `e2e-script-video.mts:87` gọi (ngoài `e2e-storyboard.mts:163`+`:439`) — plan gốc bỏ sót. → sửa Phase 4/5: viết lại CẢ 2 e2e.

**Quyết định (user xác nhận, 4/4 theo khuyến nghị):**
1. Lưu `SceneContent` vào `working.content` khi Generate → Kịch bản reuse (chống double-vision). *(Phase 1)*
2. Xóa `/run` + viết lại CẢ 2 e2e test. *(Phase 4, 5)*
3. "Generate all" chỉ nhắm nhịp pending/error/rỗng (không đè bản sửa tay). *(Phase 1, 3 — đã có)*
4. KHÔNG thêm gate bắt buộc Generate-all trước Kịch bản (giữ fallback `resolveMissingContent`). *(Không đổi scope)*

**Whole-Plan Consistency Sweep:** Đã rà lại plan.md + 5 phase. Không còn mâu thuẫn: "double-vision/working.content" đồng bộ ở plan.md + Phase 1 + Phase 5; "2 e2e" đồng bộ ở Phase 4 + Phase 5; `resolveMissingContent` mô tả nhất quán (giữ làm fallback). Không có thuật ngữ/route đã đổi còn sót. 0 mâu thuẫn chưa giải quyết.

<!-- slug: gop-stage-trich-xuat-vao-storyboard -->
