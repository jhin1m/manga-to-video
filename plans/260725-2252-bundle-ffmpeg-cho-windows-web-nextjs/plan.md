---
title: "Bundle ffmpeg cho Windows (web Next.js)"
description: "Bundle ffmpeg/ffprobe qua npm để Windows chạy TTS + Render không cần cài tay; macOS giữ nguyên hành vi (PATH-first)"
status: completed
priority: P1
effort: "4h"
tags: [windows, ffmpeg, cross-platform]
created: 2026-07-25
---

# Bundle ffmpeg cho Windows (web Next.js)

## Overview

Web `content-extractor` spawn `ffmpeg`/`ffprobe` từ system PATH → Windows thiếu là hỏng từ phase TTS (`probeDurationSec`) và Render, kèm thông báo chỉ hướng dẫn macOS (`lib/ffmpeg.ts:40`). Giải pháp đã chốt ở brainstorm: bundle binary qua npm, resolve theo thứ tự `env → system PATH → bundled`.

Nguồn: [brainstorm report](../reports/brainstorm-260725-2244-windows-ffmpeg-bundle-report.md)

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Windows sạch: `pnpm install` xong là TTS + Render MP4 chạy, không bắt cài ffmpeg | P1 |
| 2 | macOS không đổi hành vi (vẫn dùng brew ffmpeg 8 qua PATH) | P1 |
| 3 | Message lỗi ENOENT đúng per-OS + hỗ trợ override `FFMPEG_PATH`/`FFPROBE_PATH` | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Dependencies + pnpm allowBuilds + next config](./phase-01-start.md) | Done |
| 2 | [Phase 2: Bundle binary + resolver](./phase-02-bundle-binary-resolver.md) | Done |
| 3 | [Phase 3: Verify + docs](./phase-03-verify-docs.md) | Done (checklist máy Windows thật còn mở — hậu-merge) |

## Success Criteria

- [x] `lib/ffmpeg.ts` resolve bin: env → PATH → bundled, cache per-process
- [x] macOS: `pnpm run test:unit` + `pnpm run test:render` pass, vẫn dùng ffmpeg PATH (smoke in ffmpeg 8.1.2 brew)
- [x] Giả lập thiếu PATH (PATH rỗng khi spawn) → fallback bundled hoạt động trên macOS (test:render + e2e-video PASS thuần bundled)
- [x] Thiếu cả PATH + bundled → message per-OS (win32: winget, darwin: brew) + gợi ý FFMPEG_PATH; ENOENT/EACCES/EPERM/EISDIR đều có hướng dẫn
- [x] Checklist test máy Windows thật ghi trong phase 3 (libass, concat backslash, font VN) — chưa thực hiện, chờ máy thật

<!-- slug: bundle-ffmpeg-cho-windows-web-nextjs -->
