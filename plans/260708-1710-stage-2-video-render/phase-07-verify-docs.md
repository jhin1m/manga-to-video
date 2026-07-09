---
phase: 7
title: "Verify + docs"
status: completed
priority: P2
dependencies: [4, 6]
effort: ""
---

# Phase 7: Verify + docs

## Overview

Test đầu-cuối không tốn API thật (mock ElevenLabs + mock SCRIPT_MODEL), unit cho module logic thuần, e2e render một sample nhỏ ra MP4, và cập nhật docs (README Stage 2, .env.example, package.json). Bám văn hoá `scripts/verify-*.mts` + `mock-openai-vision.mjs` sẵn có.

## Requirements

- **Functional:** unit + e2e xanh bằng mock; sample bundle → MP4 hợp lệ.
- **Non-functional:** CI không gọi API/tiền thật; test nhanh; docs khớp hành vi thật.

## Architecture

**Mocks** (mẫu `scripts/mock-openai-vision.mjs`):
- `scripts/mock-elevenlabs.mjs` — http server trả 1 mp3 tí hon cố định cho `POST /v1/text-to-speech/{voiceId}` (độ dài biết trước để assert timeline).
- `scripts/mock-script-model.mjs` — trả JSON `{segments:[...]}` cố định cho `/chat/completions` (hoặc mở rộng mock-openai hiện có).

**Unit** `scripts/verify-script.mts` (mẫu `verify-narration.mts`, eq/ok, tsx):
- `generateScript` parse mock → segments; shotIndices ngoài biên bị loại.
- `buildTimeline`: Σ dur_seg, phân bổ shots theo weight, sàn; `toSrt` số caption = segment; `toScriptManifest` shape/clone.
- `bundle` round-trip; `kenburns` hướng theo region/aspect (assert nhánh pan/zoom/blur-fill).
- TTS cache: MISS ghi, HIT không fetch (mock đếm request).

**E2E** `scripts/verify-render.mts` (hoặc mở rộng `e2e-storyboard.mts`):
- Dựng sample: vài band ảnh sọc (mẫu fixture e2e) + ScriptManifest 2–3 segment (có 1 segment 2 shot) → `writeBundle`.
- Chạy `render-video.mts` (env trỏ mock ElevenLabs, `VISION/ SCRIPT` mock) → assert: MP4 tồn tại, `ffprobe` có video+audio, tổng thời lượng ≈ Σ dur_seg (dựa mp3 mock đã biết), `.srt` số dòng = segment, `timeline.json` shape.
- `--dry-run` → chỉ timeline/srt, không gọi mock TTS.

**Docs:**
- `README.md`: mục "Stage 2 — Kịch bản AI + Video"; luồng; bảng ENV (`SCRIPT_MODEL`, `ELEVENLABS_*`, `TTS_CACHE_DIR`, aspect/subs/bgm flags); prerequisite ffmpeg; cập nhật "Known Limitations" (import ENV-coupling đã gỡ bằng bundle).
- `.env.example`: nhóm SCRIPT_* + ELEVENLABS_*.
- `package.json`: `test:script`, `test:render`, `render`; cập nhật `test:unit` gộp verify-script.

## Related Code Files

- Create: `content-extractor/scripts/mock-elevenlabs.mjs`, `content-extractor/scripts/mock-script-model.mjs`
- Create: `content-extractor/scripts/verify-script.mts`, `content-extractor/scripts/verify-render.mts`
- Modify: `content-extractor/README.md`, `content-extractor/.env.example`, `content-extractor/package.json`

## Implementation Steps

1. Mock ElevenLabs + mock SCRIPT_MODEL server.
2. `verify-script.mts`: unit script/timeline/srt/bundle/kenburns/tts-cache.
3. `verify-render.mts`: sample bundle → render → assert MP4/streams/duration/srt/timeline.
4. package.json scripts (`test:script`, `test:render`, `render`) + gộp `test:unit`.
5. README Stage 2 + .env.example; cập nhật Known Limitations.

## Success Criteria

- [x] `npm run test:unit` (gồm verify-script) xanh — không mạng.
- [x] `npm run test:render` (mock) xanh: MP4 hợp lệ, duration/srt/timeline khớp.
- [x] Không test nào gọi ElevenLabs/SCRIPT_MODEL thật.
- [x] README mô tả đúng luồng + ENV + prerequisite ffmpeg; `.env.example` đủ biến.
- [x] Whole-plan: thuật ngữ (segment/shot/bundle/ScriptManifest) nhất quán mọi phase.

## Risk Assessment

- **Mock lệch API thật ElevenLabs** → theo sát contract (`audio/mpeg` body); ghi chú khác biệt; 1 lần smoke thủ công với key thật ngoài CI.
- **ffmpeg vắng trên CI** → e2e render đánh dấu skip nếu thiếu ffmpeg (báo rõ), unit vẫn chạy.
- **Sample nặng** → fixture band nhỏ, narration ngắn để test nhanh.
