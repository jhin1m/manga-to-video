---
title: "Port manga-to-video engine sang Python skill tu chua"
description: "Port engine TS (content-extractor/lib) sang Python de tao skill manga-to-video tu chua: agent doc anh + viet kich ban, Python lam stage co hoc, output mp4 + srt"
status: done
priority: P1
effort: "3-4d"
tags: [python-port, skill, parity]
created: 2026-07-19
blockedBy: []
blocks: []
---

# Port manga-to-video engine sang Python skill tự chứa

## Overview

Port engine từ `content-extractor/lib/` (TypeScript, nguồn chân lý — **KHÔNG sửa**) sang Python để tạo skill `~/.claude/skills/manga-to-video/`. Claude Code/Codex làm orchestrator chạy A-Z: folder ảnh manga → ingest (band-split + trim) → vision agent đọc slice theo batch → orchestrator viết kịch bản → validate loop → TTS → render → mp4 + SRT. Không dùng z.ai cho path này.

## Quyết định đã khóa (không bàn lại)

- Skill tại `~/.claude/skills/manga-to-video/`, chạy bằng `~/.claude/skills/.venv/bin/python3`, ffmpeg hệ thống (`/opt/homebrew/bin/ffmpeg`).
- 2 engine song song (TS cho UI, Python cho skill); bù drift bằng parity test + comment nguồn port đầu mỗi file Python.
- Agent làm stage ngữ nghĩa (content JSON, script JSON); Python làm stage cơ học.
- Hợp đồng agent ↔ scripts = file JSON trong workdir + `validate.py` (fail sớm, lỗi máy-đọc-được).

## Hợp đồng workdir (tóm tắt — chi tiết ở Phase 2)

```
workdir/
  manifest.json        # ingest sinh; track per-slice pending/described + settings snapshot (resume)
  slices/NNN.png
  content/NNN.json     # vision agent ghi theo batch 5-8
  script.json          # orchestrator ghi (cả chương)
  audio/seg-NNN.mp3 + audio-manifest.json   # tts.py cache
  out/video.mp4, video.srt, timeline.json   # render.py
```

## Phases

| # | Phase | Status | Phụ thuộc |
|---|-------|--------|-----------|
| 1 | [Môi trường + baseline TS](./phase-01-start.md) | ✅ Done | — |
| 2 | [Skeleton skill + contract + validate.py](./phase-02-skeleton-skill-contract-validatepy.md) | ✅ Done | 1 |
| 3 | [ingest.py + parity banding](./phase-03-ingestpy-parity-banding.md) | ✅ Done | 1, 2 |
| 4 | [tts.py CapCut/ElevenLabs](./phase-04-ttspy-capcut-elevenlabs.md) | ✅ Done | 2 |
| 5 | [render.py + parity shake](./phase-05-renderpy-parity-shake.md) | ✅ Done | 2 |
| 6 | [SKILL.md + references + vision agent](./phase-06-skillmd-references-vision-agent.md) | ✅ Done | 2–5 |
| 7 | [Pilot A-Z + nghiệm thu](./phase-07-pilot-a-z-nghiem-thu.md) | ✅ Done | 6 |

Phase 3, 4, 5 độc lập nhau — có thể làm song song sau Phase 2.

## Success Criteria (nghiệm thu BẮT BUỘC)

- [x] **Parity banding**: PASS — mode A/B (split trên canvas TS / stitch từ JPEG TS) 0px lệch cả 26 cut / 27 band; mode C (full pipeline Python) pass ở tolerance ≤2px — đây là hợp đồng chính thức, KHÔNG byte-exact do khác JPEG encoder PIL vs sharp (xem `plans/reports/pilot-260719-manga-to-video-python-skill-report.md` + code-review report).
- [x] **Parity render**: PASS — pilot p95 0.0796px vs baseline TS p95 0.9805px (ngưỡng 1.1× = 1.0785px); filter string byte-identical 10 case.
- [x] **Pilot A-Z**: PASS — video 175s + SRT + timeline từ corpus 38 slice, resume test pass. Lưu ý: `output-16x9.*` hoá ra là chương truyện KHÁC nên chỉ so được quy tắc hình thức kịch bản (chi tiết trong report).

## Ràng buộc

- KHÔNG sửa bất kỳ file nào trong `content-extractor/` (chỉ đọc). Parity harness đặt ở `tools/parity-port/` tại repo root.
- Mỗi file Python mở đầu bằng comment nguồn port (vd `# Port từ content-extractor/lib/kenburns.ts — đồng bộ 2 nơi khi fix bug`).
- Python snake_case; skill theo convention hiện có trong `~/.claude/skills/` (SKILL.md frontmatter + references/ + scripts/).
- Secrets (ElevenLabs key...) đọc từ env / `~/.claude/skills/manga-to-video/.secrets.json` (gitignore-style, không hardcode, không in ra log).
- Node harness cần Node 24: `nvm use 24` trước khi chạy (shell mặc định Node 22 — xem memory `node24-herd-nvm-bootstrap`).

## Model policy (ghi tường minh vào SKILL.md ở Phase 6)

- Vision batch → subagent `manga-vision-reader` (model **sonnet**), batch 5-8 slice, ảnh không tràn context orchestrator.
- Viết kịch bản + nghiệm thu → model chính của session (khuyến nghị Opus trở lên).
- Sửa lỗi validate → orchestrator tự sửa inline.
- ingest/tts/render → orchestrator chạy inline qua Bash.

## Validation Log

### Verification Results (Session 1 — 2026-07-19)
- Claims checked: 38 (hằng số, công thức, endpoint, đường dẫn trên mã TS nguồn)
- Verified: 38 | Failed: 0 | Unverified: 0
- Tier: Full (7 phases)
- Phát hiện bổ sung: (1) default `kenburns.zoom = 1.12` (`schema.ts:291`) — đã pin vào Phase 5; (2) `pipeline.ts` có bước downscale TRƯỚC stitch (`pipeline.ts:72,116`) — harness Phase 1 phải import hàm pipeline-level, ingest.py Phase 3 phải tái tạo đúng bước này.

### Quyết định interview (Session 1)
| Câu hỏi | Quyết định |
|---|---|
| Vị trí agent manga-vision-reader | **Global `~/.claude/agents/`** (skill dùng được từ mọi cwd) |
| Default TTS provider | **capcut** (khác TS default elevenlabs — ghi chú trong header file) |
| Ngưỡng parity gates | **cuts ±2px, shake p95 ≤ 1.1× baseline** (lệch hơn phải giải thích từng điểm) |
| Hợp đồng script.json shots | **Full-slice, region null, motion auto** (không cho agent chỉ định region/motion ở v1) |

### Whole-Plan Consistency Sweep (Session 1)
- Đã propagate zoom 1.12 (Phase 5) + pipeline-level import/downscale (Phase 1, 3).
- Không còn mâu thuẫn tồn đọng giữa plan.md và 7 phase files.

<!-- slug: port-manga-to-video-engine-sang-python-skill-tu-chua -->
