# Phase 2 — Context-aware banding (TDD) — báo cáo triển khai

## Thay đổi thuật toán

`lib/smart-split.ts` viết lại hoàn toàn phần cắt band, giữ nguyên `toGray`/`isSafeLine`:

- `SplitSettings` đổi hình dạng: `lineTolerance`, `ignorableBorder` (giữ) + `minGutterHeight`,
  `minBandHeight`, `maxBandHeight`, `minInkDensity` (mới). Bỏ `splitHeight`, `scanLineStep`,
  `minDistancePct`.
- `computeSafeRuns(img, s)`: gom hàng an toàn liên tiếp thành `SafeRun[]` (`{start, end}`,
  end exclusive).
- `chooseCuts(runs, height, s)`: tham lam — mỗi bước xét cửa sổ
  `(currentY+minBandHeight, currentY+maxBandHeight]`, ưu tiên gutter (run ≥ `minGutterHeight`)
  dày nhất có tâm rơi trong cửa sổ; không có gutter đạt tư cách thì snap về hàng an toàn gần
  cuối cửa sổ nhất (`lastSafeRowInRange`), hết cách thì ép cắt tại cuối cửa sổ.
- `regionsFromCuts(cuts, width, height)`: band full-width, liền mạch, phủ kín `[0,height)`.
- `mergeLowInkBands(regions, img, s)`: một pass — band mật độ mực (`gray<250`) dưới
  `minInkDensity` gộp vào band liền trước (band đầu gộp về sau); sau đó band cuối cùng thấp
  hơn `minBandHeight` gộp vào band trước, bất kể mật độ mực.
- `splitGray(img, s)` = `mergeLowInkBands(regionsFromCuts(chooseCuts(computeSafeRuns(img,s), ...)))`.
- `detectBands(canvas, settings?)`: CHỮ KÝ GIỮ NGUYÊN — vẫn `toGray` rồi `splitGray`.

Export để test từng phần: `computeSafeRuns`, `chooseCuts`, `regionsFromCuts`, `mergeLowInkBands`,
`splitGray`, `detectBands`, `readSplitSettings`, `toGray`, `isSafeLine` (như bản cũ export
`findSplitPosition`/`isSafeLine`).

## Điểm lệch spec — có lý do, không phải nới lỏng test

1. **`lastSafeRowInRange` không nhận `img`.** Spec mô tả hàm này bằng lời là "quét ảnh từ hi
   xuống lo", nhưng dòng compose ở mục 5 của phase file gọi
   `chooseCuts(computeSafeRuns(img,s), img.height, s)` — CHỈ 3 tham số, không có `img`. Hai chỗ
   trong spec mâu thuẫn nhau; tôi bám chữ ký compose (nguồn xác thực hơn vì nó ràng buộc trực
   tiếp cách `splitGray` gọi `chooseCuts`) và triển khai `lastSafeRowInRange(runs, lo, hi)` dựa
   trên `SafeRun[]` đã gom sẵn thay vì quét lại pixel — hai cách cho kết quả TOÁN HỌC GIỐNG HỆT
   nhau (runs đã mã hoá đầy đủ hàng nào an toàn), chỉ khác cách triển khai (rẻ hơn: O(runs) thay
   vì O(pixels)).

2. **`extendCarry` là hàm phụ không có trong spec.** Khi implement `mergeLowInkBands` theo đúng
   pseudocode dạng `carry = carry ? {...carry,...} : {...r}` bên trong vòng `for`, TypeScript
   (`strict`, dự án dùng `tsc --noEmit`) báo lỗi TS7022/TS2698 tuỳ biến thể thử — self-referential
   ternary assignment trên biến `let` nullable bên trong loop khiến trình biên dịch suy luận kiểu
   vòng lặp lẫn nhau. Tái hiện lỗi độc lập bằng file tạm (`/tmp/ts-repro.ts`) trước khi sửa để
   chắc nguyên nhân không phải do code khác. Khắc phục bằng cách tách phần "nối carry" ra hàm
   thuần `extendCarry(carry, r): BeatRegion` (tham số độc lập, không đóng gói biến ngoài) — `tsc`
   sạch, và 3 nhánh test T6 (giữa/đầu/cuối) chạy lại vẫn pass sau khi tách. Hành vi không đổi.

3. **Test 4 (T4) và Test 5 (T5) trong kịch bản kiểm thử là property-based** (kiểm bất biến
   `h ∈ [min,max]` trừ cuối, và contiguity) thay vì hard-code một dãy band cụ thể như style cũ —
   phù hợp hơn với bản chất "invariant" của các bất biến này; T5 tái dùng đúng bộ `cuts` đã tính
   tay/verify từ T4 để không rời rạc hoá logic.

4. **Test ingest** giữ nguyên bố cục 3 trang màu phẳng cũ (chỉ đổi kỳ vọng theo default mới:
   `SPLIT_HEIGHT` mặc định 1600 → `minBandHeight=960`, `maxBandHeight=2240`). Vì cả 3 trang là
   màu phẳng, MỌI hàng trên toàn canvas 2700px đều an toàn (đồng nhất theo chiều ngang) →
   `computeSafeRuns` gom thành đúng MỘT gutter dài 2700px → `chooseCuts` cắt một lần tại tâm
   gutter (y=1350) → 2 band 1350px mỗi band. Đã tính tay và verify khớp script.

## Defaults chốt (`readSplitSettings`)

| Env | Default | Ghi chú |
|---|---|---|
| `LINE_TOLERANCE` | 25 | giữ nguyên bản cũ |
| `IGNORABLE_BORDER` | 5 | giữ nguyên bản cũ |
| `MIN_GUTTER_HEIGHT` | 24 | mới |
| `MIN_INK_DENSITY` | 0.02 | mới, đọc bằng `parseFloat` |
| `MIN_BAND_HEIGHT` | không set → `round(0.6 × SPLIT_HEIGHT)` | `SPLIT_HEIGHT` mặc định 1600 → 960 |
| `MAX_BAND_HEIGHT` | không set → `round(1.4 × SPLIT_HEIGHT)` | → 2240 |
| `SCAN_LINE_STEP`, `MIN_DISTANCE_PCT` | — | không còn đọc (thuật toán cũ) |

`SPLIT_HEIGHT` vẫn đọc được — `.env` cũ (chỉ set `SPLIT_HEIGHT`) tiếp tục chạy, chỉ đổi hành vi
cắt (theo gutter thay vì cố định).

## Kết quả `tsx scripts/verify-banding.mts`

Toàn bộ 9 test block (T1-T6 thuật toán mới, Test stitch, Test ingest, Test PDF, + 1 regression
end-to-end qua `detectBands` trên bố cục T1) PASS:

```
T1 ✓✓✓  T2 ✓✓  T3 ✓✓✓  T4 ✓✓  T5 ✓✓✓✓  T6 ✓✓✓✓
Test stitch ✓✓✓✓✓
Test ingest ✓✓✓
Test PDF ✓✓
Regression (detectBands) ✓✓✓

ALL_PASS
```

## Verify khác

- `pnpm exec eslint lib/smart-split.ts` — sạch (exit 0, 0 problem). `scripts/**` bị
  `globalIgnores` loại khỏi eslint từ trước (config có sẵn, không phải do tôi thêm) — đã xác
  nhận bằng `eslint.config.mjs`.
- `pnpm exec tsc --noEmit -p tsconfig.json` (toàn project, dù không bắt buộc theo scope Phase 2)
  — sạch. Chạy để xác nhận không phá `lib/pipeline.ts` (consumer duy nhất gọi
  `detectBands(canvas.buffer)` không truyền settings — chữ ký `detectBands`/`BeatRegion` không
  đổi, đã grep xác nhận).
- `git status` xác nhận chỉ 2 file sở hữu (`lib/smart-split.ts`, `scripts/verify-banding.mts`)
  bị sửa; các file của agent song song (`lib/jobs.ts`, `lib/storyboard-store.ts`, 2 route,
  `app/page.tsx`, `app/storyboard/[jobId]/page.tsx`, `scripts/verify-ingest.mts`,
  `scripts/e2e-storyboard.mts`) không bị chạm.

## Lưu ý tinh chỉnh ngưỡng

- Risk đã biết trước (ghi trong phase file): merge có thể đẩy band vượt `maxBandHeight` sau khi
  gộp band gần trắng/band cuối ngắn — CHẤP NHẬN theo đúng risk assessment của phase, không khoá
  test cho trường hợp này (chỉ khoá "không còn band density thấp" + "band cuối ngắn được gộp").
- Ngưỡng default (`minGutterHeight=24`, `minInkDensity=0.02`, tỉ lệ 0.6×/1.4× cho min/max) là
  giá trị từ spec, chưa tune theo dữ liệu truyện thật — để Phase 3 (env-tunable đã sẵn, chỉ cần
  cập nhật `.env.example`).
