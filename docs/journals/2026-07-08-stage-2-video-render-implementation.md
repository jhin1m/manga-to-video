# 2026-07-08 — Stage 2 toàn bộ 7 phase: kịch bản AI → preview UI → CLI render MP4 + .srt

## Bối cảnh

Sau Stage 1.5 (manifest storyboard), cần biến band content thành MP4 xem được: AI biên kịch (gộp/tách panel thành ScriptSegment), UI duyệt/tinh chỉnh + BGM, CLI render ffmpeg từ bundle.zip.

## Triển khai

Một phiên cook auto, 7 phase đều xong:

1. **AI Biên kịch** (`lib/script.ts`): model text gộp content → tách thành `ScriptSegment[]` (mỗi narration 1+ shot), vision fallback nếu band null (crop → describe), sync khít audio TTS.
2. **UI duyệt kịch bản** (`app/storyboard/[jobId]/script-panel.tsx` + 3 route segment): duyệt/sửa narration, tách/gộp index-based, preview live caption tách theo câu.
3. **Bundle + TTS + render-config** (`lib/bundle.ts`, `lib/tts.ts`): export bundle.zip = manifest + band ảnh + render-config.json; TTS ElevenLabs cache atomic (đĩa) + dedup key; 3 model tier qua ENV.
4. **Preview UI video** (`app/video/[jobId]`): phát duyệt Ken Burns (CSS approx), overlay caption tách câu, BGM duck, live canh giờ ≈ MP4.
5. **CLI render lõi** (`lib/ffmpeg.ts`, `lib/timeline.ts`): ffmpeg spawn wrapper + pure timeline (mọi frame × câu), Ken Burns per-shot (crop theo t thay zoompan chống jitter), phụ đề tách mốc thời gian.
6. **CLI ghép cuối** (`lib/kenburns.ts`, `scripts/render-video.mts`): filtergraph Ken Burns (pan + zoom + blur-fill 16:9), concat + mux + BGM duck.
7. **Verify + test** (e2e-script-video.mts, test:render, test:unit): 132 unit assert ALL_PASS, RENDER_ALL_PASS (MP4 thật 9:16+16:9, TTS cache HIT), E2E_ALL_PASS.

## Khó khăn thực

1. **ffmpeg 8 parser:** subtitles filter từ chối `subtitles='path':force_style=…` — phải dùng `filename=` named option (document ffmpeg mô tả sai).
2. **Homebrew ffmpeg SLIM:** bottle máy này thiếu libass/freetype → không burn-in được. Giải pháp: degrade có cảnh báo, test thích ứng theo `hasFilter('subtitles')`, giữ .srt rời.
3. **Path traversal từ bundle:** jobId/segId/bgm filename từ bundle.zip đi thẳng vào `path.join` + `rm -rf` → fix sanitize `readBundle` + workDir per-run (chống traversal + render song song).
4. **Code review:** 1 H + 3 M + 7 L → đã fix: identity-check dims, clamp `segmentOverrides ≥ audio+pad`, font sanitize, cache key NUL, fetch timeout.

## Kết quả test

- `tsc` + `eslint` + `next build` sạch.
- `test:unit` 4 suite ALL_PASS (132 assert gồm verify-script).
- `test:render` RENDER_ALL_PASS (mock ElevenLabs, MP4 9:16 + 16:9 + BGM + dry-run không gọi API).
- `test:e2e` + `test:e2e-video` (34 assert route Stage 2) ALL_PASS, không regression Stage 1/1.5.

## Quyết định ghi

- **timeline.ts thuần:** UI + CLI dùng chung logic tách câu/canh giờ (caption preview ≡ .srt).
- **TTS nhạc trưởng:** `segmentOverrides` bị clamp ≥ `audio+pad` giữ bất biến sync.
- **Pan dùng crop:** thay zoompan chống jitter; zoom mới dùng zoompan supersample.

## Chưa commit

Thay đổi nằm ở working tree, chờ lệnh.

---

**Status:** DONE
**Summary:** Toàn bộ Stage 2 (7 phase) implement + test xanh một phiên; 3 issue thực (ffmpeg parser, libass thiếu, path traversal) đã fix/degrade.
