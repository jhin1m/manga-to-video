---
phase: 2
title: "Provider Abstraction Refactor"
status: done
priority: P1
effort: "3h"
dependencies: []
---

# Phase 2: Provider Abstraction Refactor

## Overview
Tách `lib/tts.ts` thành orchestration chung (cache, retry, ffprobe) + provider ElevenLabs riêng, hành vi và cache key ElevenLabs GIỮ NGUYÊN 100%. Sau phase này chưa có CapCut — chỉ có khung cắm provider.

## Requirements
- Functional: `TTS_PROVIDER` (ENV) + override per-call quyết định provider; mặc định `elevenlabs`.
- Non-functional: **cache key ElevenLabs không đổi** — cùng text+voice+model phải ra cùng file `.cache/tts/<sha256>.mp3` như trước refactor (cache đã trả phí không được vô hiệu). `scripts/verify-script.mts` pass không sửa expectation.

## Architecture
```ts
// lib/tts-providers/types.ts
export interface TtsVoice { id: string; label: string; resourceId?: string }
export interface TtsProvider {
  id: string;                 // 'elevenlabs' | 'capcut' | ...
  label: string;
  voices?: TtsVoice[];        // catalog cho UI (capcut); undefined = free-text voiceId
  synth(text: string, cfg: TtsConfig): Promise<Buffer>; // text đã trim, không rỗng → mp3
}
```
- `lib/tts.ts` giữ: `readTtsConfig` (thêm resolution provider: arg > ENV `TTS_PROVIDER` > `'elevenlabs'`), `ttsCacheKey`, `synthSegment` (cache/atomic/probe — gọi `provider.synth` thay `fetchTts`), `writeAtomic`.
- `lib/tts-providers/elevenlabs.ts`: move nguyên `fetchTts` + `statusOf` hiện tại, export provider object. Validate `ELEVENLABS_API_KEY` chỉ khi provider này được dùng (chuyển check từ `readTtsConfig` vào provider).
- Registry: `getTtsProvider(id)` trong `lib/tts-providers/index.ts` — map tĩnh, throw message tiếng Việt khi id lạ.
- Cache key: `elevenlabs` giữ công thức cũ `sha256(text\0voice\0model)`; provider khác `sha256(provider\0text\0voice\0model)` (branch trong `ttsCacheKey`, có comment giải thích lý do backward-compat).

## Related Code Files
- Create: `content-extractor/lib/tts-providers/types.ts`, `content-extractor/lib/tts-providers/elevenlabs.ts`, `content-extractor/lib/tts-providers/index.ts`
- Modify: `content-extractor/lib/tts.ts`, `content-extractor/app/api/jobs/[id]/storyboard/tts/route.ts` (nhận `provider?` từ body), `content-extractor/scripts/render-video.mts` (truyền provider từ config), `content-extractor/scripts/verify-script.mts` (chỉ nếu cần chỉnh import — KHÔNG đổi expectation cache key)

## Implementation Steps
1. Tạo `types.ts` + `elevenlabs.ts` (move code, không đổi logic fetch/headers/timeout 120s).
2. Refactor `lib/tts.ts`: `TtsConfig` thêm `provider: string`; `synthSegment` resolve provider qua registry.
3. `ttsCacheKey(text, voiceId, model, provider)` — branch legacy cho elevenlabs.
4. API route: parse `body.provider` (string, optional) → `readTtsConfig({ provider, voiceId, model })`.
5. `render-video.mts`: truyền `config.tts.provider || undefined`.
6. `.env.example`: thêm `TTS_PROVIDER=elevenlabs` (comment: elevenlabs | capcut — capcut có từ Phase 3).
7. Chạy `nvm use 24 && pnpm lint && pnpm verify-script` (mock ElevenLabs) — pass.

## Success Criteria
- [ ] verify-script pass, không sửa expectation cache
- [ ] Cùng text/voice/model → cùng đường dẫn file cache như commit trước (kiểm tra thủ công 1 key)
- [ ] `TTS_PROVIDER=abc` (id lạ) → lỗi tiếng Việt rõ ràng, liệt kê provider hợp lệ
- [ ] Thiếu `ELEVENLABS_API_KEY` chỉ lỗi khi thực sự synth bằng elevenlabs

## Risk Assessment
- Đổi chữ ký `ttsCacheKey` lan ra verify-script → giữ tham số provider optional default `'elevenlabs'` để call-site cũ không đổi.
- Route hiện synth tuần tự — giữ nguyên, không thêm concurrency (YAGNI).
