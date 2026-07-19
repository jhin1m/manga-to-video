---
title: "Series-memory bible + recap xuyên chương"
description: "Lớp series bên trên lớp chapter: bible tích lũy + recap per-chapter trong <series>/.mtv/, Python skill tự nối context giữa các chương, TS app tích hợp Mức 1 (nạp/xuất file)"
status: pending
priority: P1
effort: "1.5d"
tags: [series-memory, skill, context]
created: 2026-07-19
blockedBy: [260719-2024-port-manga-to-video-engine-sang-python-skill-tu-chua]
blocks: []
---

# Series-memory bible + recap xuyên chương

## Overview

Pipeline hiện xử lý từng chương độc lập → trôi xưng hô, hụt mạch truyện giữa các chương.
Plan này thêm state xuyên chương tại `<series>/.mtv/`: `bible.md` (facts bền: nhân vật/xưng
hô/quan hệ/bối cảnh, cap ~2000 từ) + `summaries/chapter-N.md` (recap diễn biến, cap ~250
từ/chương) + `series.json` (index). Chạy chương N: context = bible + recap 2 chương gần nhất,
tiêm vào vision + biên kịch; chương xong tự sinh recap + diff-update bible từ `script.json` +
`content/*.json` (không tốn vision call).

Thiết kế đã duyệt toàn bộ: `plans/reports/brainstorm-260719-2051-series-memory-bible-recap-report.md`
(mọi quyết định kiến trúc khóa ở đó — không bàn lại).

## Quyết định đã khóa (từ brainstorm)

- Python skill (`~/.claude/skills/manga-to-video/`) là engine chính, tự động hoàn toàn.
- TS app chỉ Mức 1: nút nạp file bible/summaries vào field `context` sẵn có + nút xuất recap.
  KHÔNG series server-side, KHÔNG đổi `.mtvproj`, KHÔNG đổi ingest upload-based.
- Bible CHỈ facts bền; diễn biến nằm ở summaries. Diff-update, không rewrite.
- Recap sinh từ `script.json` + `content/*.json` sau khi chương pass validate.
- Chạy từng chương tự nối (không batch v1). Natural-sort tên thư mục chương (1.1, 1.2…).

## Cấu trúc series (hợp đồng)

```
MangaX/
  chapter-01/  *.jpg|pdf          # nguồn, user tự bỏ
  chapter-02/  ...
  .mtv/
    series.json                   # index chương đã xong + timestamp + settings hash
    bible.md                      # facts bền, cap ~2000 từ
    summaries/chapter-01.md       # recap ~250 từ/chương
    workdirs/chapter-01/          # workdir per-chapter (contract cũ giữ nguyên)
```

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Series contract + SKILL.md workflow (Python skill)](./phase-01-start.md) | Pending |
| 2 | [TS app Mức 1: nạp series context + xuất recap](./phase-02-ts-app-muc1-nap-context-xuat-recap.md) | Pending |
| 3 | [Pilot 3 chương liên tiếp + nghiệm thu](./phase-03-pilot-3-chuong-nghiem-thu.md) | Pending |

Phase 1 và 2 độc lập (khác engine, chỉ chung format file) — làm song song được. Phase 3 cần cả hai.

## Success Criteria

- [ ] Chạy 3 chương liên tiếp corpus thật: xưng hô + tên nhân vật nhất quán 100% giữa các chương (đối chiếu tay script 3 chương vs bible).
- [ ] Narration chương 2+ mở đầu nối mạch được với recap chương trước (đánh giá cảm quan).
- [ ] Regression: chạy chương đơn KHÔNG có `.mtv/` → hành vi y cũ (workdir tự chọn, không sinh file series).
- [ ] Bible sau 3 chương ≤ cap 2000 từ, không chứa diễn biến; re-run 1 chương không xoá entry chương khác.
- [ ] Stale warning: re-run chương cũ sau khi chương sau đã dùng recap → orchestrator cảnh báo trước khi ghi đè.
- [ ] TS app: nạp bible+summary qua file picker đổ đúng vào field context; xuất recap đúng format `summaries/chapter-N.md`; `pnpm test:unit` + `lint` + `build` sạch.

## Ràng buộc

- KHÔNG sửa engine TS ngoài phạm vi Mức 1 (page.tsx + 1 route mới + script.ts). Không bump PROJECT_VERSION.
- Skill: giữ nguyên contract workdir per-chapter hiện có; series là lớp bọc ngoài. Ràng buộc "mỗi workdir 1 render" giữ nguyên.
- Guardrail context tái dùng wording đã ship (plan 260718-1746): chỉ dùng gọi tên/xưng hô, cấm mô tả thứ không có trong ảnh.
- Python snake_case; file skill mở đầu comment nguồn nếu port logic từ TS.
- Secrets không đổi. Không log nội dung bible/recap ra ngoài stderr thông thường.

## Context links

- Design gốc: `plans/reports/brainstorm-260719-2051-series-memory-bible-recap-report.md`
- Plan port (dependency, done): `plans/260719-2024-port-manga-to-video-engine-sang-python-skill-tu-chua/`
- Cơ chế context TS sẵn có: `plans/260718-1746-chapter-context-vision/` (done)
- Code-review port (ràng buộc render/banding): `plans/reports/from-code-reviewer-260719-manga-to-video-python-port-review.md`

<!-- slug: series-memory-bible-recap -->
