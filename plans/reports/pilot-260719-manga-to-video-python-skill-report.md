# Report nghiệm thu: Port manga-to-video engine sang Python skill

Plan: `plans/260719-2024-port-manga-to-video-engine-sang-python-skill-tu-chua/`
Ngày: 2026-07-19 | Corpus: `~/Downloads/Vừa Gả Đã Làm Mẹ Kế Của Ba Nhóc Con Chap 1.1...` (38 ảnh)

## Kết quả 3 gate nghiệm thu

| Gate | Ngưỡng | Đo được | Kết quả |
|---|---|---|---|
| **#1 Parity banding** | cuts ±2px, cùng số band | **0px lệch** cả 26 cut, 27/27 band, cả 3 mode (split-on-ts-canvas / stitch-from-ts-jpegs / full-pipeline); natural sort khớp | **PASS** |
| **#2 Parity shake** | p95 ≤ 1.1 × baseline TS (1.0785px) | Pilot: **p95 0.0796px**, median 0.0267px (477 mẫu, 4 cửa sổ) vs baseline TS p95 0.9805px, median 0.1847px | **PASS** (tốt hơn ~12×) |
| **#3 Pilot A-Z** | video + SRT đủ, checklist kịch bản, resume test | Video 175.02s 1920×1080 (video+audio stream), SRT 41 caption, 15 segment phủ đủ 27 slice; resume test PASS | **PASS** |

Bonus: chuỗi filter kenburns Python **byte-identical** với TS trên 10 case (pan-v/pan-h/zoom/static/blur-fill/reverse/clamp/region).

## Số liệu pilot

- Ingest: 38 ảnh → canvas 720×50671 → 27 slice (27 trimmed), deterministic (2 lần identical).
- Vision: 4 batch (7+7+7+6) song song, 27/27 content pass schema, đúng ngôi ba. Batch cuối chạy bằng agent `manga-vision-reader` thật (3 batch đầu dùng fallback general-purpose + đọc agent file vì registry chỉ load agent mới ở session mới — cơ chế chuẩn, session sau không cần fallback).
- Script: 15 segment, ước tính 233s đọc; validate pass ngay lần đầu.
- TTS CapCut: 15/15 synth OK (~2 phút), tổng audio 167.5s, device identity seed từ app TS (không đốt identity). Chạy lại = 100% cache hit.
- Render 16:9: 27 shot, 69s wall-clock. ffmpeg hệ thống thiếu libass → tự degrade bỏ burn-in, vẫn xuất `.srt` rời (đúng thiết kế, giống TS).
- Kill/resume: sau vision trước tts, `ingest --resume` báo đúng `ingest=done, content=done (27/27), script=pending` — session mới tiếp đúng chỗ, không mất công đoạn.

## Đối chiếu kịch bản với z.ai

**Phát hiện**: mốc `content-extractor/output-16x9.{mp4,srt,timeline.json}` là chương truyện KHÁC
(fantasy "Kajin", 789s/200 caption) — KHÔNG phải corpus 38 slice này. So từng câu là bất khả thi;
so được về quy tắc hình thức:

| Checklist | Bản Python (pilot) | Bản z.ai (tham chiếu) |
|---|---|---|
| Ngôi ba toàn bộ lời kể | ✅ 15/15 segment | ⚠️ có caption lộ ngôi nhất ngoài ngoặc kép trọn vẹn (caption 6-7, 11-12 — tách câu làm ngoặc kép lơ lửng) |
| Xưng hô ngôi 1/2 chỉ trong ngoặc kép | ✅ | ⚠️ như trên |
| Phủ đủ index không sót/lặp | ✅ validate pass (27/27) | không kiểm được (khác chương) |
| Mạch truyện liền theo nhân quả | ✅ (mở màn kiếp trước → chết → trọng sinh → đấu trí hôn sự → hồi tưởng → lời thề → cưới đôi) | tham chiếu hình thức |

Gate #2 (shake) không phụ thuộc nội dung chương nên vẫn valid khi so 2 video khác chương.

## Artifacts

- Workdir pilot: `~/Downloads/vua-ga-chap-1.1-video/` (slices, content, script.json, audio, out/)
- Video: `~/Downloads/vua-ga-chap-1.1-video/out/video.mp4` + `video.srt` + `timeline.json`
- Baseline + harness: `tools/parity-port/` (baseline-cuts.json commit được; stitched.png + downscaled/ đã gitignore — dựng lại bằng `dump-cuts.mts`)
- Skill: `~/.claude/skills/manga-to-video/` | Agent: `~/.claude/agents/manga-vision-reader.md`

## Khác biệt chủ ý so với TS (đã ghi trong header file)

1. Default TTS provider = `capcut` (TS: elevenlabs) — không cần API key.
2. ingest.py có bước trim lề ink-bbox tự động sau split (TS để nút bấm tay trong UI).
3. Cache audio per-workdir `audio/` (TS: cache toàn cục `.cache/tts`) — theo hợp đồng workdir.

## Unresolved

- ffmpeg hệ thống (8.1.2 brew) thiếu libass → burn-in không hoạt động trên máy này; muốn đốt phụ đề cần cài bản ffmpeg có libass. Skill degrade đúng thiết kế.
- 3/4 vision batch của pilot dùng fallback general-purpose (giới hạn registry trong session tạo agent) — cần 1 lần chạy full ở session mới để xác nhận UX chuẩn (batch 4 đã chứng minh agent thật hoạt động).
