# PM Report — UI Unification shadcn + Project File (.mtvproj)

Date: 2026-07-09 · Plan: `plans/260708-2300-ui-unification-shadcn-project-file/` · Status: **completed** (4/4 phase)

## Phases

| Phase | Kết quả |
|-------|---------|
| 1. Foundation & Shell | shadcn/ui (radix-nova, Tailwind v4 CSS-first) + app shell (top bar Lưu/Mở project, stepper 4 bước gating theo readiness, theme toggle next-themes class-based, Sonner toast). Token `--ai`/`--success` + Button variant `ai`/`success`. |
| 2. Project file .mtvproj | `lib/project.ts` (write/read + validate version, path-safety, biên region, index liền mạch) · `GET /api/project/export` · `POST /api/project/import` (hydrate Job+Storyboard+Script+Audio, audio ghi về `TTS_CACHE_DIR/<key>.mp3` để cache HIT) · gỡ route import/export storyboard cũ · `scripts/verify-project.mts` (32 assert). |
| 3. Reskin Extract + Video | `app/page.tsx` + `app/video/[jobId]/page.tsx` sang shadcn, lỗi → toast, gỡ block reload cũ. Logic SSE/poll/player/Ken Burns/timeline/synth/export không đổi (khung player containerType/cqw/cqh giữ nguyên). |
| 4. Storyboard + Script route | Master–detail (list trái + chi tiết phải) + `components/region-cropper.tsx` (kéo-vẽ/di chuyển, quy đổi tỉ lệ, numeric "Nâng cao" 2 chiều) · `app/script/[jobId]/page.tsx` tách từ ScriptPanel · readiness publish vào project-context. |

## Verification (tester subagent — reports/tester-full-suite.md)

243 assert PASS: lint ✓ · build ✓ · test:unit (110) ✓ · e2e-storyboard (57) ✓ · e2e-script-video (26) ✓ · test:render MP4 (23, ffmpeg) ✓.

## Code review (reports/code-review-ui-unification-mtvproj.md)

5/5 acceptance criteria đạt; path-safety .mtvproj xác nhận an toàn. Findings đã fix ngay trong phiên:
- **H1** draft stale sau compose → thêm `draftTouched` + auto-resync khi chưa chạm (storyboard page).
- **M1** cropper kéo vượt mép bị tịnh tiến → clamp toạ độ pointer trong `toWorking`.
- **M2** thiếu check biên `shot.region` + dims dương trong `readProject` → bổ sung + 2 test case mới.
- Low: onPointerCancel cropper, newline globals.css. Low còn lại (ghi cache không atomic, không cap size zip, amber hardcode) ghi nhận — chấp nhận theo threat model tool nội bộ.

Sau fix: lint/build/verify-project/e2e-storyboard chạy lại PASS.

## Nợ/ghi chú

- `.mtvproj` KHÔNG chứa RenderConfig/BGM (2 thứ này sống trong state trang Video, server không lưu) — mở lại project dùng config mặc định. Nâng cấp sau nếu cần (PROJECT_VERSION bump).
- Resize handle 4 góc cho cropper chưa làm (ghi ở Known Limitations README).
- Chưa commit — chờ người dùng quyết (worktree đang có cả thay đổi Stage 2 phiên trước).
