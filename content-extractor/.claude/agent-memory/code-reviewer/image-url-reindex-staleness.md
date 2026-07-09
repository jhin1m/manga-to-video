---
name: image-url-reindex-staleness
description: Index-based in-memory image URLs go stale after re-index/splice unless cache-busted or keyed by stable id — recurring review check
metadata:
  type: project
---

Item/beat images are served from index-based routes (`/api/jobs/{id}/items/{index}/image`) with `Cache-Control: no-store`. Any operation that splices+re-indexes an array (deleteItem, reorder) can leave the DOM `<img>` showing a stale neighbour image: React keyed by array index keeps the same `src` string for surviving rows, so it never re-sets the attribute and the browser never refetches.

**Why:** the storyboard page already solved this — beat crop `<img>` uses `src={cropUrl}?v=${rev}` and bumps `rev` on every mutating op, plus keys rows by stable `beat.id`. The upload item grid (`app/page.tsx`) does NOT: it keys `<figure>` by `item.index` and uses a bare index URL, so `deleteItem` of a non-last band shows shifted-stale thumbnails.

**How to apply:** when reviewing any feature that re-indexes an in-memory-image list, verify the render either (a) keys by a stable id / filename, or (b) appends a changing cache-buster to the image URL. Bare index URL + `key={index}` = stale-thumbnail bug even with `no-store`. Related: [[content-extractor-conventions]].

**Status 2026-07-08:** item grid fixed — `toItemDTO` (lib/jobs.ts) now appends `?v=${encodeURIComponent(item.filename)}` (stable per-band identity). Landed alongside Stage 2 changes, uncommitted at review time. A DEEPER variant remains open: `deleteItem` re-index after storyboard compose misaligns `beat.sourceIndex` vs `job.items[...]` — the Stage 2 script route reads fresh content by `job.items[beat.sourceIndex]` and silently gets the wrong band's content (flagged in Stage 2 review).
