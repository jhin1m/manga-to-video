---
phase: 2
title: "TS app Mức 1: nạp series context + xuất recap"
status: in-progress
priority: P2
effort: "0.5d"
dependencies: []
---

# Phase 2: TS app Mức 1: nạp series context + xuất recap

## Overview

App không biết folder path (ingest qua browser upload) nên tích hợp Mức 1: 2 nút quanh
textarea context sẵn có — nạp file bible/summaries vào context, và xuất recap chương từ
script để user tự đặt vào `.mtv/summaries/`. Dùng chung format với Phase 1.

## Requirements

- Functional: nạp nhiều file .md → ghép đúng thứ tự (bible trước, summaries theo natural-sort) đổ vào field context + PATCH; xuất recap ≤250 từ đúng format `references/series.md`.
- Non-functional: không đổi `.mtvproj`/PROJECT_VERSION; giữ cap độ dài context của PATCH route hiện có.

## Architecture

- Nạp: client-side thuần — `<input type="file" multiple accept=".md,.txt">`, FileReader đọc,
  ghép chuỗi (file tên chứa "bible" lên đầu, còn lại natural-sort), set state `context`
  (`app/page.tsx:35`) → cơ chế PATCH-on-blur sẵn có tự lưu. Không cần API mới.
- Xuất: route mới `POST /api/jobs/[id]/storyboard/recap` — đọc segments script của job, gọi
  `generateRecap()` (thêm vào `lib/script.ts`, reuse model client + config của `generateScript`),
  trả markdown; client tải về `chapter-recap.md`. Prompt recap nêu rõ: ≤250 từ, diễn biến theo
  nhân quả, ngôi ba, không spoil ngoài chương.

## Related Code Files

- Modify: `content-extractor/app/page.tsx` — 2 nút cạnh textarea context (đã có state `context` + PATCH-on-blur).
- Modify: `content-extractor/lib/script.ts` — thêm `buildRecapPrompt(segments)` + `generateRecap(segments)` (reuse client/model config hiện có; export buildRecapPrompt cho verify).
- Create: `content-extractor/app/api/jobs/[id]/storyboard/recap/route.ts` — theo pattern route `storyboard/script` cạnh đó.
- Modify: `content-extractor/scripts/verify-script.mts` — case mới cho `buildRecapPrompt` (giới hạn từ, có/không segments).

## Implementation Steps

1. `lib/script.ts`: viết `buildRecapPrompt` + `generateRecap` (KHÔNG đụng `generateScript`/`buildPrompt`).
2. Route `recap/route.ts`: đọc job (script phải đã có, lỗi rõ nếu chưa), gọi generateRecap, trả `text/markdown`.
3. `page.tsx`: nút nạp (đọc file, ghép, set context + PATCH ngay) + nút xuất (fetch route, tải blob). Nút xuất luôn hiện — trang Home không có state script (script sinh ở trang Storyboard), gate cần thêm 1 GET vô ích; chưa có script thì route trả 404 với message rõ → toast.
4. `verify-script.mts` case mới; chạy `pnpm test:unit && pnpm lint && pnpm build` (nhớ `nvm use 24`).

## Success Criteria

- [ ] Nạp 3 file (bible + 2 summary) → context ghép đúng thứ tự, PATCH lưu, reload hiện lại. *(code xong + PATCH ngay khi nạp — nghiệm thu tay trong Phase 3 bước 7)*
- [ ] Xuất recap từ job pilot → file .md đúng format, ≤250 từ. *(nghiệm thu trong Phase 3 bước 7)*
- [x] `pnpm test:unit` + `lint` + `build` sạch; không đổi hành vi khi không dùng 2 nút. *(5× ALL_PASS + e2e-storyboard E2E_ALL_PASS, 2026-07-19)*

## Risk Assessment

- Ghép file vượt cap context của PATCH → cắt + toast cảnh báo. Cap nới 4000 → 16000 ký tự (cả route lẫn textarea) vì bible cap 2000 từ ≈ 10-12k ký tự tiếng Việt — trần cũ chứa không nổi series context (finding M3 code-review).
- Recap chất lượng kém do prompt → verify bằng đối chiếu tay ở Phase 3, chỉnh prompt tại một chỗ (`buildRecapPrompt`).
