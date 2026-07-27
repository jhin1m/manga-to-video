---
phase: 5
title: "TTS settings layer + voices + preview"
status: done
status_note: "Xong 2026-07-27. Công thức plan (dòng 39) không thoả chính test #5 của nó — đã sửa spec, thêm vế "settings TTS chỉ áp khi provider hiệu dụng trùng". listVoices thành method của TtsProvider thay vì if-provider-id trong route. Code review: test case 13 gọi API CapCut thật → đã đổi sang mock elevenlabs."
priority: P1
effort: "4h"
dependencies: [2]
---

# Phase 5: TTS settings layer + voices + preview

## Overview

Chèn đúng **một** tầng settings vào chuỗi ưu tiên TTS, thêm key ElevenLabs trong UI, dropdown
giọng thật (thay ô gõ voice ID tay), và nghe thử 1 câu mẫu.

Phase này độc lập với 3-4 (chỉ phụ thuộc schema Phase 2) → chạy song song được.

## Requirements

- Functional: settings TTS làm mặc định toàn cục; per-job `renderConfig.tts` vẫn thắng;
  ENV vẫn là đường lùi; dropdown giọng ElevenLabs từ API thật; nghe thử phát được.
- Non-functional: **không đổi cache key** của audio đã trả phí (`ttsCacheKey` giữ nguyên công
  thức); lỗi mạng khi lấy giọng → lùi về ô nhập tự do, không chặn.

## Architecture

### Chuỗi ưu tiên (chèn 1 tầng)

```
overrides (renderConfig của job)  >  .settings.json.tts  >  ENV  >  default
```

`readTtsConfig(overrides?)` hiện đọc thẳng `process.env`. Thêm một bước trước đó:

```ts
const saved = readAiSettings()?.tts ?? null;
provider = overrides?.provider || saved?.provider || ENV.TTS_PROVIDER || DEFAULT_PROVIDER_ID
// Settings TTS chỉ áp khi provider HIỆU DỤNG trùng provider đã cấu hình — nếu không, job
// override sang nhà khác sẽ nhận giọng/key của nhà cũ (giọng CapCut gửi cho ElevenLabs).
// Không có vế này thì test 5 bên dưới KHÔNG THỂ pass.
const st = saved && saved.provider === provider ? saved : null;
voiceId  = overrides?.voiceId  || st?.voiceId  || (isElevenlabs ? ENV.ELEVENLABS_VOICE_ID || '21m0…' : '')
model    = overrides?.model    || st?.model    || (isElevenlabs ? ENV.ELEVENLABS_MODEL || 'eleven_multilingual_v2' : '')
apiKey   =                       st?.apiKey   || ENV.ELEVENLABS_API_KEY || ''
```

**Bất biến phải giữ:** với ElevenLabs, khi settings TTS là `null` thì `voiceId`/`model` phải ra
đúng giá trị cũ ⇒ `ttsCacheKey` không đổi ⇒ audio đã trả phí không bị synth lại.

### `POST /api/settings/tts/voices`

Body `{ provider, apiKey? }`. `elevenlabs` → `GET {baseUrl}/v1/voices` header `xi-api-key`
→ map `{id: voice_id, label: name}`. `capcut` → trả thẳng `CAPCUT_VOICES` (catalog tĩnh đã có
trong `lib/tts-providers/catalog.ts`, **không** viết lại danh sách).
Lỗi → 502 `{error}`, UI lùi ô tự do.

### `POST /api/settings/tts/preview`

Body `{ provider, voiceId, model, apiKey? }` → `synthSegment(SAMPLE, cfg)` → trả thẳng
`audio/mpeg` (đúng khuôn `app/api/jobs/[id]/storyboard/tts/[segId]/audio/route.ts` đã có).
Câu mẫu **hằng số dùng chung** để vào cache 1 lần rồi nghe lại miễn phí:

```
"Đây là giọng đọc thử cho video recap truyện tranh."
```

## Related Code Files

- Modify: `content-extractor/lib/tts.ts` (`readTtsConfig`)
- Create: `content-extractor/app/api/settings/tts/voices/route.ts`
- Create: `content-extractor/app/api/settings/tts/preview/route.ts`
- Create: `content-extractor/scripts/verify-tts-settings.mts`
- Modify: `content-extractor/package.json` (thêm vào `test:unit`)

## Implementation Steps

### Bước 1 — Test trước (TDD)

**KHOÁ — bất biến cache, quan trọng nhất phase này:**
1. Settings TTS `null` + ENV như cũ → `readTtsConfig()` trả **y hệt** giá trị hiện tại
   (provider `elevenlabs`, voiceId `21m00Tcm4TlvDq8ikWAM`, model `eleven_multilingual_v2`).
2. `ttsCacheKey(text, voice, model, 'elevenlabs')` cho cùng input → **cùng hash** như trước khi
   sửa (nhúng 1 hash hằng số vào test làm mốc vàng).
3. Provider không phải elevenlabs → `voiceId`/`model` rỗng (provider tự resolve), key có prefix
   provider — giữ nguyên.

**MỚI:**
4. Settings TTS `{provider:'capcut', voiceId:'BV562_streaming'}` + không overrides →
   `readTtsConfig()` trả đúng capcut + giọng đó.
5. Overrides per-job **thắng** settings: settings capcut/`BV562`, overrides
   `{provider:'elevenlabs'}` → ra elevenlabs (và voiceId/model rơi về mặc định elevenlabs).
6. Settings `null` nhưng `ENV.TTS_PROVIDER='capcut'` → capcut (ENV vẫn là đường lùi).
7. `apiKey`: settings có key → dùng key đó; settings rỗng → `ENV.ELEVENLABS_API_KEY`.
8. `/voices` provider `capcut` → trả đúng 8 giọng từ `CAPCUT_VOICES` (assert theo độ dài +
   1 id mẫu, không hard-code cả danh sách).
9. `/voices` provider `elevenlabs` với mock (`scripts/mock-elevenlabs.mjs`) → map đúng
   `voice_id`→`id`, `name`→`label`.
10. `/voices` upstream lỗi → 502, không throw.
11. `/preview` với mock → `Content-Type: audio/mpeg`, body khác rỗng; gọi lần 2 → **HIT cache**
    (mock đếm số lần gọi === 1).

Chạy → đỏ.

### Bước 2 — Code

12. Sửa `readTtsConfig` chèn tầng settings (giữ nguyên phần tính `voiceId`/`model` theo
    `isElevenlabs` để bất biến cache đứng vững).
13. Viết 2 route.
14. Chạy tới xanh.

## Success Criteria

- [ ] Assertion KHOÁ 1-3 xanh — **cache key không đổi**, audio đã trả phí không synth lại
- [ ] Chuỗi ưu tiên 4 tầng xanh (test 4-7)
- [ ] `/voices` chạy cho cả 2 provider, lỗi không chặn UI (test 8-10)
- [ ] `/preview` trả audio + HIT cache lần 2 (test 11)
- [ ] `pnpm test:unit` + `pnpm lint` + `pnpm build` pass

## Risk Assessment

| Rủi ro | Xử |
|---|---|
| **Đổi cache key ⇒ synth lại toàn bộ audio đã trả phí** | Test 2 ghim hash hằng số làm mốc vàng; viết trước khi sửa `readTtsConfig` |
| Key ElevenLabs rò qua `/voices` hoặc `/preview` | 2 route chỉ **nhận** key, không trả; response là danh sách giọng / bytes mp3 |
| Câu mẫu đổi ⇒ cache preview vô hiệu | Đặt thành hằng số export, không viết inline ở 2 chỗ |
| CapCut là API nội bộ reverse-engineered, có thể chết | Đã biết từ trước; đường lùi là đổi provider sang ElevenLabs — phase này không làm tệ thêm |
