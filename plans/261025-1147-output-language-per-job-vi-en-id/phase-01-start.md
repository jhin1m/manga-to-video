---
phase: 1
title: "Baseline guards"
status: pending
priority: P1
effort: "1h"
dependencies: []
---

# Phase 1: Baseline guards

## Overview
Chụp snapshot prompt tiếng Việt hiện tại TRƯỚC khi sửa, để chứng minh nhánh `vi` không đổi một byte.

## Requirements
- Snapshot sha256 của: `buildVisionPrompt('')`, `buildVisionPrompt('<ctx mẫu>')`, `buildPrompt(<2 input mẫu>, '')`, `buildPrompt(..., '<ctx>')`, `buildRecapPrompt(<2 seg mẫu>)`.
- Snapshot tương tự phía Python: `vision_zai.py` build prompt (rỗng + có ctx).

## Related Code Files
- Modify: `content-extractor/scripts/verify-script.mts` (thêm khối "vi prompt bất biến": so hash literal)
- Modify: `~/.claude/skills/manga-to-video/tests/` (test nhỏ so hash prompt vision Python)

## Implementation Steps
1. Chạy hàm hiện tại → in hash → dán literal vào test (comment: hash prompt vi gốc, đổi = hồi quy).
2. Chạy `pnpm test:script` + `python3 tests/run_all.py` xanh trên code CHƯA sửa.

## Success Criteria
- [x] Test hash xanh trên code gốc; sẽ đỏ nếu ai sửa chữ trong prompt vi.

## Risk Assessment
Hash quá chặt → mọi chỉnh prompt vi sau này phải cập nhật hash có chủ đích. Chấp nhận: đó chính là mục đích.
