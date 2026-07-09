---
phase: 1
title: "Scaffold & Types"
status: completed
effort: "S"
---

# Phase 1: Scaffold & Types

<!-- Updated: Validation Session 1 - Next 16 + Tailwind v4 + openai v6; MAX_EDGE default 1568 -->

## Overview

Create the Next.js 16 app in `content-extractor/`, install the four runtime deps, configure env,
and define every shared TypeScript type in `lib/schema.ts` (the contract the rest of the app builds on).

## Requirements

- Functional: runnable Next.js skeleton on Node 24; all shared types + `toManifest()`; `.env.example`.
- Non-functional: KISS, exactly the deps in the spec, no `src/` dir (structure uses `app/` + `lib/`).

## Architecture

- **Node 24 bootstrap**: fresh shells default to Herd Node 22 → prefix build commands with
  `source scratchpad/use-node24.sh &&` (or `nvm use 24`). Pin project via `.nvmrc = 24`.
- **Scaffold (non-interactive)**:
  `npx create-next-app@latest content-extractor --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --yes`
  (Next 16 → Turbopack default + Tailwind v4, both fine; sharp runs server-side, unaffected).
- **Deps**: `npm i openai sharp adm-zip p-limit` + `npm i -D @types/adm-zip`.
- **schema.ts contract**:

```ts
export interface SceneContent { description: string; dialogue: string[]; note: string; }
export type ItemStatus = 'pending' | 'done' | 'error';
export type JobPhase   = 'queued' | 'processing' | 'done' | 'failed';

// API DTO (what GET returns) — no buffer
export interface ItemDTO { index: number; filename: string; imageUrl: string; content: SceneContent | null; error?: string; }
export interface JobProgress { done: number; total: number; currentIndex: number | null; phase: JobPhase; }
export interface JobStatusDTO { jobId: string; progress: JobProgress; items: ItemDTO[]; }

export interface ManifestItem { index: number; filename: string; content: SceneContent | null; error?: string; }
export interface Manifest { version: number; jobId: string; createdAt: string; itemCount: number; items: ManifestItem[]; }

export const MANIFEST_VERSION = 1;
export function emptyContent(): SceneContent { return { description: '', dialogue: [], note: '' }; }
export function toManifest(...): Manifest // built in phase 3 from a Job
```

- **Internal `StoredItem`/`Job`** types (with `Buffer`) live in `lib/jobs.ts` (phase 2), not schema.ts,
  to keep schema.ts free of Node types (reusable by a future browser/CLI consumer).

## Related Code Files

- Create: `content-extractor/` (scaffold), `content-extractor/lib/schema.ts`,
  `content-extractor/.env.example`, `content-extractor/.nvmrc`
- Modify: `content-extractor/app/layout.tsx` (`lang="vi"`, metadata title)
- Repo root: `git init` (create-next-app `.gitignore` already covers `node_modules`, `.env*`)

## Implementation Steps

1. Bootstrap Node 24; run create-next-app in repo root → `content-extractor/`.
2. Install runtime deps + `@types/adm-zip`.
3. Write `.env.example` (5 vars: OpenAI defaults, `MAX_EDGE=1568`, `VISION_CONCURRENCY=4`, + Z.AI comment); `.nvmrc = 24`.
4. Write `lib/schema.ts` per contract above.
5. Set `layout.tsx` `lang="vi"` + title "Manga Content Extractor".
6. `git init` at repo root; confirm `.env*` ignored.
7. Typecheck: `npx tsc --noEmit`.

## Success Criteria

- [x] `content-extractor/` scaffolded; `npm run dev` boots the default page on Node 24.
- [x] `lib/schema.ts` compiles and exports all types + `emptyContent`/`toManifest` stubs.
- [x] `.env.example` has the 5 spec vars with OpenAI + Z.AI comments.
- [x] Git repo initialized at `manga-to-video/`; `.env*` gitignored (đã thêm `!.env.example` — review finding M1).

## Risk Assessment

- create-next-app interactive prompts → pass all flags + `--yes`; verify output non-interactively.
- sharp native binary on darwin-arm64 → prebuilt binary exists; if install fails, `npm rebuild sharp`.
