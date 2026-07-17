---
phase: 3
title: "CapCut Provider"
status: done
priority: P1
effort: "4h"
dependencies: [1, 2]
---

# Phase 3: CapCut Provider

## Overview
Port client CapCut TTS từ Python (K07VN/capcut-tts-api) sang TypeScript thuần `node:crypto`, cắm vào khung provider của Phase 2. Parser response viết theo mẫu THẬT capture ở Phase 1 (`reports/capcut-response-samples.md`) — không đoán.

## Requirements
- Functional: `TTS_PROVIDER=capcut` → `synthSegment` ra mp3 tiếng Việt; flow async new → poll → download gói gọn trong `provider.synth` (bên ngoài không biết gì về task/token).
- Non-functional: không dependency mới; lỗi ném message tiếng Việt rõ nguyên nhân + gợi ý `TTS_PROVIDER=elevenlabs`; không log token/credentials.

## Architecture
`lib/tts-providers/capcut.ts`:
- **SSML**: `<voice name="{voice}" resource_id="{rid}" platform="sami"><prosody rate="{rate}">{text}</prosody></voice>` — escape XML entities trong text.
- **Signing** (port từ Python, đối chiếu dry-run capture Phase 1):
  - `x-ss-stub` = MD5(JSON body) hex uppercase (kiểm tra case với capture).
  - Header sign = MD5(`"9e2c|{last7charsOfPath}|3|{appvr}|{deviceTime}|{tdid}|11ac"`).
  - Sign-string `"appid:{aid}&did:{deviceId}..."` RSA PKCS#1 v1.5 encrypt bằng `TTS_SIGN_PUBLIC_KEY_PEM` (copy nguyên PEM từ repo nguồn, hằng số trong file).
  - `x-khronos`, `device-time` = Unix seconds.
- **Flow**: `POST {base}/lv/v1/common_task/new` → `{ taskId, token }` → poll `POST /lv/v1/common_task/query` interval 1500ms, timeout tổng 120s (khớp AbortSignal ElevenLabs) → parse audio theo JSON path Phase 1 → Buffer. Status fail → throw kèm status text.
- **Device profile**: defaults nhúng (từ repo nguồn); override qua ENV `CAPCUT_DEVICE_JSON` (path file JSON).
- **ENV**: `CAPCUT_VOICE` (default `BV074_streaming`), `CAPCUT_RESOURCE_ID` (default `7102355709945188865`), `CAPCUT_BASE_URL` (default endpoint thật; đổi khi test mock).
- **Catalog**: `export const CAPCUT_VOICES: TtsVoice[]` — chỉ chứa giọng verify được ở Phase 1 (kèm resourceId từng giọng), gắn vào `provider.voices` cho UI Phase 4.
- Mapping config chung: `cfg.voiceId` = voice name CapCut (rỗng → `CAPCUT_VOICE`); `cfg.model` không dùng (bỏ qua, không lỗi).
- Retry: tái dùng `withRetry` (lib/vision) — gắn `status` vào error HTTP để phân loại 429/5xx như ElevenLabs.

## Related Code Files
- Create: `content-extractor/lib/tts-providers/capcut.ts`
- Modify: `content-extractor/lib/tts-providers/index.ts` (đăng ký provider), `content-extractor/.env.example` (block CAPCUT_*)

## Implementation Steps
1. Đọc `reports/capcut-response-samples.md` (Phase 1) — chốt JSON path audio, status values, header case.
2. Viết helpers signing thuần hàm (không class) + unit-testable: `buildSsml`, `xSsStub`, `signHeader`, `rsaSign`.
3. Viết `createTask` / `pollTask` / `downloadAudio` + `synth` tổng hợp.
4. Đăng ký vào registry; cache key tự nhiên có prefix provider (đã làm ở Phase 2).
5. `.env.example`: thêm block `# ==== TTS CapCut ====` theo văn phong file hiện tại (tiếng Việt, giải thích rõ).
6. Smoke test tay (cần mạng): script tạm synth "Xin chào" → nghe file; xác nhận cache HIT lần 2 không gọi API.

## Success Criteria
- [ ] `TTS_PROVIDER=capcut pnpm ...` synth ra mp3 nghe được tiếng Việt (smoke test tay)
- [ ] Lần 2 cùng text → cache HIT, không request mạng
- [ ] Poll timeout/task fail → message tiếng Việt + gợi ý đổi provider, không lộ token
- [ ] `pnpm lint` + `pnpm build` pass (nhớ `nvm use 24`)

## Risk Assessment
- **Signing port sai 1 byte là 4xx** → đối chiếu từng header với dry-run capture Phase 1 trước khi gọi thật.
- **API unofficial có thể chết sau này** → rủi ro cô lập trong file này; ElevenLabs là đường lùi (đã quyết không auto-fallback).
- Rate limit không rõ → synth tuần tự như hiện tại, chưa throttle (YAGNI); nếu 429 xuất hiện, `withRetry` đã backoff.
