---
title: "Phase 4: tts.py CapCut/ElevenLabs"
status: done
phase: 4
priority: P1
effort: "5h"
dependencies: [2]
---

# Phase 4: tts.py CapCut/ElevenLabs

## Overview

Port tầng TTS: provider CapCut (async task + RSA sign + device id chống shark block) và ElevenLabs, cache audio theo segment, đo duration bằng ffprobe. Đọc `script.json`, ghi `audio/` + `audio-manifest.json`.

## Related Code Files

- Create: `~/.claude/skills/manga-to-video/scripts/tts.py` (CLI + orchestration, port `lib/tts.ts`)
- Create: `scripts/mtv/tts_capcut.py` (port `lib/tts-providers/capcut.ts`), `scripts/mtv/tts_elevenlabs.py` (port `lib/tts-providers/elevenlabs.ts`), `scripts/mtv/tts_catalog.py` (port `lib/tts-providers/catalog.ts` — danh sách voice VN + resourceId)
- Đọc: `lib/tts-providers/types.ts:22-31` (interface), `lib/tts.ts:50-61` (cache key), `lib/ffmpeg.ts:52-67` (ffprobe)

## Chi tiết port BẮT BUỘC GIỮ NGUYÊN

**Cache key** (tts.ts:50-61) — giữ đúng để tương thích hành vi:
- elevenlabs: `sha256(text + "\x00" + voice_id + "\x00" + model)` (legacy, KHÔNG prefix)
- provider khác: `sha256(provider_id + "\x00" + text + "\x00" + voice_id + "\x00" + model)`
- Lưu `audio/<key>.mp3` + `<key>.json` (meta duration); atomic write `.tmp` + `rename`.

**CapCut** (capcut.ts):
- Endpoint: `POST {CAPCUT_BASE_URL:-https://editor-api-sg.capcutapi.com}/lv/v1/common_task/new` → `{task_id, token}`; poll `POST /lv/v1/common_task/query` mỗi `CAPCUT_POLL_INTERVAL_MS:-1500`, timeout tổng `CAPCUT_TIMEOUT_MS:-120000`; status `succeed` → tải `audio_subtitles[0].speech_url`; `failed` → err_msg.
- Sign: `signInput = "appid:{aid}&did:{device_id}&creditDisable:false&ssml:{md5(ssml)}&extraInfo:{extraInfo}"` → RSA PKCS#1 v1.5 encrypt bằng public key nhúng (capcut.ts:55-63, 105-117) → base64. Header `x-ss-stub` = MD5 body. Python: package `cryptography` + `hashlib`. SSML prosody rate=1.0.
- **Device id chống shark block** (capcut.ts:313-370) — GIỮ NGUYÊN logic: ưu tiên env `CAPCUT_DEVICE_JSON` → file store → generate random (snowflake 19 digit) + persist atomic. Store của skill: `~/.claude/skills/manga-to-video/.cache/capcut-device.json`; **seed 1 lần** từ `content-extractor/.cache/capcut-device.json` nếu tồn tại (identity đã thoát shark block — đừng đốt). Memoize per-process.
- `ret != 0` → non-retryable, message kèm hint: đổi provider hoặc xoá device store để random identity mới (`ret=-6` = shark block).
- Voice mặc định `BV074_streaming`, resource id mặc định `7102355709945188865`; catalog voice VN port từ catalog.ts:15-24 (mỗi voice kèm resourceId riêng).

**ElevenLabs** (elevenlabs.ts:14-29): `POST {base_url}/v1/text-to-speech/{voice_id}`, headers `xi-api-key`, body `{text, model_id}`, timeout 120s, retry 429/5xx/network. Env: `ELEVENLABS_API_KEY`, `ELEVENLABS_BASE_URL`, `ELEVENLABS_VOICE_ID:-21m00Tcm4TlvDq8ikWAM`, `ELEVENLABS_MODEL:-eleven_multilingual_v2`.

**ffprobe duration** (ffmpeg.ts:52-67): `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <file>` → float, validate finite > 0.

## Implementation Steps

1. `tts_capcut.py`, `tts_elevenlabs.py` theo interface chung `synth(text, cfg) -> bytes` + `resolve_voice_id(cfg)`; retry helper chung (429/5xx/network, backoff) trong `mtv/`.
2. `tts.py` CLI: `tts.py --workdir W [--provider capcut|elevenlabs] [--voice ID] [--model M] [--force]`
   - Resolution: flag > env `TTS_PROVIDER` > **default `capcut`** (khác TS default elevenlabs — quyết định skill-level vì không cần API key; ghi chú trong header file).
   - Đọc `script.json` (yêu cầu `validate.py --stage script` pass trước — tts.py tự gọi validate, fail thì dừng).
   - Per segment: trim narration, rỗng → skip với duration 0; cache hit → dùng lại (trừ `--force`); miss → synth → ffprobe → ghi cache.
   - Ghi `audio-manifest.json`: `{provider, voice_id, model, segments: {"seg-000": {key, duration_sec, file}}}` + update `manifest.json.stages.tts`.
   - Secrets: đọc env trước, fallback `~/.claude/skills/manga-to-video/.secrets.json`; KHÔNG log giá trị key.
3. Cài `cryptography` vào venv (đã gộp ở Phase 1).
4. Test thật: synth 2 câu tiếng Việt bằng CapCut (dùng device store seed), verify mp3 phát được + duration hợp lý; chạy lại → cache hit không gọi mạng.

## Success Criteria

- [ ] CapCut synth OK với device id persist; chạy lại 100% cache hit.
- [ ] ElevenLabs path hoạt động khi có `ELEVENLABS_API_KEY` (nếu không có key: unit test mock response đủ).
- [ ] `audio-manifest.json` đủ duration mọi segment; lỗi provider in máy-đọc-được (JSON line) và exit ≠ 0.

## Risk Assessment

- Shark block đốt device identity khi test nhiều → dùng seed identity sẵn có, hạn chế call thật (2-3 câu), delay giữa call.
- RSA/sign port sai → CapCut trả ret lỗi khó debug. Mitigation: so sánh từng thành phần sign (md5 ssml, signInput string) với giá trị TS in ra từ harness nhỏ chạy 1 lần (log tạm trong tools/parity-port/, không sửa lib).
