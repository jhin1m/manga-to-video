---
phase: 3
title: "Verify + docs"
status: completed
priority: P2
effort: "1h"
dependencies: [2]
---

# Phase 3: Verify + docs

## Overview
Chốt kiểm định trên macOS (regression) + checklist test máy Windows thật, cập nhật docs/env example.

## Requirements
- Functional: bộ test hiện có pass; docs phản ánh cơ chế resolve mới.
- Non-functional: không thêm bước setup nào cho user macOS hiện tại.

## Architecture
Không đổi kiến trúc — phase kiểm định + tài liệu.

## Related Code Files
- Modify: `content-extractor/.env.example` — thêm `# FFMPEG_PATH=` / `# FFPROBE_PATH=` (optional override, comment mô tả thứ tự resolve)
- Modify: `content-extractor/README.md` — mục setup: bỏ/giảm yêu cầu "cài ffmpeg" thành "tự bundle; cài hệ thống chỉ khi muốn dùng bản riêng (khuyến nghị macOS giữ brew ffmpeg 8)"
- Modify (nếu repo có ghi prerequisite ffmpeg): `docs/*` — grep "ffmpeg" trong docs/ và cập nhật chỗ nào nói phải cài tay

## Implementation Steps
1. macOS: `pnpm run test:unit` + `pnpm run test:render` + render 1 job thật qua UI (smoke) — xác nhận vẫn dùng PATH ffmpeg.
2. macOS giả lập Windows-thiếu-ffmpeg: chạy test resolver với PATH rỗng → bundled hoạt động end-to-end (`assertFfmpeg` + `renderShot` 1 shot nhỏ).
3. Cập nhật `.env.example`, `README.md`, docs liên quan.
4. Ghi checklist Windows thật vào mục dưới (không chặn merge — thực hiện khi có máy).

## Success Criteria
- [x] test:unit + test:render pass macOS
- [x] Render smoke qua bundled binary (PATH rỗng) ra MP4 hợp lệ (probeStreams thấy video+audio)
- [x] Docs + .env.example cập nhật, không còn chỗ nào bắt "cài ffmpeg trước" vô điều kiện

## Checklist test trên máy Windows thật (hậu-merge, khi có máy — CHƯA thực hiện)
- [ ] Clone + `pnpm install` sạch (không cài ffmpeg) → chạy đủ pipeline upload → TTS → Render MP4
- [ ] Burn phụ đề: build ffmpeg-static win32 có libass không? Nếu thiếu → xác nhận `hasFilter('subtitles')` degrade đúng (MP4 + SRT rời, có thông báo)
- [ ] Font tiếng Việt phụ đề (Arial hệ thống) hiển thị đủ dấu
- [ ] Concat list path backslash (`file 'C:\...'`) nối shot đúng
- [ ] Hủy render giữa chừng (abort) kill được ffmpeg.exe, không để zombie/lock file

## Risk Assessment
- Không có máy Windows lúc merge: chấp nhận — thiết kế PATH-first + degrade đã giới hạn blast radius; checklist trên là gate trước khi công bố "hỗ trợ Windows".
