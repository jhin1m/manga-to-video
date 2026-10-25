---
phase: 7
title: "Tests and acceptance"
status: completed
priority: P1
effort: "3h"
dependencies: [6]
---

# Phase 7: Tests and acceptance

## Overview
Test tự động cho từng tầng + nghiệm thu thật 1 chương ngắn tiếng Anh.

## Requirements
Unit (thêm vào script verify sẵn có, không tạo framework mới):
- `verify-script.mts`: hash vi (Phase 1) + prompt en/id chứa promptName, không còn "tiếng Việt" (trừ `Kết chương`), recap giữ marker.
- `verify-tts-settings.mts`: `pickVoiceForLang` / `readTtsConfig({lang})` — giọng sai lang bị thay; lang rỗng catalog → throw; vi không đổi; ElevenLabs không đổi.
- `verify-project.mts`: round-trip `.mtvproj` có/không `outputLanguage`; giá trị lạ → throw.
- `verify-settings-routes.mts` (hoặc file route tương ứng): PATCH job `outputLanguage` hợp lệ/400.
- `pnpm test:parity` + `python3 tests/run_all.py`.

Toàn cục: `pnpm test:unit && pnpm lint && pnpm build` (Node 24 — `nvm use 24` trước, memory `node24-herd-nvm-bootstrap`).
E2E mock: `pnpm test:e2e-video` với `SETTINGS_FILE=/dev/null` (memory: fail ở đây giờ là lỗi thật).

Nghiệm thu thật (AC2/AC4/AC7):
1. Chương ngắn từ corpus `~/Downloads` (memory `corpus-that-downloads-baseline`), cắt ~5 slice.
2. Job `en` → vision → kịch bản → TTS CapCut EN → render; kiểm description/dialogue/narration tiếng Anh, nghe audio.
3. Lặp nhanh với `id` (chỉ tới kịch bản + 1 đoạn TTS).
4. Job `vi` cũ chạy lại → kịch bản/TTS HIT cache như trước (không synth lại).
Dùng `next start` :3105 cho e2e (memory `next16-e2e-next-start`), không kill dev :3000 của user.

## Success Criteria
- [x] Mọi AC trong plan.md tick được, kèm bằng chứng (log/hash/file) ghi vào `reports/`.

## Risk Assessment
Model vision/biên kịch lẫn tiếng Việt với en/id → xem Risk Phase 4. Hết quota z.ai/CapCut → ghi rõ AC nào chưa nghiệm thu thật, không giả kết quả.
