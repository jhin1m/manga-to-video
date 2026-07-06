---
phase: 5
title: "Export & Verify"
status: completed
priority: P1
dependencies: [4]
---

# Phase 5: Export & Verify

## Overview

Export `StoryboardManifest` (hợp đồng Stage 2) + verify toàn stage qua gates tĩnh và e2e mock,
đúng cách đã dùng cho Stage 1.

## Requirements

- Functional: route export tải `StoryboardManifest` JSON (attachment); manifest tự đủ cho Stage 2 (beats + narration + region + sourceKind).
- Non-functional: qua `tsc --noEmit`, `lint`, `build`, dev boot; e2e qua mock OpenAI-compatible server (không tốn API thật).

## Architecture

Export route `GET /api/jobs/{id}/storyboard/export` → `toStoryboardManifest(state)` → JSON attachment
(`storyboard-<jobId>.json`), mẫu route export Stage 1. Manifest gồm `version, jobId, createdAt, sourceKind, beatCount, beats[]`.

<!-- Updated: Validation Session 1 - stitch+smart-split (SmartStitch port), pdf-to-img, narration template (không LLM → mock chỉ cần vision) -->

Verify: dựng lại mock server OpenAI-compatible (scratchpad Stage 1 đã mất) — **chỉ cần endpoint vision** trả
`SceneContent` mẫu (2A). Narration là **template thuần**, không cần mock model. E2e phủ 2 nhánh nguồn + stitch/smart-split + PDF + import.

## Related Code Files

- Create: `content-extractor/app/api/jobs/[id]/storyboard/export/route.ts`.
- Reference: `app/api/jobs/[id]/export/route.ts` (mẫu attachment header), plan Stage 1 `phase-05-verify.md` (mẫu mock e2e).
- Create (scratchpad, không commit): ảnh tổng hợp dải-dọc-có-gutter + PDF mẫu + mock server.

## Implementation Steps

1. Export route: build manifest + header `Content-Disposition: attachment`.
2. Mock OpenAI server: endpoint chat completions trả SceneContent + narration mẫu cố định.
3. E2E:
   - Pages (manga): upload `1,2,10.jpg` → storyboard 3 beat cả-trang → template narration → export shape đúng.
   - Strip (webtoon): ảnh dải dọc tổng hợp có bubble giả → stitch + smart-split (SmartStitch port) ra N band **không cắt ngang bubble** → N beat 2A → export.
   - PDF: file PDF 2 trang → `pdf-to-img` render → vào pipeline → storyboard.
   - Edit: PATCH narration + region → phản ánh trong export; split/merge đúng.
   - Import: manifest + ảnh (session mới) → dựng storyboard → export khớp.
4. Gates: `nvm use 24` rồi `tsc --noEmit` · `npm run lint` · `npm run build` · `npm run dev` boot.
5. (Tuỳ chọn) code review nhanh như Stage 1; fix Critical/High ngay.

## Success Criteria

- [x] `GET …/storyboard/export` → `StoryboardManifest` hợp lệ, versioned, attachment.
- [x] E2E cả 3 nguồn (pages/strip/PDF) + edit + import pass qua mock.
- [x] `tsc --noEmit` · `lint` · `build` · dev boot: 0 lỗi.
- [x] Beat lỗi giữa job → cô lhoá + retry, export vẫn hợp lệ (beat lỗi mang `error`).

## Risk Assessment

- **Live-gate cần API key thật** (narration tiếng Việt từ model thật, switch Z.AI GLM) → nghiệm thu lúc onboarding, mock chứng minh cơ chế (mẫu Stage 1).
- **Manifest thiếu field cho Stage 2** → rà lại nhu cầu TTS/Ken Burns (region đủ cho pan/zoom? duration hint đủ canh timing?) trước khi chốt version.
