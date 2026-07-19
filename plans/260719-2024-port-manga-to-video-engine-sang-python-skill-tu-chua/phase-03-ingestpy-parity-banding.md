---
title: "Phase 3: ingest.py + parity banding"
status: done
phase: 3
priority: P1
effort: "6h"
dependencies: [1, 2]
---

# Phase 3: ingest.py + parity banding

## Overview

Port pipeline ảnh: folder ảnh/PDF → stitch → dò band trắng cắt → trim lề ink-bbox → `slices/` + `manifest.json`. Nghiệm thu bằng parity với baseline TS (Phase 1). Đây là gate nghiệm thu #1.

## Related Code Files

- Create: `~/.claude/skills/manga-to-video/scripts/ingest.py` (CLI)
- Create: `scripts/mtv/smart_split.py` (port `lib/smart-split.ts`), `scripts/mtv/ink_bbox.py` (port `lib/ink-bbox.ts`), `scripts/mtv/stitch.py` (port `lib/stitch.ts`), `scripts/mtv/pdf_pages.py` (port `lib/pdf.ts`, pymupdf)
- Create: `tools/parity-port/compare_cuts.py` (repo root)
- Đọc khi implement: `content-extractor/lib/pipeline.ts` (khớp thứ tự stitch/split thật cho source kind `pages` vs `strip`)

## Tham số ĐÃ TUNE — port NGUYÊN GIÁ TRỊ (nguồn: smart-split.ts, ink-bbox.ts, source-kind.ts, pdf.ts)

| Tham số | Giá trị | Ghi chú |
|---|---|---|
| LINE_TOLERANCE | 25 | diff xám tối đa giữa 2 pixel kề để hàng được coi "safe" (smart-split.ts:89-102) |
| IGNORABLE_BORDER | 5 px | bỏ qua mép trái/phải khi quét hàng |
| MIN_GUTTER_HEIGHT | 24 px | run safe tối thiểu để thành ứng viên cắt |
| SPLIT_HEIGHT | 1600 px | chiều cao band cơ sở |
| MIN_BAND_HEIGHT | 0.6 × SPLIT_HEIGHT | |
| MAX_BAND_HEIGHT | 1.4 × SPLIT_HEIGHT | quá thì force-cut |
| MIN_INK_DENSITY | 0.02 | band thưa hơn → merge vào band trước (smart-split.ts:206-244) |
| Ink pixel | gray < 250 (strict) | dùng cho density và ink-bbox |
| INK_BBOX: ROW_PCT | 0.01 | tỉ lệ pixel ink tối thiểu để hàng/cột tính là content |
| INK_BBOX: PAD_PCT / PAD_MIN_PX | 0.04 / 14 px | padding quanh bbox |
| STRIP_RATIO | 2.5 | h/w > 2.5 → 'strip' (stitch trước) |
| PDF_SCALE | 2 | fitz.Matrix(2,2) ≈ 144dpi |

**Grayscale BẮT BUỘC integer**: `gray = min(255, (299*R + 587*G + 114*B) // 1000)` — làm bằng numpy int32, KHÔNG dùng `PIL convert('L')` (rounding khác). Đây là điều kiện tiên quyết để parity đạt.

## Implementation Steps

1. `pdf_pages.py`: PDF → list PNG bytes qua pymupdf, `Matrix(scale, scale)`, fail-fast kèm số trang lỗi (port pdf.ts:10-32).
2. `stitch.py`: max-width canvas trắng, mỗi slice căn giữa ngang, stack dọc, xuất PNG (port stitch.ts:12-47; PIL paste trên nền (255,255,255)).
3. `smart_split.py` port đúng thứ tự thuật toán (smart-split.ts):
   a. `to_gray` (công thức integer trên) → b. `compute_safe_runs` (hàng safe nếu MỌI cặp pixel kề trong [IGNORABLE_BORDER, w-IGNORABLE_BORDER) có diff ≤ 25) → c. `choose_cuts` greedy: khi `height - currentY > maxBand`, cửa sổ `[currentY+minBand, currentY+maxBand]`, chọn gutter DÀY NHẤT (tie-break: center nhỏ hơn, center = `(start+end)//2` phải nằm trong cửa sổ); không có gutter → snap hàng safe cuối trong cửa sổ, không có nữa → force-cut tại `hi` (smart-split.ts:140-166) → d. `regions_from_cuts` → e. `merge_low_ink_bands`: density < 0.02 merge vào band trước (band đầu carry-forward), band cuối < minBand merge vào trước (smart-split.ts:206-244). Vectorize bằng numpy (diff hàng: `np.abs(np.diff(gray[:, b:-b], axis=1)).max(axis=1) <= 25`).
4. `ink_bbox.py`: projection profile rowInk/colInk (gray < 250), threshold `max(1, ceil(dim × 0.01))`, quét mép vào trong, 3 case trả None (toàn trắng / sliver `left ≥ width` / full-bleed), padding `max(14, round(bbox_dim × 0.04))`, clamp (port ink-bbox.ts:37-89).
5. `ingest.py` CLI: `ingest.py --input <folder|pdf> --workdir W [--split-height 1600] [--pdf-scale 2] [--no-trim] [--resume]`
   - Folder: sort tên file theo natural order (imgi_3_0.jpg < imgi_30_5.jpg cần natural sort THEO SUFFIX như TS — xác nhận cách TS sort trong pipeline.ts khi implement).
   - source-kind theo STRIP_RATIO → strip: stitch tất cả rồi split; pages: split từng trang (khớp hành vi pipeline.ts). **LƯU Ý đã verify**: pipeline.ts có downscale TRƯỚC stitch (`pipeline.ts:72,116`) — ingest.py phải tái tạo đúng bước này (đọc kỹ hàm khi implement); parity so cut trên canvas CÙNG scale với baseline. <!-- Updated: Validation Session 1 - downscale-before-stitch -->
   - Sau split: trim từng band bằng ink_bbox (None → giữ nguyên band), lưu `slices/NNN.png`, ghi `manifest.json` (settings snapshot + slices status `pending`).
   - `--resume`: workdir có manifest → không làm lại, chỉ in trạng thái.
6. `tools/parity-port/compare_cuts.py`: chạy `smart_split` Python trên corpus với settings PIN GIỐNG baseline (Phase 1) → diff từng cut vs `baseline-cuts.json`: PASS nếu |Δy| ≤ 2px và số cut bằng nhau; in bảng từng cut.

## Success Criteria

- [ ] **Gate nghiệm thu #1**: corpus 38 slice `~/Downloads/Vừa Gả...` — số band bằng TS, mọi cut lệch ≤ 2px (lệch hơn phải giải thích được nguyên nhân từng điểm và được chấp nhận rõ ràng).
- [ ] PDF input hoạt động (test 1 PDF bất kỳ ≥ 3 trang).
- [ ] Chạy `ingest.py` 2 lần → kết quả identical; `--resume` không phá workdir đã có content.

## Risk Assessment

- **JPEG decode khác nhau** (sharp/libvips vs PIL/libjpeg) → giá trị xám lệch ±1-2 quanh ngưỡng LINE_TOLERANCE → cut có thể trượt vài px hoặc chọn gutter khác. Mitigation: tolerance ±2px; nếu cut flip hẳn sang gutter khác → so sánh safe-runs hai bên tại vùng đó để chứng minh nguyên nhân decode, cân nhắc decode qua cùng backend (xuất PNG trung gian từ sharp trong harness Phase 1 để loại biến JPEG).
- Natural sort tên file khác TS → thứ tự slice sai toàn tuyến. Mitigation: đối chiếu thứ tự file trong baseline dump.
