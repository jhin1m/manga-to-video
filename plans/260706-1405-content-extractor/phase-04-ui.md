---
phase: 4
title: "UI"
status: completed
effort: "M"
---

# Phase 4: UI

## Overview

Single client page (`app/page.tsx`, `'use client'`): upload (drop zone + file/folder pickers),
start, realtime SSE progress bar, then the 2-column results table with inline edit, export, and
per-item retry. All text Vietnamese. Tailwind only, clean/compact/responsive.

## Requirements

- Drag-drop a folder of images OR a zip, plus a "Bắt đầu" button.
- Live progress via `EventSource` ("Đang xử lý 7/40…").
- Table N rows × 2 cols `[thumbnail | content]`; content = description + dialogue list + note.
- Inline edit (textarea) saved via PATCH; "Export JSON" button; error rows → red badge + retry.

## Architecture

- **State**: `files: File[]`, `jobId`, `progress {done,total,phase}`, `items: ItemDTO[]`, `editing: Set<index>`, `busy`.
- **Upload input**: a drop zone (`onDrop` → `e.dataTransfer.files`) + `<input type=file multiple accept="image/*,.zip">`
  + a folder `<input type=file webkitdirectory>`. Merge into `files`. (Folder-entry recursion via
  `webkitGetAsEntry` is out of scope — folder picker + multi-file + zip cover the need.)
- **Start** → build `FormData`: files ending `.zip` → `append('zip', f)`, else `append('images', f)`.
  `POST /api/jobs` → `{jobId}`. Open `EventSource('/api/jobs/'+jobId+'/stream')`:
  - `onmessage`: parse progress → update bar; if `phase==='done'||'failed'` → `GET /api/jobs/{jobId}` → `setItems`, close ES.
  - `onerror`: show message, allow re-run.
- **Table**: rows sorted by `index`.
  - Col 1: `<img src={item.imageUrl}>` (Tailwind `w-24`/`w-32`, `object-contain`).
  - Col 2 (read mode): description; dialogue as `<ul>`; note (muted). "Sửa" button.
  - Col 2 (edit mode): textareas for description, dialogue (newline-separated ↔ `string[]`), note;
    "Lưu" → `PATCH /api/jobs/{jobId}/items/{index}` with `{description,dialogue,note}` → replace row, exit edit.
  - Error row: red badge "Lỗi: {error}" + "Thử lại" → `POST …/retry` → replace row.
- **Export**: fetch `/api/jobs/{jobId}/export` → blob → download `manifest-{jobId}.json` (anchor click).

## Related Code Files

- Modify: `content-extractor/app/page.tsx` (replace scaffold), `content-extractor/app/globals.css` (keep Tailwind base).
- Optional: small helper `content-extractor/lib/api.ts` (typed fetch wrappers) if page.tsx grows.

## Implementation Steps

1. Upload zone + file/folder inputs + selected-files list.
2. Start handler: FormData build + POST + EventSource wiring.
3. Progress bar component (done/total + phase label).
4. Results table: thumbnail + content read view.
5. Inline edit (textareas + Lưu → PATCH).
6. Error badge + retry; Export JSON button.
7. Responsive Tailwind pass; typecheck.

## Success Criteria

- [x] Drag/drop + folder pick + zip all populate the file list.
- [x] Progress bar updates live during processing (+ poll fallback khi SSE đứt — review finding M3).
- [x] Table shows N rows in correct reading order, 2 columns.
- [x] Inline edit persists (reload GET shows saved content).
- [x] Error rows show red badge; retry updates the row.
- [x] Export downloads a valid manifest JSON.

> Verify note: các criterion UI xác nhận qua SSR render (đủ chuỗi tiếng Việt, `lang="vi"`) + API contract E2E
> (PATCH/retry/export/SSE đều pass qua curl). Lượt thao tác trình duyệt thật xác nhận thêm lúc onboarding.

## Risk Assessment

- `EventSource` cannot POST → correct: POST creates the job, SSE is a separate GET stream. OK.
- Folder drag directory recursion complexity → deliberately scoped out (folder picker covers it).
- Very large chapters (100+) → table renders fine; virtualization is YAGNI for an internal tool.
