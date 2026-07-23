---
title: "Tien trinh Upload / Generate all / Tao kich ban"
description: "Them phan hoi tien trinh truc quan cho 3 buoc: Upload anh, Storyboard Generate all, Tao kich ban"
status: done
priority: P1
effort: ""
tags: [ui, progress, streaming, content-extractor]
created: 2026-07-23
---

# Tiến trình cho Upload / Generate all / Tạo kịch bản

## Overview

Thêm phản hồi tiến trình trực quan cho 3 bước trong app `content-extractor` (Next 16, React 19). Mỗi bước dùng cơ chế khớp vòng đời thao tác: **B** làm giàu progress SSE sẵn có (client-only), **A** và **C** dùng NDJSON stream trên chính response POST. Không thêm queue/DB, giữ in-memory single-user.

Nguồn: [brainstorm report](../reports/brainstorm-to-planner-260723-1349-progress-indicators-report.md) (đã duyệt thiết kế).

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Upload hiện % tải lên (bytes) + bước xử lý server đếm được | P1 |
| 2 | Generate all thêm %, ETA, nhịp đang chạy vào progress hiện có | P2 |
| 3 | Tạo kịch bản có bộ đếm ký tự/token real-time + nhãn pha | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Generate all — làm giàu tiến trình (client-only)](./phase-01-generate-all-client-only.md) | Done |
| 2 | [Phase 2: Upload — tiến trình 2 pha (XHR + NDJSON stream)](./phase-02-upload-xhr-ndjson-stream.md) | Done |
| 3 | [Phase 3: Tạo kịch bản — stream token real-time](./phase-03-script-stream-token.md) | Done |

Thứ tự theo rủi ro tăng dần. P1 độc lập (client-only, ship trước). P2 tạo helper NDJSON dùng chung; P3 tái dùng helper đó → P3 `blockedBy` P2 (chỉ về mặt code helper, không về logic).

## Non-Goals (round này)

- Không queue/DB; giữ in-memory single-user.
- Không đổi thuật toán band-split / vision / model / shot-split.
- Không làm progress cho TTS/render.
- Không đổi cơ chế SSE + store-bus của Generate all (đang đúng vòng đời).

## Success Criteria

- [x] Upload: thanh pha-1 (% bytes) rồi pha-2 (bước xử lý đếm được), dòng cuối trả `JobStatusDTO` như cũ; lỗi hiện toast rõ.
- [x] Generate all: nhãn có % + ETA + "Đang soạn nhịp k/N", nhịp đang chạy được highlight; không sửa API/store.
- [x] Tạo kịch bản: counter ký tự tăng real-time + nhãn pha (bổ sung band → biên kịch → chia shot); giữ `withRetry`/`REPAIR_NUDGE`/`setScriptGenerating`; kết quả kịch bản không đổi so với trước. *(counter real-time cần 1 lượt chạy provider thật để nghiệm thu — xem Delivery Log; e2e đã xác nhận đường FALLBACK non-stream ra kịch bản đúng.)*
- [x] `pnpm test:unit` xanh; e2e liên quan (`test:e2e`, `test:e2e-video`) chạy được. *(Cả hai PASS: E2E_ALL_PASS + E2E_SCRIPT_VIDEO_ALL_PASS.)*
- [x] Không regression: bỏ JS vẫn hoạt động ở mức cơ bản? (N/A — app là SPA client). Reduced-motion tôn trọng ở thanh animate (`useReducedMotion` cho scroll storyboard; `motion-reduce:animate-none` cho bar vô định script).

## Delivery Log

### Session 2 — Implementation (2026-07-23, /ak:cook)
- **Đã ship cả 3 phase.** Gate: `tsc --noEmit` PASS · `eslint` PASS (10 file) · `pnpm test:unit` PASS (9 suite) · e2e-storyboard PASS · e2e-script-video PASS.
- **Transport dùng chung:** `lib/ndjson-stream.ts` (server writer) + `lib/ndjson-client.ts` (`readNdjson` XHR / `readNdjsonBody` fetch). Type `IngestProgress` ở `lib/schema.ts`.
- **Contract đổi:** POST `/api/jobs` + POST `.../script` trả NDJSON (guards script vẫn trả JSON trước khi mở stream; GET giữ JSON). Caller cập nhật đủ: 2 client page + 2 e2e script (4 call `/api/jobs` + 1 call `/script`).
- **Fallback Phase 3 đã kiểm chạy thật:** mock trả JSON thường cho `stream:true` → `StreamUnsupportedError` → lùi non-stream IM LẶNG (2 call model: 1 stream thử + 1 non-stream, KHÔNG burn 4 retry). Kịch bản ra đúng (index ngoài biên bị loại).
- **Code review:** DONE_WITH_CONCERNS — 0 defect chặn; semantics `completeJson`/parse path/guards/race đều giữ. Thêm 1 chỉnh: route phát `writing` marker trước `generateScript` để thứ tự pha luôn resolving→writing→splitting kể cả khi fallback.
- **CÒN LẠI (bước manual, cần API key thật):** nghiệm thu counter real-time trên provider (z.ai/OpenRouter) — xác nhận `stream:true` + `thinking:{disabled}` + `json_object` cùng lúc chịu được; nếu bị từ chối, counter no-op im lặng nhưng kịch bản vẫn đúng (đã có đường lùi). Đây là rủi ro chính plan đã nêu (Phase 3 bước 5).

## Validation Log

### Verification Results (Standard tier — Fact Checker + Contract Verifier)
- Claims checked: 12 · Verified: 12 · Failed: 0 · Unverified: 0
- Callers `ingestBandItems`/`expandPdfs`: chỉ `app/api/jobs/route.ts` + `scripts/verify-banding.mts` (gọi không callback) → param optional an toàn.
- `resolveMissingContent`@script.ts:124, `withRetry`@vision.ts:150, `completeJson`@vision.ts:221 — đúng.
- openai `^6.45.0` hỗ trợ `stream:true`. mock/verify/e2e scripts + `use-reduced-motion.ts` tồn tại.

### Session 1 — Quyết định (2026-07-23)
1. **Phase 3 fallback stream:** provider từ chối `stream:true` → **tự lùi non-stream, IM LẶNG** (không toast). Counter đứng im, kịch bản vẫn ra.
2. **Phase 1 ETA:** **Hiện ETA dạng "còn ~X"** (ước lượng từ rpm), chấp nhận lệch; nhãn ghi rõ "~".
3. **Phase 2 nháy pha-2:** **Luôn hiện** các bước pha-2, KHÔNG debounce/ẩn khi nhanh (KISS, nhất quán).

### Whole-Plan Consistency Sweep
- Re-read plan.md + 3 phase. Không mâu thuẫn: cả 3 quyết định trùng giả định sẵn có của plan; đã chốt tường minh ở phase tương ứng. Thuật ngữ NDJSON/JobProgress/thứ tự B→A→C nhất quán. Zero unresolved contradiction.

<!-- slug: tien-trinh-upload-generate-all-tao-kich-ban -->
