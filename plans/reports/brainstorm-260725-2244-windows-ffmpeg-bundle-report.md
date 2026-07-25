# Brainstorm: Bundle ffmpeg cho Windows (web Next.js)

**Ngày:** 2026-07-25 | **Trạng thái:** Đã chốt thiết kế | **Scope:** chỉ ffmpeg, không audit Windows toàn diện

## Vấn đề

Web app `content-extractor` gọi `spawn('ffmpeg'|'ffprobe')` từ system PATH. Windows không có sẵn → user bị chặn với thông báo tại `lib/ffmpeg.ts:40`: *"Không tìm thấy ffmpeg — cài ffmpeg trước (macOS: brew install ffmpeg)"* — vừa bắt cài thủ công vừa hướng dẫn sai OS.

Ảnh hưởng rộng hơn nút Render:
- **Phase TTS** cần `ffprobe` đo duration (`lib/tts.ts` → `probeDurationSec`) → hỏng từ TTS, không riêng render.
- **Phase Render** (`lib/render.ts:107` `assertFfmpeg()`) + toàn pipeline shot/concat/mux/burn subs.

Bối cảnh: user Windows chạy từ source (clone + `pnpm install` + dev/start), pnpm 11, engine ffmpeg dùng chung web UI + CLI (`scripts/render-video.mts`).

## Phương án đã đánh giá

| Phương án | Kết luận |
|---|---|
| **Bundle binary qua npm** | ✅ CHỌN — zero-setup sau `pnpm install`, hưởng chung cho CLI |
| Chỉ sửa thông báo per-OS (winget/scoop) | ❌ vẫn bắt cài thủ công — không xóa friction |
| Auto-download lần chạy đầu | ❌ thêm code download/verify/proxy, YAGNI so với npm bundle |
| WASM (ffmpeg.wasm) | ❌ không bàn — quá chậm cho render libx264 |

### Lựa chọn package (verify npm registry 2026-07-25)

| Package | ffmpeg ver | Cập nhật | Ghi chú |
|---|---|---|---|
| **`ffmpeg-static` 5.3.0** ✅ | 6.x | 11/2025 | postinstall download → cần pnpm `allowBuilds` |
| **`@ffprobe-installer/ffprobe` 2.1.2** ✅ | ffprobe 5.x | 2023 | optionalDeps per-platform, không build script |
| `ffmpeg-ffprobe-static` 6.1.2-rc.1 | 6.1 | 10/2024 | bản -rc, fork ít dùng — loại |
| `@ffmpeg-installer/ffmpeg` 1.1.0 | **4.1 (2019)** | 2022 | quá cũ; code đã tinh chỉnh theo parser ffmpeg 8 (`burnSubs` named option) — loại |

Chênh ffmpeg 6 / ffprobe 5: OK — ffprobe chỉ đo duration + liệt kê stream.

## Thiết kế đã chốt

**Thứ tự resolve binary:** `FFMPEG_PATH`/`FFPROBE_PATH` (env) → system PATH → bundled.

Lý do PATH trước bundled: macOS đang chạy brew ffmpeg 8 — engine đã kiểm chứng (fix zoompan supersample, libass đủ). Bundled-first sẽ âm thầm hạ macOS xuống 6.x → rủi ro regression. Thứ tự này = macOS không đổi hành vi, Windows tự rơi xuống bundled.

**File đụng khi implement:**
- `lib/ffmpeg.ts` — điểm tập trung duy nhất gọi runCommand('ffmpeg'|'ffprobe'). Thêm resolver bin (cache per-process, probe `-version` 1 lần), mọi hàm dùng bin resolved. Message ENOENT per-OS (win32: `winget install ffmpeg`; darwin: brew; kèm gợi ý FFMPEG_PATH) — chỉ còn hiện khi PATH lẫn bundled đều thiếu.
- `package.json` — thêm `ffmpeg-static` + `@ffprobe-installer/ffprobe` (dependencies).
- `pnpm-workspace.yaml` — `allowBuilds: ffmpeg-static: true` (quirk pnpm 11 đã biết: allowBuilds, KHÔNG phải onlyBuiltDependencies).
- Docs + `.env.example` — ghi chú override FFMPEG_PATH/FFPROBE_PATH.

Import `ffmpeg-static` kiểu lazy/try — thiếu package (platform lạ, download fail) không được crash module load.

## Rủi ro & giảm nhẹ

1. **libass trong build Windows bundled** (burn phụ đề): cần verify trên máy Windows thật; đã có `hasFilter('subtitles')` degrade sẵn — worst case MP4 vẫn ra + SRT rời.
2. **postinstall download bị proxy chặn:** fallback tự nhiên — cài ffmpeg vào PATH vẫn được resolver nhận.
3. **Concat list path backslash trên Windows:** concat demuxer đọc literal trong quote đơn, dự kiến OK — thuộc checklist test Windows.
4. Font tiếng Việt burn subs trên Windows: Arial hệ thống có glyph VN — ngoài scope, note để checklist.

## Acceptance criteria

- Windows sạch (không cài ffmpeg): `pnpm install` xong → TTS + Render MP4 chạy ngay, không thông báo bắt cài.
- macOS: hành vi giữ nguyên (vẫn dùng brew ffmpeg 8 qua PATH).
- Thiếu cả PATH + bundled: message lỗi đúng OS, có hướng dẫn cài + env override.
- `pnpm run test:unit` + `test:render` pass trên macOS như trước.

## Câu hỏi chưa chốt

- Build ffmpeg-static win32 có libass không — verify lúc test Windows thật (không chặn implement nhờ hasFilter degrade).
- Có cần pin exact version `ffmpeg-static` để tránh binary trôi version giữa các máy? (đề xuất: pin minor trong plan).
