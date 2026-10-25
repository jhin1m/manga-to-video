---
phase: 5
title: "TTS voice by language"
status: completed
priority: P1
effort: "3h"
dependencies: [2, 3]
---

# Phase 5: TTS voice by language

## Overview
Giọng phải khớp ngôn ngữ văn bản. Provider có catalog (CapCut) lọc theo lang; provider tự do
(ElevenLabs multilingual) không đổi gì.

## Requirements
- `readTtsConfig(overrides?: { provider?, voiceId?, model?, lang? })` (`lib/tts.ts:30`):
  - Provider có catalog (`TTS_PROVIDER_OPTIONS[...].voices`) + `lang` truyền vào: voice ứng viên (override → settings → ENV) mà **không thuộc lang** → thay bằng giọng đầu tiên của lang.
  - Catalog của lang rỗng → throw `CapCut chưa có giọng {label} — chọn ElevenLabs ở trang Dựng video/Settings.`
  - Không truyền `lang` / `lang='vi'` → hành vi y cũ (voiceId rỗng vẫn để CapCut tự resolve `CAPCUT_VOICE`/default) ⇒ cache key vi không đổi.
  - Giọng ngoài catalog (ENV `CAPCUT_VOICE` tự đặt, không có trong catalog) → tôn trọng, không thay (người dùng chủ động).
- Logic chọn giọng đặt thành hàm thuần client-safe trong `catalog.ts` (vd `voicesFor(providerId, lang)`, `pickVoiceForLang(...)`) để UI và server dùng chung.
- Call-site truyền `lang` của job: `app/api/jobs/[id]/storyboard/tts/route.ts:48`, `lib/render.ts:135` (in-app render), CLI `scripts/render-video.mts` (lang từ bundle, Phase 3).
- UI trang video (`app/video/[jobId]/page.tsx:457`): dropdown giọng CapCut dùng `voicesFor('capcut', jobLang)`; giọng đang chọn không thuộc lang → hiển thị cảnh báo nhỏ + coi như rỗng. Lang không có giọng → note "chọn ElevenLabs".
- Settings TTS (`components/settings/tts-section.tsx`): Settings là toàn cục → hiển thị nhãn giọng kèm lang (`[EN] …`), không lọc. Nút "Nghe thử" (`app/api/settings/tts/preview/route.ts`): sample theo lang của giọng (catalog) → `previewSample`; giọng không rõ lang → sample vi (chuỗi cũ, cache cũ còn dùng).
- Cache: KHÔNG đổi `ttsCacheKey` (text en/id khác text vi ⇒ key khác sẵn).

## Related Code Files
- Modify: `lib/tts.ts`, `lib/tts-providers/catalog.ts`, `lib/render.ts`, `app/api/jobs/[id]/storyboard/tts/route.ts`, `app/video/[jobId]/page.tsx`, `components/settings/tts-section.tsx`, `app/api/settings/tts/preview/route.ts`, `scripts/render-video.mts`

## Success Criteria
- [x] Job en + CapCut + voiceId vi đã lưu ở Settings → synth bằng giọng en đầu catalog.
- [x] Job vi → cfg/caches y hệt trước (test so `readTtsConfig()` cũ vs mới).

## Risk Assessment
Invariant cũ (agent-memory `tts-provider-cachekey-invariant.md`): key phải phản ánh giọng THỰC synth → thay voice phải xảy ra TRONG `readTtsConfig` (trước khi tính key), không trong provider.synth.
