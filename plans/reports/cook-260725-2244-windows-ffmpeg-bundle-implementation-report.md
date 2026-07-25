# Report: Bundle ffmpeg cho Windows — triển khai xong

**Ngày:** 2026-07-25 | **Plan:** `plans/260725-2252-bundle-ffmpeg-cho-windows-web-nextjs/` | **Brainstorm:** `brainstorm-260725-2244-windows-ffmpeg-bundle-report.md`

## Kết quả

Windows clone sạch giờ chỉ cần `pnpm install` là chạy đủ TTS + Render MP4 — không còn thông báo bắt cài ffmpeg. macOS giữ nguyên hành vi (PATH-first, brew ffmpeg 8.1.2 vẫn được chọn).

## Thay đổi

| File | Nội dung |
|---|---|
| `lib/ffmpeg.ts` | Resolver `env FFMPEG_PATH/FFPROBE_PATH → PATH → bundled` (cache promise per-process, lazy import null-safe); 2 helper mới `runFfmpeg`/`runFfprobe`; mọi call site nội bộ chuyển qua helper; message lỗi per-OS, bao ENOENT/EACCES/EPERM/EISDIR |
| `scripts/mock-ffmpeg-bin.mjs` (mới) | Bin ffmpeg cho mock TTS standalone (env → bundled → PATH) |
| `scripts/mock-elevenlabs.mjs`, `scripts/mock-capcut.mjs` | spawn literal `'ffmpeg'` → `mockFfmpegBin()` (fix M1 review) |
| `scripts/verify-render.mts` | `runCommand('ffmpeg',…)` → `runFfmpeg`; message SKIP hết stale brew |
| `scripts/render-video.mts` | Comment header hết yêu cầu brew |
| `package.json` | +`ffmpeg-static ~5.3.0` (ffmpeg 6.0), +`@ffprobe-installer/ffprobe ~2.1.2` (ffprobe 4.4.1–5.2 theo platform) |
| `pnpm-workspace.yaml` | `allowBuilds`: ffmpeg-static + 8 platform package `@ffprobe-installer/*` (postinstall = chmod u+x) |
| `next.config.ts` | `serverExternalPackages` += 2 package (path binary tính từ `__dirname`, không được bundle) |
| `README.md`, `.env.example` | Cơ chế resolve + override + note download ~45MB lúc install |

## Verify (đều PASS)

- `tsc --noEmit`, `eslint` sạch; `test:unit` PASS.
- **macOS bình thường:** `test:render` PASS, smoke xác nhận dùng brew ffmpeg 8.1.2 (PATH-first — không đổi hành vi).
- **Giả lập Windows sạch** (PATH chỉ có node, không ffmpeg): `test:render` PASS thuần bundled; e2e bundled nhỏ (renderShot+audio+mux → MP4 video+audio); **`test:e2e-video` PASS qua `next build` + `next start :3105` thật** — chứng minh dynamic import + serverExternalPackages hoạt động trong Next runtime (finding m9).
- Env override sai → lỗi rõ kèm mã lỗi + hướng dẫn, không silent fallback.

## Code review (subagent) — đã xử lý

- **M1** mock TTS còn spawn literal → crash test trên Windows sạch: FIXED (helper mới, verify lại 3 tầng).
- **M2** chỉ ENOENT có message thân thiện: FIXED (thêm EACCES/EPERM/EISDIR + mã lỗi trong message).
- m3 comment cache quá lời: sửa comment đúng thực tế (đã resolve thì giữ tới hết process).
- m6 cần mạng lúc install: note vào README (fallback: dùng ffmpeg PATH).
- m8 allowBuilds thiếu linux-arm/ia32: bổ sung.
- Nits (winget Gyan.FFmpeg, stale brew, cast thừa): sửa hết.
- **Không sửa (chủ đích):** m4 PATH-first giữ nguyên (quyết định thiết kế đã duyệt ở brainstorm — xem "Điểm đáng chú ý"); m5 ffprobe chênh version giữa platform (~2.7% lệch duration đo, tolerance test hấp thụ) — ghi nhận, không chặn; m7 ffmpeg-static là GPL-3.0 (repo private, chỉ thành vấn đề nếu sau này phân phối bản đóng gói).

## Điểm đáng chú ý cho user

1. **Máy macOS này brew ffmpeg 8.1.2 THIẾU libass** (burn phụ đề đang degrade thành .srt rời), trong khi bản bundled 6.0 CÓ libass. Muốn burn phụ đề ngay trên máy này: đặt `FFMPEG_PATH` trỏ tới binary bundled (path in bằng `node -p "require('ffmpeg-static')"`), hoặc `brew install ffmpeg` bản full. Đổi thứ tự resolve (bundled-first) là lựa chọn sản phẩm — chưa làm vì trái quyết định PATH-first đã chốt.
2. Checklist test máy Windows thật còn mở trong `phase-03-verify-docs.md` (libass build win32, concat backslash, font VN, abort kill ffmpeg.exe) — gate trước khi công bố "hỗ trợ Windows" chính thức.

## Unresolved questions

- Có định phân phối bản đóng gói (installer) sau này không? → ảnh hưởng license GPL-3.0 của ffmpeg-static (m7).
- Có muốn burn-in tự fallback sang bundled khi ffmpeg PATH thiếu libass (m4) không? Cần key `filterListCache` theo binary nếu làm.
