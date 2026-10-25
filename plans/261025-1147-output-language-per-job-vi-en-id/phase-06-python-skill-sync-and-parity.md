---
phase: 6
title: "Python skill sync and parity"
status: pending
priority: P2
effort: "3h"
dependencies: [4, 5]
---

# Phase 6: Python skill sync and parity

## Overview
Skill `~/.claude/skills/manga-to-video` có pipeline riêng (vision z.ai + Claude tự viết kịch bản + TTS).
Đồng bộ ngôn ngữ và đưa catalog vào lưới parity để không lệch âm thầm.

## Requirements
- `scripts/mtv/vision_zai.py`: `build_prompt(context, lang='vi')` — cùng chữ với TS cho từng lang (vi y cũ).
- `scripts/vision.py`: `--lang {vi,en,id}` (default vi). Ghi lang vào workdir (vd `workdir/meta.json` hoặc file có sẵn tương đương — kiểm cấu trúc workdir trước) để `tts.py`/bước sau đọc lại, khỏi truyền lặp.
- `scripts/tts.py`: `--lang` (default đọc từ workdir, thiếu = vi) → chọn giọng như `pickVoiceForLang` TS.
- `scripts/mtv/tts_catalog.py`: thêm `lang` mỗi giọng + giọng en/id từ spike; label capcut bỏ "tiếng Việt"; thêm `OUTPUT_LANGUAGES`.
- `references/style-guide.md` + `SKILL.md`: bước đầu hỏi/nhận ngôn ngữ đầu ra; quy tắc vision + biên kịch dùng "{ngôn ngữ đích}" thay "tiếng Việt" (giữ bản vi làm mặc định, nêu rõ giữ `Kết chương: `). Description SKILL.md: "narration tiếng Việt" → "narration vi/en/id".
- `scripts/mtv/schema_defs.py:78`: chỉ sửa comment.
- Parity: `content-extractor/scripts/gen-parity.mts` xuất thêm `OUTPUT_LANGUAGES` (id/promptName/previewSample) và `CAPCUT_VOICES` (id/resource_id/lang); `tests/test_parity.py` so với `tts_catalog.py`. Bump `PARITY_VERSION` nếu schema snapshot yêu cầu.
- Facade Codex: chạy `scripts/sync_codex_facade.py` (memory `mtv-codex-facade`: giữ 4 khác biệt khi sync); kiểm `codex debug prompt-input` nếu SKILL.md đổi.

## Related Code Files
- Modify (skill): `scripts/vision.py`, `scripts/mtv/vision_zai.py`, `scripts/tts.py`, `scripts/mtv/tts_catalog.py`, `scripts/mtv/schema_defs.py`, `references/style-guide.md`, `SKILL.md`, `tests/test_parity.py`
- Modify (app): `content-extractor/scripts/gen-parity.mts`, `content-extractor/scripts/verify-parity.mts` (nếu cần)

## Success Criteria
- [x] `pnpm gen:parity && python3 tests/run_all.py` xanh; sửa 1 giọng chỉ ở 1 phía → test đỏ.
- [ ] `vision.py --lang en` trên 1-2 slice thật trả JSON tiếng Anh, validate.py pass.

## Risk Assessment
Bẫy `.pyc` cũ làm test báo sai (memory `parity-snapshot-ts-python-harness`) → xoá `__pycache__` trước khi tin kết quả.
