---
phase: 2
title: Context-aware banding (TDD)
status: completed
priority: P1
dependencies: []
effort: M
---

# Phase 2: Context-aware banding (TDD)

## Overview

Rework `lib/smart-split.ts`: thay "cắt mỗi ~SPLIT_HEIGHT tại safe-line gần nhất" bằng "cắt tại **gutter dày** (khoảng trắng liên tục ≥ ngưỡng), bỏ qua khe hẹp nhân vật↔bong bóng, gộp band non nội dung". Mục tiêu: mỗi band chứa trọn một đơn vị nội dung → vision đủ ngữ cảnh. Giữ chữ ký `detectBands()`/`BeatRegion` và bất biến band liền mạch phủ kín canvas.

## Requirements

- **Functional**: không cắt tại khe trắng mỏng (< `MIN_GUTTER_HEIGHT`); chỉ cắt tại gutter dày sau khi đạt `MIN_BAND_HEIGHT`; buộc cắt khi vượt `MAX_BAND_HEIGHT`; gộp band có mật độ mực < `MIN_INK_DENSITY`.
- **Non-functional**: giữ `isSafeLine`/`toGray` (grayscale integer) nguyên; env-tunable; backward-compat `SPLIT_HEIGHT`; band full-width, contiguous, Σh = height, mọi h > 0.

## Architecture — thuật toán mới

### SplitSettings (thay hình dạng)

```ts
interface SplitSettings {
  lineTolerance: number;    // giữ — feed isSafeLine
  ignorableBorder: number;  // giữ — feed isSafeLine
  minGutterHeight: number;  // NEW: run safe-line dày ≥ ngưỡng mới là ứng viên cắt
  minBandHeight: number;    // NEW: không cắt trước ngưỡng (giữ nhân vật + bong bóng)
  maxBandHeight: number;    // NEW: buộc cắt nếu vượt (chặn band nghiền chữ khi downscale)
  minInkDensity: number;    // NEW: band mật độ mực dưới ngưỡng → gộp vào hàng xóm
}
```

`readSplitSettings()` (env, backward-compat):
- `MIN_GUTTER_HEIGHT` (default 24), `MIN_INK_DENSITY` (default 0.02), giữ `LINE_TOLERANCE`(25), `IGNORABLE_BORDER`(5).
- `MIN_BAND_HEIGHT`/`MAX_BAND_HEIGHT`: nếu **không** set → suy từ `SPLIT_HEIGHT` (default 1600): `min = round(0.6×SPLIT)` = 960, `max = round(1.4×SPLIT)` = 2240. Nếu set thì dùng trực tiếp. (Giữ `SPLIT_HEIGHT` để .env cũ vẫn chạy; `SCAN_LINE_STEP`/`MIN_DISTANCE_PCT` không còn dùng — bỏ đọc.)

### Các hàm (export để test từng phần như bản cũ)

1. `computeSafeRuns(img, s): Array<{ start: number; end: number }>` — quét y = 0..height-1, gom run liên tục các hàng `isSafeLine` (end exclusive). O(H×W), chấp nhận được (toGray đã decode full raw).
2. `chooseCuts(runs, height, s): number[]` — greedy:
   ```
   gutters = runs.filter(r => r.end - r.start >= s.minGutterHeight)
                 .map(r => ({ center: Math.floor((r.start + r.end) / 2), thickness: r.end - r.start }))
   cuts = []; currentY = 0
   while (height - currentY > s.maxBandHeight) {
     const lo = currentY + s.minBandHeight, hi = currentY + s.maxBandHeight
     const inWin = gutters.filter(g => g.center > lo && g.center <= hi)
     let cutY
     if (inWin.length) cutY = inWin.sort((a,b)=> b.thickness - a.thickness || a.center - b.center)[0].center  // dày nhất, tie → sớm nhất
     else {
       // không gutter đủ tư cách → snap hàng safe gần hi nhất trong [lo,hi], else hard-cut tại hi
       cutY = lastSafeRowInRange(img, lo, hi, s) ?? hi
     }
     cuts.push(cutY); currentY = cutY
   }
   return cuts   // phần còn lại [currentY, height) là band cuối
   ```
3. `regionsFromCuts(cuts, width, height): BeatRegion[]` — [0,cut1),…,[lastCut,height), full width, contiguous.
4. `mergeLowInkBands(regions, img, s): BeatRegion[]` — density mỗi region = (#pixel gray < 250) / (w×h). Một pass: nếu `regions.length > 1` và density < `minInkDensity` → gộp region vào **trước** (region đầu thì gộp vào **sau**), cộng `h`. Đồng thời gộp band cuối vào trước nếu `h < minBandHeight`. Trả regions đã hợp nhất (vẫn contiguous, Σh = height).
5. `splitGray(img, s): BeatRegion[]` = `mergeLowInkBands(regionsFromCuts(chooseCuts(computeSafeRuns(img,s), img.height, s), img.width, img.height), img, s)`. Canvas ≤ maxBandHeight → cuts rỗng → 1 band trọn canvas.
6. `detectBands(canvas, settings?)` — chữ ký GIỮ NGUYÊN: `toGray` rồi `splitGray`.

**Bất biến (test khoá)**: regions contiguous (region[i].y + region[i].h == region[i+1].y), region[0].y == 0, cuối cùng .y+.h == height, mọi h > 0, mọi w == width.

## Related Code Files

- Modify: `content-extractor/lib/smart-split.ts` — thay `SplitSettings`, `readSplitSettings`, `findSplitPosition`→`chooseCuts`, `splitGray`; thêm `computeSafeRuns`/`regionsFromCuts`/`mergeLowInkBands`; giữ `toGray`/`isSafeLine`.
- Rewrite (test): `content-extractor/scripts/verify-banding.mts` — Test 1-4 & 6 viết lại theo thuật toán mới; Test 5 (stitch), 7 (PDF) giữ.
- Kiểm tra consumer không vỡ: `lib/pipeline.ts::ingestBandItems` (chỉ gọi `detectBands` — không đổi), `verify-ingest.mts`.

## Implementation Steps (TDD)

1. **RED** — viết lại `verify-banding.mts` với settings test-local (như `S` cũ) để độc lập env default:
   - **T1 giữ nhân vật+bong bóng**: canvas có khối A và khối B cách nhau khe mỏng (< minGutterHeight) → assert KHÔNG có cut nào rơi trong khe A–B; có gutter dày (≥ minGutter) sau minBandHeight → assert cut tại tâm gutter đó.
   - **T2 chọn gutter dày**: trong cửa sổ có 1 gutter mỏng (dưới ngưỡng) + 1 dày → cut tại gutter dày.
   - **T3 force cut**: canvas nhiễu (mọi hàng unsafe) cao > maxBandHeight → cut tại maxBandHeight (fallback), không văng.
   - **T4 min/max**: mọi band ∈ [minBandHeight, maxBandHeight] trừ band cuối.
   - **T5 contiguity**: Σh == height, contiguous, w == width, h > 0.
   - **T6 gộp band gần trắng**: chèn dải gần trắng → output không còn band density < minInkDensity.
   - Giữ **Test stitch** + **Test PDF**; cập nhật **Test ingest** (`ingestBandItems` với default mới — tính lại band kỳ vọng).
   Chạy `pnpm test:unit` → FAIL.
2. **GREEN** — implement `smart-split.ts` theo Architecture. `lastSafeRowInRange` = quét từ `hi` xuống `lo`, trả hàng safe đầu tiên (gần hi nhất) hoặc `null`.
3. Chạy `pnpm test:unit` tới xanh; tinh chỉnh cho tới khi mọi bất biến pass.
4. Kiểm hồi quy: `verify-ingest.mts` (band item vẫn hợp lệ), `pnpm test:e2e` (ingest band + generate).

## Success Criteria

- [ ] T1: không cut trong khe hẹp nhân vật↔bong bóng; cut tại gutter dày.
- [ ] T2-T4: chọn gutter dày nhất trong cửa sổ; force-cut tại max khi thiếu gutter; band ∈ [min,max] trừ cuối.
- [ ] T5: regions contiguous, Σh = height, w = width, h > 0.
- [ ] T6: không band nào density < minInkDensity trong output; band cuối < minBand được gộp.
- [ ] Backward-compat: `readSplitSettings` suy min/max từ `SPLIT_HEIGHT` khi thiếu env.
- [ ] `pnpm test:unit` + `pnpm test:e2e` PASS; `eslint` + `tsc --noEmit` + `next build` sạch.

## Risk Assessment

- **Ngưỡng default chưa hợp mọi truyện**: env-tunable; ghi rõ ở `.env.example` (Phase 3). Preview vạch cắt ngoài phạm vi.
- **Merge đẩy band vượt maxBandHeight**: chấp nhận (gộp band gần trắng tốt hơn để band rỗng); test khoá coverage + no-empty, không khoá max sau merge.
- **Trang rời (pages) stitch chung**: mục tiêu chỉ lợi rõ với webtoon dải dọc; không phân nhánh medium (giữ quyết định ingest thống nhất 2026-07-07).
- Rollback: revert `smart-split.ts` + `verify-banding.mts`; `detectBands` chữ ký không đổi nên consumer an toàn.
