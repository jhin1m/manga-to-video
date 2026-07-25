---
phase: 1
title: "Dependencies + pnpm allowBuilds + next config"
status: completed
priority: P1
effort: "30m"
dependencies: []
---

# Phase 1: Dependencies + pnpm allowBuilds + next config

## Overview
Thêm 2 package chứa binary ffmpeg/ffprobe theo platform, mở khóa build script cho pnpm 11, và loại 2 package khỏi server bundle của Next để đường dẫn binary trong node_modules không bị sai khi bundle.

## Requirements
- Functional: sau `pnpm install`, `node -e "console.log(require('ffmpeg-static'))"` in ra đường dẫn binary tồn tại; tương tự `@ffprobe-installer/ffprobe` (`.path`).
- Non-functional: không thêm package nào khác; pin version tránh binary trôi giữa máy.

## Architecture
- `ffmpeg-static` (5.3.x, ffmpeg 6.x): postinstall script download binary đúng platform → pnpm 11 chặn mặc định, cần `allowBuilds`.
- `@ffprobe-installer/ffprobe` (2.1.x, ffprobe 5.x): optionalDependencies per-platform, KHÔNG có build script.
- Hai package export path tính từ `__dirname` trong node_modules → nếu Next bundle vào server chunk thì path sai. Repo đã có tiền lệ xử lý đúng: `serverExternalPackages: ['pdf-to-img']` trong `next.config.ts`.

## Related Code Files
- Modify: `content-extractor/package.json` — dependencies: `"ffmpeg-static": "~5.3.0"`, `"@ffprobe-installer/ffprobe": "~2.1.2"`
- Modify: `content-extractor/pnpm-workspace.yaml` — dưới mục `allowBuilds:` có sẵn, thêm `ffmpeg-static: true` (đúng quirk pnpm 11: allowBuilds, KHÔNG phải onlyBuiltDependencies)
- Modify: `content-extractor/next.config.ts` — `serverExternalPackages: ['pdf-to-img', 'ffmpeg-static', '@ffprobe-installer/ffprobe']`

## Implementation Steps
1. Thêm 2 dependency vào `package.json` (pin `~`).
2. Thêm `ffmpeg-static: true` vào `allowBuilds` trong `pnpm-workspace.yaml`.
3. `pnpm install` — xác nhận không còn cảnh báo `ERR_PNPM_IGNORED_BUILDS`, binary được download.
4. Cập nhật `serverExternalPackages` trong `next.config.ts`.
5. Smoke: in đường dẫn 2 binary, chạy `<binary> -version` trực tiếp.

## Success Criteria
- [x] `pnpm install` sạch, binary ffmpeg (bundled) chạy được `-version` trên macOS
- [x] `@ffprobe-installer/ffprobe` trả `.path` tồn tại
- [x] `next.config.ts` có đủ 3 external packages

## Risk Assessment
- Download postinstall bị chặn mạng → binary null: resolver phase 2 phải chịu được `require` trả null/throw (lazy + try/catch), user vẫn dùng được ffmpeg PATH.
- pnpm allowBuilds sai cú pháp → build script bị bỏ qua im lặng: bước 3 phải kiểm binary tồn tại thật, không chỉ install exit 0.
