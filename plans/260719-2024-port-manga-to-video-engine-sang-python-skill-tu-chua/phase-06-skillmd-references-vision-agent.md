---
title: "Phase 6: SKILL.md + references + vision agent"
status: done
phase: 6
priority: P1
effort: "4h"
dependencies: [2, 3, 4, 5]
---

# Phase 6: SKILL.md + references + vision agent

## Overview

Viết SKILL.md workflow A-Z, port prompt từ `lib/vision.ts` + `lib/script.ts` thành references, tạo custom agent `manga-vision-reader`. Đây là "bộ não" orchestration — scripts đã xong ở Phase 3-5.

## Related Code Files

- Create: `~/.claude/skills/manga-to-video/SKILL.md` (thay stub Phase 2)
- Create: `~/.claude/skills/manga-to-video/references/style-guide.md` (port prompt `lib/vision.ts:63-82` + `lib/script.ts:69-110`)
- Create: `~/.claude/skills/manga-to-video/references/schema.md` (content/script JSON + ví dụ + estimate duration chars/15)
- Create: `~/.claude/agents/manga-vision-reader.md` (**global**, không phải project `.claude/agents/` — skill global thì agent phải global để dùng từ mọi cwd; ghi chú quyết định này trong plan)
- Tham chiếu convention: `~/.claude/skills/agent_skills_spec.md`, cấu trúc `ak-scout/SKILL.md`

## Implementation Steps

1. **SKILL.md** — frontmatter đúng spec (name `manga-to-video`, description trigger rõ: "tạo video narration + SRT từ folder ảnh/PDF manga"), thân gồm:
   - Prereqs: `~/.claude/skills/.venv/bin/python3` (deps: Pillow, numpy, pymupdf, jsonschema, requests, cryptography), ffmpeg hệ thống; lệnh kiểm tra nhanh.
   - Secrets: env `ELEVENLABS_API_KEY`/`CAPCUT_*` hoặc `.secrets.json` — không hardcode.
   - **Workflow A-Z** (lệnh cụ thể từng bước):
     1. `ingest.py --input <src> --workdir W` → đọc manifest, báo số slice.
     2. Vision: chia slice `pending` thành batch 5-8 → spawn subagent `manga-vision-reader` (song song tối đa 2-3 batch); agent ghi `content/NNN.json`; orchestrator nhận tóm tắt, cập nhật manifest status `described`.
     3. `validate.py --stage content` → lỗi thì orchestrator sửa/re-spawn batch hỏng.
     4. Orchestrator ĐỌC toàn bộ `content/*.json`, viết `script.json` theo `references/style-guide.md` (nắm cả chương rồi mới viết — gộp/tách khung, mỗi index đúng 1 lần).
     5. `validate.py --stage script` → loop sửa inline đến khi pass.
     6. `tts.py --workdir W [--provider ...]`.
     7. `render.py --workdir W --aspect ... --subs both [--bgm ...]`.
     8. Nghiệm thu: mở video, kiểm SRT, báo user đường dẫn `out/`.
   - **Resume**: đứt giữa chừng → đọc `manifest.json.stages` + slice status, tiếp từ stage dở; audio cache tự resume; `ingest --resume` không phá workdir.
   - **Model policy** (tường minh): vision batch → subagent sonnet; viết kịch bản + nghiệm thu → model chính session (khuyến nghị Opus+); sửa validate → inline; scripts → Bash inline, không delegate.
2. **references/style-guide.md**: port NGUYÊN quy tắc — narrator LUÔN ngôi ba (cấm "tôi/ta" làm chủ ngữ lời kể, độc thoại → gián tiếp "hắn thầm nghĩ…" hoặc trích ngoặc kép); xưng hô ngôi nhất/nhì chỉ nằm TRONG ngoặc kép thoại; dialogue dịch tiếng Việt theo thứ tự đọc; `note` cho SFX/chuyển cảnh/ảnh mờ và ĐƯỢC feed vào bước viết kịch bản (format `[i] desc | Thoại: "…" | Lưu ý: …` port script.ts:88-98); ngữ cảnh chương chỉ dùng gọi đúng tên/xưng hô, không bịa sự kiện, không áp vào giọng người kể.
3. **references/schema.md**: 2 schema + ví dụ hợp lệ/không hợp lệ + quy tắc phủ index + `estimate_seconds = max(1, ceil(chars/15))`.
4. **manga-vision-reader.md**: frontmatter `model: sonnet`, tools Read/Write/Glob. Prompt: nhận workdir + danh sách slice cụ thể; đọc từng ảnh; ghi `content/NNN.json` đúng schema.md + style-guide (description ngôi ba khách quan, độ dài thích ứng); KHÔNG sửa `manifest.json`/file khác; trả về tóm tắt ≤ 1 dòng/slice + `Status: DONE|BLOCKED` — không dump JSON vào reply.
5. Chạy thử vision 1 batch 5 slice từ corpus → content JSON pass validate, description đúng ngôi ba.

## Success Criteria

- [ ] Skill xuất hiện trong danh sách skill session mới; SKILL.md tự chứa (không cần đọc repo TS để vận hành).
- [ ] 1 batch vision thật: 5/5 file content pass `validate.py --stage content`, không leak ảnh vào context orchestrator.
- [ ] style-guide.md giữ đủ các quy tắc CỨNG từ prompt gốc (đối chiếu từng gạch đầu dòng với vision.ts/script.ts).

## Risk Assessment

- Prompt port thiếu 1 quy tắc (vd cấm ngôi nhất) → kịch bản sai giọng hàng loạt, phát hiện muộn ở pilot. Mitigation: bước đối chiếu từng dòng ở Success Criteria.
- Agent sonnet ghi JSON sai format → validator bắt được (fail sớm), orchestrator re-spawn với lỗi đính kèm.
