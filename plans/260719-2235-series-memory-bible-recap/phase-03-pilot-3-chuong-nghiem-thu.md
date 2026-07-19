---
phase: 3
title: "Pilot 3 chương liên tiếp + nghiệm thu"
status: completed
priority: P1
effort: "0.5d"
dependencies: [1, 2]
---

# Phase 3: Pilot 3 chương liên tiếp + nghiệm thu

## Overview

Chạy skill trên series thật 3 chương liên tiếp để nghiệm thu tính nhất quán xuyên chương,
regression mode chương đơn, và round-trip file với TS app.

## Requirements

- Functional: toàn bộ success criteria của plan.md được đo trên corpus thật.
- Non-functional: không đốt TTS identity (CapCut cache tự resume); token vision như pilot cũ (context thêm ~vài trăm từ/batch).

## Architecture

Corpus: bộ "Vừa Gả Đã Làm Mẹ Kế Của Ba Nhóc Con" trong `~/Downloads/` (chap 1.1 đã có 38 ảnh
baseline; cần tải/chuẩn bị thêm 2 chương kế). Dựng series folder:

```
~/Downloads/vua-ga-da-lam-me-ke/
  chapter-1.1/  chapter-1.2/  chapter-2/
```

Chạy skill lần lượt 3 chương → kiểm tra `.mtv/` sau mỗi lần.

## Related Code Files

- Create: report nghiệm thu `plans/reports/pilot-<date>-series-memory-3-chapters-report.md`
- Không sửa code trong phase này trừ fix lỗi phát hiện được (ghi rõ vào report).

## Implementation Steps

1. Chuẩn bị series folder 3 chương (natural-sort phải xếp 1.1 < 1.2 < 2).
2. Chạy chương 1.1 → check: `.mtv/` khởi tạo, bible có nhân vật + xưng hô đúng, summary ≤250 từ, series.json pass `validate.py --series`.
3. Chạy chương 1.2 → check: context tiêm vào vision + script (soi prompt log), xưng hô khớp bible, narration mở đầu nối mạch.
4. Chạy chương 2 → check: context = recap 1.1 + 1.2 (đúng 2 chương gần nhất), bible diff-update không mất entry cũ.
5. Regression: chạy 1 chương copy ra NGOÀI series folder → không sinh file series, hành vi y pilot cũ.
6. Stale test: re-run chương 1.1 → orchestrator cảnh báo recap đã bị chương sau tiêu thụ.
7. TS app round-trip: nạp bible + 2 summary vào UI (đúng thứ tự), tạo job chương 2 bằng ảnh upload, xuất recap → so format với bản skill sinh.
8. Viết report nghiệm thu; đối chiếu tay xưng hô/tên trên script 3 chương.

## Success Criteria

- [x] 6 success criteria trong plan.md: **5/6 PASS**, criterion 6 (TS round-trip) **user waive** 2026-07-20 — xem `plans/reports/pilot-260720-0239-series-memory-3-chapters-report.md`. Corpus thực tế: "Standard of Reincarnation" 3 chương.
- [x] Không phải sửa bible tay giữa chừng để giữ nhất quán. *(bible chỉ diff-update theo quy trình; validator bắt 2 lần recap over-cap → gọt — đúng cơ chế)*

## Risk Assessment

- Không kiếm được 2 chương kế của corpus → thay bằng bộ khác đủ 3 chương liên tiếp; giữ nguyên tiêu chí đo.
- Chất lượng recap/bible kém → vòng chỉnh prompt trong `references/series.md` + SKILL.md, tối đa 2 vòng rồi báo user quyết.
