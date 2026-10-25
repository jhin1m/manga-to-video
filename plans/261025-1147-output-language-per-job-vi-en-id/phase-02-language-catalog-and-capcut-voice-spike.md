---
phase: 2
title: "Language catalog and CapCut voice spike"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Language catalog and CapCut voice spike

## Overview
Nguồn dữ liệu duy nhất cho ngôn ngữ (client-safe) + gắn `lang` cho từng giọng CapCut; tìm và thử
thật giọng EN/ID.

## Requirements
- `lib/output-language.ts` (data thuần, client import được — như `catalog.ts`):
  ```ts
  export const OUTPUT_LANGUAGES = [
    { id: 'vi', label: 'Tiếng Việt', promptName: 'tiếng Việt', previewSample: 'Đây là giọng đọc thử cho video recap truyện tranh.' },
    { id: 'en', label: 'English', promptName: 'tiếng Anh (English)', previewSample: 'This is a sample voice for a manga recap video.' },
    { id: 'id', label: 'Bahasa Indonesia', promptName: 'tiếng Indonesia (Bahasa Indonesia)', previewSample: 'Ini adalah contoh suara untuk video rekap komik.' },
  ] as const;
  export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number]['id'];
  export const DEFAULT_OUTPUT_LANGUAGE: OutputLanguage = 'vi';
  export function normalizeOutputLanguage(v: unknown): OutputLanguage // lạ/thiếu → 'vi'
  export function getOutputLanguage(id): (entry)
  ```
- `TtsVoice.lang?: OutputLanguage` (`lib/tts-providers/types.ts`); 8 giọng hiện có gắn `lang: 'vi'`.
  Giọng `multi_*_bigtts` ("multi") — thử xem đọc được en/id không; nếu có thì vẫn giữ 1 lang chính, không đa-gán (YAGNI).
- `PROVIDER_LABELS.capcut` bỏ "tiếng Việt" → `'CapCut (free)'` (đồng bộ `tts_catalog.py`).
- `TTS_PREVIEW_SAMPLE` trong `lib/tts.ts` → lấy từ `OUTPUT_LANGUAGES[vi].previewSample` (giữ đúng chuỗi cũ để cache nghe thử không đổi).

## Spike CapCut EN/ID (thực nghiệm, KHÔNG đoán)
1. Ứng viên voice_type: tìm trên web (repo CapCut/volcengine TTS mã nguồn mở, danh sách `BVxxx_streaming`, `en_*`, `id_*`) — ghi nguồn.
   Cần cả `voice_type` lẫn `resource_id` (CapCut gửi resource_id riêng từng giọng, xem `capcut.ts:436`).
2. Viết script thử tạm trong scratchpad, gọi `capcutProvider.synth()` thật với câu en/id ngắn; nghe/ffprobe kiểm có audio và đúng ngôn ngữ.
3. Đưa vào catalog CHỈ giọng pass (mục tiêu ≥2 giọng/ngôn ngữ, nam + nữ nếu có). Ghi kết quả (pass/fail + nguồn) vào `reports/`.
4. Nếu `xml:lang="en-US"` trong SSML (`capcut.ts:98`) hoặc `lan:'vi-VN'` ở device profile ảnh hưởng kết quả → map theo lang; không ảnh hưởng → để nguyên (ghi nhận trong report).

## Related Code Files
- Create: `content-extractor/lib/output-language.ts`
- Modify: `content-extractor/lib/tts-providers/types.ts`, `catalog.ts`, `lib/tts.ts`
- Create: `plans/261025-1147-output-language-per-job-vi-en-id/reports/capcut-voice-spike-en-id.md`

## Success Criteria
- [x] Catalog có lang cho mọi giọng; ≥1 giọng CapCut en và ≥1 id synth thật thành công (hoặc report ghi rõ không tìm được + fallback ElevenLabs).

## Risk Assessment
- Không tìm được giọng ID trên CapCut → ngôn ngữ đó catalog rỗng; Phase 5 đã có nhánh lỗi rõ gợi ý ElevenLabs. Không chặn plan.
- Endpoint CapCut từ chối (shark block) khi thử nhiều → giãn nhịp, thử ít ứng viên mỗi lượt.
