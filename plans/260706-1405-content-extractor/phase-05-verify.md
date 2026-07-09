---
phase: 5
title: "Verify"
status: completed
effort: "S"
---

# Phase 5: Verify

## Overview

End-to-end verification against the 5 acceptance criteria + build/type gates. Node 24. Some checks
(real Vietnamese vision output, Z.AI switch) need the user's API key → paired with onboarding.

## Requirements

Meet every acceptance criterion in `plan.md`; no type/build errors; deterministic ordering proven.

## Architecture / Approach

- **Static gates** (no API key needed): `npx tsc --noEmit`, `npm run build`, `npm run lint`.
- **Ordering gate**: generate `1.jpg,2.jpg,10.jpg` (e.g. via a tiny sharp script producing solid-color
  images) → upload → assert rows render in order `1,2,10` (natural sort, not `1,10,2`).
- **Live gates** (need key): real content is Vietnamese; ENV switch to Z.AI GLM works with zero code
  change; kill network mid-run → failed item red badge + others survive + retry works.
- **Export gate**: `GET …/export` → assert `version`, `jobId`, and each item has `index,filename,content`.

## Related Code Files

- Create (temp, gitignored): `content-extractor/scripts/make-test-images.mjs` (solid-color 1/2/10.jpg via sharp).
- Modify: fix any regressions surfaced across `lib/` + `app/`.

## Implementation Steps

1. Bootstrap Node 24; `npx tsc --noEmit` + `npm run build` — zero errors.
2. Generate test images; run `npm run dev`; upload the 3 → assert order 1,2,10.
3. (key present) Confirm Vietnamese content on a real chapter sample.
4. (key present) Swap `OPENAI_BASE_URL`+`VISION_MODEL` to Z.AI GLM in `.env.local`; rerun; assert works, no code edit.
5. Simulate network failure mid-run (offline / bad baseURL) → assert item red badge, siblings OK, retry recovers.
6. Hit `/api/jobs/{id}/export` → validate manifest shape.
7. Fix regressions; re-run gates.

## Success Criteria

- [x] `npm run dev`, `tsc --noEmit`, `npm run build` all clean on Node 24 (+ `npm run lint` sạch).
- [x] Upload `1,2,10` → 3 rows in order 1,2,10 — E2E qua mock OpenAI-compatible server.
- [ ] Vietnamese content on a real call; Z.AI GLM works via ENV only. **(CHỜ API KEY — chạy lúc onboarding.** Cơ chế zero-code-change đã chứng minh: mock server là endpoint khác OpenAI, switch thuần ENV; adaptive json-mode fallback pass.)
- [x] Network kill → red badge + isolation + working retry — mô phỏng bằng 401 giữa job (cùng đường cô lập lỗi): 1 item lỗi tiếng Việt, 2 item sống, retry phục hồi, progress khớp lại.
- [x] `export` returns a valid manifest (index, filename, content per item) + header `Content-Disposition: attachment`.

## Risk Assessment

- Real API cost → verify with a few images only.
- Vision output quality is out of scope (Stage 1 = extraction plumbing, not prompt tuning).
- Live gates blocked until the user supplies a key → run static + ordering gates first, live gates during onboarding.
