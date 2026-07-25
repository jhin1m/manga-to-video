# 2026-07-25 — Bundle ffmpeg cho Windows

**Commit:** `999fc63` | **Plan:** `plans/260725-2252-bundle-ffmpeg-cho-windows-web-nextjs/`

## Bối cảnh

Windows clone sạch bị chặn ngay từ phase TTS vì `lib/ffmpeg.ts` spawn `ffmpeg`/`ffprobe` từ PATH, message lỗi lại chỉ hướng dẫn macOS. Chốt ở brainstorm: bundle binary qua npm, thứ tự resolve `env → PATH → bundled` (PATH-first để macOS đang chạy brew ffmpeg 8 không đổi engine).

## Quyết định & lý do

- **`ffmpeg-static` 5.3.0 + `@ffprobe-installer/ffprobe` 2.1.2** thay vì `@ffmpeg-installer` (ffmpeg 4.1/2019, quá cũ so với pipeline đã tinh chỉnh theo parser ffmpeg 8) hay `ffmpeg-ffprobe-static` (bản -rc).
- **PATH trước bundled**: máy đã cài ffmpeg giữ nguyên engine; đổi thứ tự là product call, không phải mặc định kỹ thuật.
- **Env override là cứng**: `FFMPEG_PATH` sai → lỗi rõ (kèm mã ENOENT/EACCES/EPERM/EISDIR), không silent fallback.

## Vấp phải

1. **Postinstall ẩn**: `@ffprobe-installer/darwin-arm64` có script `chmod u+x ffprobe` — pnpm 11 chặn im lặng, glob `'@ffprobe-installer/*'` KHÔNG được allowBuilds chấp nhận, phải liệt kê đủ 8 platform package tường minh.
2. **Grep sót đuôi `.mjs`**: 2 mock TTS vẫn spawn literal `ffmpeg` — code-reviewer bắt được (M1): trên Windows sạch test suite sẽ crash thay vì SKIP như trước (regression tệ hơn hiện trạng). Fix bằng `scripts/mock-ffmpeg-bin.mjs` (env → bundled → PATH, standalone không import được TS).
3. **serverExternalPackages bắt buộc**: 2 package tính path binary từ `__dirname` — bundle vào server chunk là path sai (cùng pattern `pdf-to-img` đã có).

## Phát hiện đáng giữ

- **Brew ffmpeg 8.1.2 trên máy dev THIẾU libass** (burn phụ đề đang degrade), còn bundled 6.0 CÓ — muốn burn ngay: đặt `FFMPEG_PATH` trỏ binary bundled.
- ffprobe chênh version giữa platform (4.4.1 darwin-arm64 ↔ 5.1 win32) đo duration lệch ~2.7% cùng file — tolerance test hấp thụ, nhưng timeline không byte-identical cross-platform.
- Verify m9 rẻ nhất: chạy đủ `next build` + `next start` + e2e với `PATH=<node>:/usr/bin:/bin` — chứng minh dynamic import trong Next runtime thật, không cần máy Windows.

## Còn mở

Checklist máy Windows thật trong `phase-03-verify-docs.md` (libass build win32, concat backslash, font VN, abort kill). License: ffmpeg-static là GPL-3.0 — cân nhắc nếu sau này phân phối bản đóng gói.
