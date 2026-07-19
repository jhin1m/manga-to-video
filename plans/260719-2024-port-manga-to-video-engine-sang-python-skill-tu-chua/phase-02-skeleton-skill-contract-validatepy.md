---
title: "Phase 2: Skeleton skill + contract + validate.py"
status: done
phase: 2
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Skeleton skill + contract + validate.py

## Overview

Dựng skeleton `~/.claude/skills/manga-to-video/`, chốt hợp đồng JSON agent ↔ scripts, viết `validate.py` (fail sớm, lỗi máy-đọc-được). Mọi phase sau xây trên hợp đồng này.

## Related Code Files

- Create: `~/.claude/skills/manga-to-video/SKILL.md` (stub — nội dung đầy đủ ở Phase 6)
- Create: `~/.claude/skills/manga-to-video/scripts/validate.py`
- Create: `~/.claude/skills/manga-to-video/scripts/mtv/__init__.py` + `scripts/mtv/schema_defs.py` (port từ `lib/schema.ts`)
- Create: `~/.claude/skills/manga-to-video/schemas/content.schema.json`, `schemas/script.schema.json`
- Đọc: `content-extractor/lib/schema.ts` (SceneContent :4-8, BeatRegion :62-67, ScriptSegment :188-196, estimateSeconds :127-131)

## Architecture — Hợp đồng workdir (CHUẨN, các phase sau tuân theo)

```
workdir/
  manifest.json
  slices/NNN.png            # NNN = 000, 001... theo thứ tự đọc
  content/NNN.json          # vision agent ghi, 1 file / slice
  script.json               # orchestrator ghi, cả chương
  audio/<sha256>.mp3|.json  # tts.py cache (key thuật toán port từ lib/tts.ts:50-61)
  audio-manifest.json       # map segment id → key/duration
  out/video.mp4, video.srt, timeline.json
```

`manifest.json` (single-writer = scripts/orchestrator; vision agent KHÔNG được sửa — tránh race khi batch song song):

```json
{
  "version": 1, "created_at": "iso8601",
  "source": {"type": "folder|pdf", "path": "...", "file_count": 38},
  "settings": {"split_height": 1600, "line_tolerance": 25, "...": "snapshot đầy đủ"},
  "stitched": {"width": 800, "height": 54321},
  "slices": [{"id": "000", "file": "slices/000.png", "w": 800, "h": 1500,
              "y_src": 0, "status": "pending|described"}],
  "stages": {"ingest": "done", "content": "pending|partial|done",
             "script": "pending|done", "tts": "pending|done", "render": "pending|done"}
}
```

`content/NNN.json` — port SceneContent (`schema.ts:4-8`):
```json
{"slice_id": "000", "description": "string ≠ rỗng", "dialogue": ["string"], "note": ""}
```

`script.json` — rút gọn từ ScriptSegment (`schema.ts:188-196`; shots mặc định full-slice, region null, motion auto):
```json
{"version": 1,
 "segments": [{"id": "seg-000", "order": 0, "narration": "string ≠ rỗng",
               "shot_indices": [0, 1]}]}
```

## Implementation Steps

1. Tạo cây thư mục skill + `SKILL.md` stub (frontmatter tối thiểu hợp lệ theo `~/.claude/skills/agent_skills_spec.md`) để skill không bị load lỗi khi chưa xong.
2. `scripts/mtv/schema_defs.py`: hằng số + helper dùng chung (đường dẫn workdir chuẩn, load/save manifest atomic `.tmp`+`rename`, `estimate_seconds(narration) = max(1, ceil(chars/15))` port `schema.ts:127-131`).
3. Viết 2 JSON Schema (draft 2020-12) cho content/script như trên: types, required, `minItems`, `dialogue` là array-of-string, `shot_indices` array-of-int ≥ 0.
4. `validate.py` CLI: `validate.py --workdir W --stage content|script`
   - Stage `content`: mọi slice `status=described` phải có `content/NNN.json` pass schema; slice có file content nhưng manifest còn `pending` → cảnh báo lệch trạng thái.
   - Stage `script`: pass schema + business rules port từ `lib/script.ts:164-228`:
     - mỗi `shot_indices[i]` ∈ [0, số slice); 
     - mỗi slice index xuất hiện ĐÚNG 1 lần trên toàn bộ segments (không sót, không lặp);
     - `narration` không rỗng sau trim; `order` liên tục từ 0.
     - In tổng duration ước tính (`estimate_seconds` từng segment) để orchestrator cân nhắc.
   - Output: lỗi dạng JSON lines `{"file": "...", "path": "$.segments[2].shot_indices", "rule": "index-duplicate", "message": "..."}` → exit 1; pass → in summary 1 dòng, exit 0.
5. Smoke test bằng fixture tay: 1 case pass + các case fail (thiếu index, lặp index, narration rỗng, sai type) — fixtures đặt trong `~/.claude/skills/manga-to-video/tests/fixtures/`.

## Success Criteria

- [ ] Cây skill tồn tại, `validate.py` chạy bằng `~/.claude/skills/.venv/bin/python3`.
- [ ] Mỗi case lỗi fixture cho đúng 1 dòng JSON lỗi với `rule` phân biệt được; case pass exit 0.
- [ ] Header mỗi file Python ghi nguồn port (`# Port từ content-extractor/lib/schema.ts ...`).

## Risk Assessment

- Hợp đồng đổi giữa chừng sẽ lan sang mọi phase → chốt tại phase này, phase sau chỉ THÊM field (backward-compatible), không đổi tên field.
- Race manifest khi vision batch song song → đã chặn bằng quy tắc single-writer (agent chỉ ghi `content/NNN.json`).
