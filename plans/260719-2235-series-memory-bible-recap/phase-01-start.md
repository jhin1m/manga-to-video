---
phase: 1
title: "Series contract + SKILL.md workflow (Python skill)"
status: pending
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Series contract + SKILL.md workflow (Python skill)

## Overview

Định nghĩa hợp đồng series (`.mtv/`) và dạy orchestrator (SKILL.md) tự phát hiện series,
nạp context, sinh recap + diff-update bible sau mỗi chương. Toàn bộ stage ngữ nghĩa do
agent làm; phần cơ học chỉ thêm validate cho `series.json`.

## Requirements

- Functional: skill chạy trong series folder tự nối context; ngoài series folder hành vi y cũ.
- Non-functional: bible cap 2000 từ, recap cap 250 từ; không thêm vision call; guardrail chống context bleed.

## Architecture

- Phát hiện series: input là `MangaX/chapter-N/` → orchestrator kiểm tra `../.mtv/` (hoặc hỏi user khi
  lần đầu: "đây là chương của bộ truyện? tạo series folder?"). Không có → mode chương đơn y cũ.
- Workdir series mode: `<series>/.mtv/workdirs/<chapter-slug>/` (contract workdir bên trong không đổi).
- Khối context = nội dung `bible.md` + recap của 2 chương liền trước (natural-sort danh sách
  `summaries/`, lấy 2 file cuối trước chương hiện tại). Tiêm vào: (a) prompt spawn
  `manga-vision-reader` mỗi batch, (b) prompt biên kịch của orchestrator. Kèm guardrail wording
  (tái dùng plan 260718-1746).
- Sau nghiệm thu chương (bước 8 hiện có): orchestrator đọc `script.json` + `content/*.json` →
  viết `summaries/<chapter>.md` → diff-update `bible.md` (chỉ thêm nhân vật mới/quan hệ thay đổi,
  KHÔNG xoá entry sẵn có, KHÔNG đưa diễn biến vào bible) → cập nhật `series.json`.
- Stale check: `series.json` ghi `completed_at` per chương + danh sách recap đã dùng làm context.
  Re-run chương cũ mà chương sau đã tiêu recap của nó → orchestrator cảnh báo user trước khi ghi đè.

## Related Code Files

- Modify: `~/.claude/skills/manga-to-video/SKILL.md` — thêm section "Series mode" (detect, workdir,
  bước 0 nạp context, bước 9 cập nhật memory, stale warning); cập nhật bước 2 (vision) + 4 (kịch bản)
  nhận khối context.
- Create: `~/.claude/skills/manga-to-video/references/series.md` — format bible.md (mục: Nhân vật
  [tên — xưng hô — quan hệ], Bối cảnh/thiết lập, Quy tắc xưng hô), format summary, quy tắc
  diff-update, ví dụ đầy đủ.
- Create: `~/.claude/skills/manga-to-video/schemas/series.schema.json` — schema `series.json`
  (version, chapters[]: {slug, status, completed_at, context_recaps_used[]}).
- Modify: `~/.claude/skills/manga-to-video/scripts/validate.py` — thêm mode `--series <series-dir>`:
  check series.json đúng schema + summaries/bible tồn tại khớp index + cap độ dài (đếm từ, warning).
- Modify: `~/.claude/agents/manga-vision-reader.md` — nhận khối "Ngữ cảnh series" tùy chọn trong
  prompt + guardrail (chỉ dùng để gọi tên/xưng hô, cấm tả thứ không có trong ảnh).

## Implementation Steps

1. Viết `references/series.md` (format + quy tắc diff-update + ví dụ) — đây là nguồn chân lý format.
2. Viết `schemas/series.schema.json`; thêm `--series` vào `validate.py` + fixture smoke test pass/fail
   theo pattern smoke test sẵn có.
3. Cập nhật SKILL.md: section Series mode + móc vào workflow A-Z hiện có (bước 0 và bước 9 mới).
4. Cập nhật agent `manga-vision-reader.md` nhận context block.
5. Chạy smoke validate + kiểm tra SKILL.md không mâu thuẫn với ràng buộc "mỗi workdir 1 render".

## Success Criteria

- [ ] `validate.py --series` pass/fail đúng trên fixture (schema sai, summary thiếu, bible quá cap).
- [ ] SKILL.md mô tả đủ: detect series, nạp context 2 recap + bible, sinh recap, diff-update, stale warning.
- [ ] Mode chương đơn (không `.mtv/`) không đổi một chữ nào trong hành vi scripts.

## Risk Assessment

- Bible phình/lẫn diễn biến → quy tắc facts-bền + cap trong series.md, validate warning đếm từ.
- Agent xoá nhầm entry bible → quy tắc diff-update "chỉ thêm/sửa entry liên quan chương vừa chạy" ghi cứng trong SKILL.md; bible là markdown, user sửa tay được.
- Context làm phình prompt vision (mỗi batch mang theo) → cap tổng (bible 2000 + recap 500 từ) đã tính trong thiết kế; chấp nhận.
