---
name: content-extractor-conventions
description: Stage 1/1.5 review conventions for content-extractor (Next 16 App Router, in-memory store, Vietnamese errors)
metadata:
  type: project
---

Conventions to hold new code against (validated across Stage 1 + Stage 1.5 review, 2026-07-07):

- Route handlers: `runtime = 'nodejs'`, `params` is a Promise (Next 16), errors = `NextResponse.json({ error: '<tiếng Việt>' }, { status })`.
- Stores: singleton Maps + EventEmitter on `globalThis` (`__mrs_*`) to survive HMR; export JSON manifest IS the persistence story (no DB by design — do not flag).
- DTOs never carry Buffer; schema.ts must stay free of Node types (structural typing trick in `toManifest`).
- `<img>` with eslint-disable, never next/image (in-memory image URLs).
- SSE pattern: snapshot-on-connect, closed-flag guard around enqueue, close on done/failed, poll fallback client-side.
- ENV-driven config with safe fallbacks; `.env.example` is the contract doc.
- Known systemic gaps found in Stage 1.5 review (check if fixed before re-flagging): 409 phase-guard TOCTOU (check before awaits), compose-vs-PATCH last-write-wins on beats, ingest downscale (fit-inside square MAX_EDGE) destroys webtoon strip width, pages-beat content is a stale snapshot from storyboard creation.

**Why:** repo has no docs/code-standards.md; Stage 1 code is the de-facto standard the user expects Stage 1.5+ to match.
**How to apply:** in reviews of this repo, compare new routes/libs against these patterns first; verification gates = `nvm use 24` (Herd nvm) then tsc/lint/build.
