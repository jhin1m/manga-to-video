---
title: "Chọn ngôn ngữ đầu ra theo job (vi/en/id)"
description: "outputLanguage per-job: vision dịch thoại + biên kịch + recap + TTS chọn giọng theo ngôn ngữ; đồng bộ skill Python + lưới parity"
status: in-progress
status_note: "Code + test xong (unit 736 ✓, e2e mock, build, skill 4/4, review DONE_WITH_CONCERNS đã sửa M1-M3 + L2/L3/L4/L5/L6/L7). CHỜ: vision thật en/id — key z.ai trong .secrets.json của skill trả 401. Giọng id mặc định = Shinta (id_female_noor) theo user."
priority: P1
effort: "2d"
tags: [i18n, vision, script, tts, capcut, parity, python-skill]
created: 2026-10-25
---

# Chọn ngôn ngữ đầu ra theo job (vi/en/id)

## Overview
Pipeline đang gắn cứng tiếng Việt ở prompt vision (`lib/vision.ts:78-80`), biên kịch + recap
(`lib/script.ts:98,338`), catalog giọng CapCut (8 giọng vi). Thêm `outputLanguage` **theo job**
(chọn cạnh ô "Ngữ cảnh chương" ở trang upload), lưu vào Job + `.mtvproj` + bundle, truyền xuống
mọi call vision/script/recap/TTS. Ngôn ngữ đợt này: `vi` (mặc định, hành vi y cũ), `en`, `id`.
ja/zh/ko để sau (cần font CJK + wrap không khoảng trắng) — catalog thiết kế để thêm 1 dòng.

## Quyết định đã chốt (user, 2026-10-25)
- Vị trí chọn: **per-job** (không phải Settings toàn cục).
- Ngôn ngữ: **vi + en + id**.
- CapCut: **tìm + thử thực tế giọng EN và ID**, chỉ đưa giọng chạy được vào catalog.
- Giọng mặc định tiếng Indonesia: **Shinta** (`id_female_noor`) — user chỉ định sau, ID lấy từ draft CapCut.
- Skill Python `~/.claude/skills/manga-to-video`: **đồng bộ trong cùng plan**.

## Bất biến
- `vi` = prompt **byte-identical** với hiện tại (guard bằng hash snapshot ở Phase 1).
- Job/`.mtvproj`/bundle cũ không có field → `vi`.
- Cache TTS **không đổi công thức key**: text khác ngôn ngữ ⇒ key khác tự nhiên; ElevenLabs giữ
  cache đã trả phí.
- Marker recap `Kết chương: ` giữ nguyên literal ở mọi ngôn ngữ (hợp đồng `references/series.md:57`).

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Baseline guards](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Language catalog and CapCut voice spike](./phase-02-language-catalog-and-capcut-voice-spike.md) | Pending |
| 3 | [Phase 3: Job outputLanguage and persistence](./phase-03-job-outputlanguage-and-persistence.md) | Pending |
| 4 | [Phase 4: Language-aware prompts](./phase-04-language-aware-prompts.md) | Pending |
| 5 | [Phase 5: TTS voice by language](./phase-05-tts-voice-by-language.md) | Pending |
| 6 | [Phase 6: Python skill sync and parity](./phase-06-python-skill-sync-and-parity.md) | Pending |
| 7 | [Phase 7: Tests and acceptance](./phase-07-tests-and-acceptance.md) | Pending |

Phụ thuộc: 1 → 2 → (3, 4, 5) → 6 → 7. Phase 3/4/5 cùng đụng call-site nên làm tuần tự, không song song.

## Acceptance Criteria
- [x] AC1: Job mới mặc định `vi`; mọi prompt vi giống hệt trước (hash snapshot khớp).
- [ ] AC2 (code + unit xong; CHỜ vision thật — z.ai 401): Chọn `en` ở trang upload → vision trả description/dialogue tiếng Anh, kịch bản + recap tiếng Anh.
- [ ] AC3 (TTS id thật PASS với Shinta; CHỜ vision thật): Chọn `id` → tương tự bằng tiếng Indonesia.
- [x] AC4: Trang video chỉ liệt kê giọng CapCut đúng ngôn ngữ job; voiceId rỗng/sai ngôn ngữ → tự lấy giọng đầu tiên của ngôn ngữ đó; ngôn ngữ không có giọng CapCut → lỗi rõ ràng gợi ý ElevenLabs.
- [x] AC5: `.mtvproj` + bundle round-trip giữ `outputLanguage`; file cũ mở ra là `vi`.
- [x] AC6: Skill Python có `--lang` cho vision + hướng dẫn biên kịch theo ngôn ngữ; `pnpm gen:parity` + `tests/run_all.py` bắt được lệch catalog giọng/ngôn ngữ TS↔Py.
- [ ] AC7 (test/lint/build xanh; TTS CapCut EN thật PASS; CHỜ e2e chương thật có vision): `pnpm test:unit`, `pnpm lint`, `pnpm build` xanh; e2e thật 1 chương ngắn `en` (CapCut EN) nghe được.

## Ngoài phạm vi
ja/zh/ko; dịch UI app; đổi tốc độ đọc `estimateSeconds` (15 ký tự/s vẫn hợp lý cho en/id — chỉ sửa comment).

<!-- slug: output-language-per-job-vi-en-id -->
