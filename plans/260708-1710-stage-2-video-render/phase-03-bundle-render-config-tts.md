---
phase: 3
title: "Bundle + render-config + TTS"
status: completed
priority: P1
dependencies: [1]
effort: ""
---

# Phase 3: Bundle + render-config + TTS

## Overview

Ba hợp đồng/hạ tầng nối Preview UI ↔ CLI: **bundle zip** (self-contained hand-off), **`render-config.json`** (tham số render), và **`lib/tts.ts`** ElevenLabs với **cache đĩa dùng chung** (preview synth 1 lần, CLI tái dùng). Gỡ dứt điểm "Known Limitation" import phụ thuộc ENV.

## Requirements

- **Functional:** đóng/mở bundle; đọc/ghi render-config; synth TTS 1 đoạn → mp3 + đo giây; cache theo hash → không gọi API lần 2.
- **Non-functional:** ElevenLabs qua ENV; retry 429/5xx; cache đĩa an toàn (atomic write); `--dry-run`-friendly (module TTS tách khỏi việc gọi thật).

## Architecture

**`RenderConfig` trong `schema.ts`** (additive): `aspect` (`'9:16'|'16:9'|'1:1'`), `fps`, `subtitles{export,burnIn,font,sizePct,color,outline,position,marginPct}`, `bgm{path,volume,duckDb}`, `tts{voiceId,model}`, `kenburns{zoom}`, `segmentOverrides`. `RENDER_CONFIG_VERSION=1` + `defaultRenderConfig()`.

**`lib/tts.ts`** (mẫu ENV + retry của `vision.ts`):
- `readTtsConfig()`: `ELEVENLABS_API_KEY` (bắt buộc), `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` (mặc định `eleven_multilingual_v2`; **cho phép cả 3 tier qua ENV** — `eleven_turbo_v2_5` rẻ ~50%, `eleven_flash_v2_5` nhanh/nháp — Validation S1), `TTS_CACHE_DIR` (mặc định `.cache/tts`).
- `synthSegment(text, cfg): Promise<{ mp3Path: string; durationSec: number }>`:
  - `key = sha256(text + voiceId + model)`; nếu `TTS_CACHE_DIR/<key>.mp3` tồn tại → HIT, chỉ đo lại độ dài (cache cả `.json` metadata độ dài để khỏi ffprobe lại).
  - MISS → `fetch POST {baseUrl}/v1/text-to-speech/{voiceId}` (`accept: audio/mpeg`, body `{text, model_id}`), ghi atomic (`.tmp` → rename), `withRetry` 429/5xx.
  - **Tuỳ chọn (Validation S1):** endpoint `/with-timestamps` trả audio + căn ký tự → cache kèm `.align.json` để `toSrt` (P5) canh caption theo câu chính xác thay vì naive tỉ lệ. Không bắt buộc v1.
  - `durationSec` = ffprobe (qua `lib/ffmpeg.ts` P5) hoặc header nếu có; text rỗng → không synth, trả `durationSec:0` (CLI áp sàn im lặng).
- Không import Node-only vào `schema.ts`; `tts.ts` được import cả bởi route (server) lẫn CLI.

**`lib/bundle.ts`** (dùng `adm-zip` sẵn có):
- `writeBundle({ scriptManifest, config, images: Map<number,Buffer>, audio?: Map<string,Buffer> }): Buffer` → zip: `manifest.json`, `render-config.json`, `band-<i>.jpg`, `audio/seg-<id>.mp3`.
- `readBundle(zip: Buffer): { scriptManifest, config, images, audio }` — validate version, band index khớp shots.

**Routes:**
- `GET /api/jobs/[id]/storyboard/export-bundle` → gom `ScriptManifest` + working image buffers (`getWorkingImage`) + `render-config.json` (từ query/state) + audio cache đã synth → `writeBundle` → attachment `bundle-<jobId>.zip`.
- `POST /api/jobs/[id]/storyboard/tts` → `{ segIds?, config }` → synth từng segment (song song `p-limit`, cô lập lỗi) → điền cache đĩa → trả `[{segId, durationSec, audioUrl}]`. `audioUrl` = route phát lại từ cache cho preview.
- `GET /api/jobs/[id]/storyboard/tts/[segId]/audio` → stream mp3 từ cache (preview "có audio").

## Related Code Files

- Modify: `content-extractor/lib/schema.ts` (RenderConfig + version + default — additive)
- Create: `content-extractor/lib/tts.ts`, `content-extractor/lib/bundle.ts`
- Create: `content-extractor/app/api/jobs/[id]/storyboard/export-bundle/route.ts`
- Create: `content-extractor/app/api/jobs/[id]/storyboard/tts/route.ts` + `tts/[segId]/audio/route.ts`
- Modify: `content-extractor/.env.example` (`ELEVENLABS_*`, `TTS_CACHE_DIR`; ghi rõ 3 tier `ELEVENLABS_MODEL` chọn được — Validation S1), `.gitignore` (`.cache/`)

## Implementation Steps

1. `RenderConfig` + default vào `schema.ts`.
2. `lib/tts.ts`: config, synth + cache đĩa (atomic, hash key), retry; đo độ dài (dùng ffprobe wrapper — có thể tạm shim, hoàn thiện ở P5).
3. `lib/bundle.ts`: write/read zip round-trip, validate.
4. Route `export-bundle` (gom manifest+images+config+audio) và `tts` (synth+cache) + `tts audio` stream.
5. `.env.example` + `.gitignore`.

## Success Criteria

- [x] `writeBundle`→`readBundle` round-trip: manifest/config/images/audio khớp nguyên vẹn.
- [x] `synthSegment` MISS gọi API 1 lần, ghi cache; gọi lại cùng text → **HIT, không fetch**.
- [x] Text rỗng → `durationSec:0`, không gọi API.
- [x] `export-bundle` trả zip mở lại được, band index khớp shots của ScriptManifest.
- [x] Route TTS cô lập lỗi từng segment; preview phát lại audio từ cache.

## Risk Assessment

- **ElevenLabs tính tiền/ký tự** → cache đĩa là bắt buộc; test bằng mock (P7), không gọi thật trong CI.
- **Cache corrupt (ghi dở)** → atomic `.tmp`→rename; key gồm cả model+voice để không lẫn giọng.
- **ffprobe chưa có ở P3** → shim đo độ dài, hợp nhất với `lib/ffmpeg.ts` ở P5 (tránh dup).
