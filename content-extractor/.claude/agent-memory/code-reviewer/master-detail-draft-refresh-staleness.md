---
name: master-detail-draft-refresh-staleness
description: Master-detail pages that keep an edit draft keyed by selected-item id go stale after background refresh (SSE done) — Save can overwrite fresh server data with the stale draft
metadata:
  type: project
---

Storyboard page (UI-unification review, 2026-07-08) uses "adjust state during render": draft reloads only when `selected.id` changes. Background `refresh()` after SSE done replaces `dto` but not the draft → user who opened the page mid-compose sees an empty textarea while the list shows generated narration; "Lưu nhịp" PATCHes `''` and wipes the AI text. Flagged High in `plans/260708-2300-ui-unification-shadcn-project-file/reports/code-review-ui-unification-mtvproj.md` (H1).

**Why:** the render-adjust pattern is correct for selection changes but has no answer for server-side changes to the SAME selected item; combined with the known compose-vs-PATCH last-write-wins gap, a stale draft becomes silent data loss.

**How to apply:** when reviewing any draft-holding master-detail view in this repo (storyboard beats, script segments, item table), check what happens when a background refresh (SSE/poll/import) changes the currently-drafted record. Require either a userTouched flag (sync draft when untouched) or draft-vs-previous-server-value comparison. Related: [[image-url-reindex-staleness]], [[content-extractor-conventions]].
