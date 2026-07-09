---
phase: 3
title: "API Routes"
status: completed
effort: "M"
---

# Phase 3: API Routes

## Overview

Seven App Router route handlers wiring `lib/` to HTTP. All use Node runtime. Next 16 → `params` is a
Promise (must `await`). Errors return JSON `{error: "<Vietnamese>"}` with the right status.

## Architecture (per route)

`export const runtime = 'nodejs'` on every route (native deps + SSE + shared in-memory store).

- **POST `/api/jobs`** (multipart):
  1. `readVisionConfig()` → 400 `{error:"Thiếu OPENAI_API_KEY…"}` if unset.
  2. `form = await req.formData()`; collect `zip` field (single) OR `images` field (many).
  3. `extractImages(...)`; if none → 400 "Không tìm thấy ảnh".
  4. `naturalSort` filenames; `downscale` each (parallel, bounded) → `StoredItem[]`.
  5. `createJob(items)`.
  6. Fire-and-forget: `processChapter(job.id,{concurrency,maxEdge}).catch(e => updateProgress(job.id,{phase:'failed'}))` — **do not await**.
  7. `return NextResponse.json({ jobId })`.
- **GET `/api/jobs/[id]`**: `const {id}=await params`; `getJob`→404. Return `JobStatusDTO` with
  `imageUrl = /api/jobs/${id}/items/${index}/image` composed per item.
- **GET `/api/jobs/[id]/stream`** (SSE): `ReadableStream`:
  - `start()`: emit current snapshot immediately (`data: <progress JSON>\n\n`); `unsub = subscribe(id, p => enqueue(p))`;
    if snapshot phase is `done`/`failed`, close after emitting.
  - close when a pushed progress has phase `done`/`failed`; on `req.signal` `abort` → `unsub()` + close.
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
    `Connection: keep-alive`, `X-Accel-Buffering: no`.
- **GET `/api/jobs/[id]/export`**: `getJob`→404. `toManifest(job)` → JSON with
  `Content-Disposition: attachment; filename="manifest-<id>.json"`.
- **PATCH `/api/jobs/[id]/items/[i]`**: `{id,i}=await params`. Body `{description?,dialogue?,note?}`.
  Validate types (string / string[] / string) → 400 on mismatch. Merge into `item.content` (init via
  `emptyContent()` if null), **clear `item.error`**, status `done`. Return updated `ItemDTO`.
- **GET `/api/jobs/[id]/items/[i]/image`**: return `item.buffer` as `image/jpeg`, `Cache-Control: no-store`. 404 if missing.
- **POST `/api/jobs/[id]/items/[i]/retry`**: re-run `describeImage(item.buffer, item.filename)`; on success
  set content + clear error, on fail set error; recompute `progress.done`. Return updated `ItemDTO`.

`toManifest(job)` and `toItemDTO(jobId, item)` helpers implemented here (or exported from `jobs.ts`).

## Related Code Files

- Create: `app/api/jobs/route.ts`, `app/api/jobs/[id]/route.ts`, `app/api/jobs/[id]/stream/route.ts`,
  `app/api/jobs/[id]/export/route.ts`, `app/api/jobs/[id]/items/[i]/route.ts`,
  `app/api/jobs/[id]/items/[i]/image/route.ts`, `app/api/jobs/[id]/items/[i]/retry/route.ts`

## Implementation Steps

1. `toItemDTO` + `toManifest` helpers.
2. POST /api/jobs (ingest + fire pipeline).
3. GET /api/jobs/[id].
4. SSE stream route.
5. export route.
6. PATCH item route.
7. image route + retry route.
8. Typecheck.

## Success Criteria

- [x] POST returns `{jobId}`; missing key → 400 with Vietnamese message.
- [x] GET returns items with composed `imageUrl`; 404 on unknown job.
- [x] SSE emits progress and closes on done/abort; late connection still gets a final snapshot (đóng sau 0.007s).
- [x] export sets attachment header + valid manifest.
- [x] PATCH merges content, clears error; bad body → 400.
- [x] image route streams JPEG (10KB đã downscale); retry re-runs vision for one item.

## Risk Assessment

- Next 16 async `params` → always `await`; typed as `Promise<{…}>`.
- Reverse-proxy buffering could delay SSE → `X-Accel-Buffering: no` + `no-transform`.
- Multipart buffering large chapters → acceptable for a local single-operator tool.
