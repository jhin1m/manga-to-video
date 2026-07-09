---
title: "Manga Content Extractor (Stage 1)"
description: "Vision-LLM tool that turns a manga chapter (numbered images/zip) into an editable, exportable per-scene content table."
status: completed
priority: P2
branch: ""
tags: ["nextjs", "vision-llm", "internal-tool", "manga-pipeline"]
blockedBy: []
blocks: []
created: "2026-07-06T07:06:24.540Z"
createdBy: "ck:plan"
source: skill
---

# Manga Content Extractor (Stage 1)

## Overview

Internal single-operator tool. Stage 1 of a manga→video review pipeline. Ingest one chapter
(many numbered images OR a zip) → per-scene structured content (`description` + `dialogue[]` +
`note`, Vietnamese) via an OpenAI-compatible vision LLM → 2-column table (thumbnail | content),
inline-editable, exportable as a versioned JSON manifest for downstream TTS/video stages.
Philosophy: **KISS**, deterministic reading order, hand-editable, always exportable. No DB/auth/queue.

## Stack (decided — do not re-research)

Next.js 16 (App Router, TS, React 19) · Tailwind v4 · `openai` SDK v6 (ENV-driven, OpenAI-compatible) ·
`sharp` (downscale) · `adm-zip` (unzip) · `p-limit` (concurrency) · SSE route handler ·
in-memory `Map` store (on `globalThis`). App lives in `./content-extractor/`; git root = repo root.

## Environment

Node **24.18.0** (installed via Herd nvm, `nvm alias default 24`). Fresh shells revert to Herd's
Node 22 (login profile hardcodes it), so every node/npm command must first `nvm use 24`. Project
pins `.nvmrc = 24`. A session helper `scratchpad/use-node24.sh` bootstraps this for build commands.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Scaffold & Types](./phase-01-scaffold-types.md) | Completed |
| 2 | [Core Lib](./phase-02-core-lib.md) | Completed |
| 3 | [API Routes](./phase-03-api-routes.md) | Completed |
| 4 | [UI](./phase-04-ui.md) | Completed |
| 5 | [Verify](./phase-05-verify.md) | Completed (2 live-gates chờ API key — onboarding) |

## Locked decisions

- Vision fully ENV-driven (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `VISION_MODEL`, `MAX_EDGE`, `VISION_CONCURRENCY`). Switch OpenAI⇄Z.AI by ENV only.
- **Adaptive json-mode**: try `response_format:json_object`; on 400 retry without + disable process-wide. Always robust-parse (strip ```json fences). No extra env var.
- Natural sort via `localeCompare(…,{numeric:true})` on basename — reading order is a hard requirement (1,2,…,9,10,11).
- Downscale long edge ≤ `MAX_EDGE` (sharp, `fit:inside`, auto-rotate, JPEG) BEFORE base64. One processed buffer serves thumbnail + vision + retry (no original kept).
- Concurrency-limited (`p-limit`) vision calls; results reassembled by original index.
- Per-image error isolation: one failure flags that item, never crashes the job. Per-item retry endpoint.
- In-memory store singleton on `globalThis` (survives dev HMR). Node runtime on API routes using native deps/SSE.
- Versioned manifest `{version,jobId,createdAt,itemCount,items:[{index,filename,content,error?}]}`.
- Added routes beyond original contract: `GET …/items/[i]/image` (thumbnail), `POST …/items/[i]/retry`.

## Acceptance (from spec)

- [x] `npm run dev` runs, no type/runtime error.
- [x] Upload `1.jpg,2.jpg,10.jpg` → 3 rows ordered 1,2,10, Vietnamese content.
- [ ] Switch ENV → Z.AI GLM works with zero code change. *(Cơ chế đã chứng minh qua mock endpoint thuần ENV; xác nhận GLM thật khi có API key — onboarding.)*
- [x] Network kill mid-run → failed item red badge, others survive, retry works. *(Mô phỏng lỗi 401 giữa job — cùng đường cô lập; network-kill thật test lúc onboarding.)*
- [x] `GET …/export` → valid manifest (each item has index, filename, content).

## Top risks

- HMR resets in-memory Map → mitigated by `globalThis` singleton.
- Endpoint rejects `response_format` → adaptive fallback + robust parse.
- Large multipart upload buffering → acceptable for local single-operator tool; note Node runtime.
- SSE client connects after job done → emit snapshot immediately on subscribe, then close.

## Dependencies

None (greenfield). Downstream pipeline stages (TTS/video) consume the exported manifest contract.

## Validation Log

### Session 1 (2026-07-06, mode --hard)

**Verification (Step 2.5 — greenfield, external API/version checks):**
- Checked 8 package/framework versions. Verified 7; 1 discrepancy (Next), resolved by user.
- `next` 16.2.10 (plan had said 15) · `tailwindcss` v4.3.2 · `openai` v6.45.0 (API compatible) ·
  react 19.2 · sharp 0.35 · adm-zip 0.5 · p-limit 7.3 (ESM) · typescript 6.0.
- Core design (async `params`, route handlers, SSE, downscale, concurrency) unchanged Next 15↔16.
- Verification failures after resolution: **0**.

**Decisions confirmed:**
1. Framework → **Next.js 16** (latest) + Tailwind v4 + openai v6; design unchanged.
2. `description` → **adaptive length**: model matches detail to panel content (brief for simple panels, richer for busy ones); describe what's shown, not a pre-written review.
3. `MAX_EDGE` default → **1568** (was 1024) for dialogue legibility; still ENV-overridable; one shared buffer kept (thumbnail shrinks via CSS).
4. `note` → **empty by default**; model fills only when useful (SFX/onomatopoeia, transitions, key context, low-confidence flag).
5. `dialogue` → **translated to Vietnamese** per spec (source may be JP/KO/EN).

**Known constraint (accepted):** in-memory store → jobs vanish on server restart; exported JSON is the persistence path. Matches spec's no-DB scope.

**Recommendation:** proceed to implementation (0 verification failures).

### Session 2 (2026-07-06, /ck:cook — implementation)

**Đã build:** đủ 5 phases. Next 16.2.10 / React 19.2 / Tailwind v4 / openai 6.45 / sharp 0.35.3 / adm-zip 0.5.18 / p-limit 7.3, Node 24.18.0. Git root tại `manga-to-video/` (đã gỡ repo lồng do create-next-app tạo). Bỏ font Geist (không có subset vietnamese) → system font stack.

**Gates pass:** `tsc --noEmit` · `npm run lint` · `npm run build` · `npm run dev` boot. E2E qua mock OpenAI-compatible server (scratchpad): ordering `1,2,10` ✓ · cô lập lỗi per-image (401 giữa job → 1 lỗi/2 sống) + retry phục hồi ✓ · SSE tiến độ live + late-connect snapshot + tự đóng ✓ · PATCH validate/merge/xóa lỗi ✓ · export manifest đúng shape + attachment header ✓ · zip lọc rác macOS (`__MACOSX`, `.DS_Store`, `._*`) ✓ · adaptive json-mode fallback dưới concurrency ✓ · token logging ✓ · thiếu key → 400 tiếng Việt ✓.

**Code review** (`reports/code-review-content-extractor.md`): 0 Critical/High. 3 Medium đã fix ngay:
1. M1: `.gitignore` scaffold nuốt `.env.example` → thêm `!.env.example`.
2. M2: SSE `controller.enqueue` không guard — lỗi lan đồng bộ qua `bus.emit` có thể phá cô lập lỗi → try/catch + close.
3. M3: SSE đứt giữa job → progress đóng băng → UI thêm poll fallback 2s đến khi done/failed.
Low findings (7) ghi nhận trong report — không fix (đúng threat model tool nội bộ / locked decisions).

**Còn chờ (onboarding, cần API key thật):** nội dung tiếng Việt từ model thật; switch Z.AI GLM thật; network-kill thật; lượt bấm UI trên trình duyệt. `.env.local` đã để sẵn template key rỗng.
