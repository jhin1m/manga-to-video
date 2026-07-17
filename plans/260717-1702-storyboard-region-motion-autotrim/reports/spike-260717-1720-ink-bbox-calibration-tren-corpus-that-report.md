# Spike: calibrate ink-bbox trên corpus thật

- **Ngày:** 2026-07-17
- **Corpus:** "Vừa Gả Đã Làm Mẹ Kế Của Ba Nhóc Con" Chap 1.1 (NetTruyen) — 38 slice JPEG, webtoon MÀU
- **Mục đích:** chốt Phase 3 (auto-trim) bằng số đo, không phải suy luận
- **Kết luận:** 🔴 **auto-trim GATE ĐỎ → bỏ phần auto, chỉ giữ nút thủ công.** Đồng thời phát hiện
  bằng chứng số cho bệnh đơn điệu.

## Điều kiện đo

Dùng chính code repo: `stitchSlices` → `detectBands` → đo trên **band thật** (không phải slice gốc).

```
38 slice → canvas 720×50671 → detectBands → 27 band
settings: lineTolerance=25, ignorableBorder=5, minGutterHeight=24,
          minBandHeight=960, maxBandHeight=2240, minInkDensity=0.02
```

bbox = projection profile, ink `< 250` (gray công thức repo), ngưỡng tỉ lệ 1%/hàng-cột.

## Phát hiện 1 — Auto-trim vô ích trên corpus này

| Chỉ số | Giá trị |
|---|---|
| Tiết kiệm diện tích trung bình | **7.3%** |
| Band đạt ngưỡng "đáng trim" (≥15%) | **2/27** |
| Lề ngang thật | ~8px mỗi bên (720 → 704) ≈ **2%** |
| % pixel ≥250 trong band | 10–66% (rất nhiều trắng!) |

**Nghịch lý mấu chốt:** band có tới 10–66% pixel trắng nhưng bbox **không co được**. Vì khoảng trắng
nằm **giữa ảnh** (bong bóng thoại, nền panel), **không ở lề**. Mỗi hàng và mỗi cột đều có ≥1% mực →
bbox chạm cả 4 cạnh. Webtoon này **full-bleed ngang** — không có lề để cắt.

→ Đo trên slice gốc (trước stitch) cũng cho kết quả tương tự: TB 2.0%.

**2 band ngoại lệ đáng kể:** #14 (33.6%), #26 (15.9%) → **nút thủ công vẫn có ích cho chúng**.

## Phát hiện 2 (quan trọng hơn) — Bằng chứng số cho bệnh đơn điệu

Mode mà `planKenburns` sinh ra cho từng band (region=null, aspect 9:16):

| Mode | Số band |
|---|---|
| **`pan-v`** | **25/27** |
| `zoom` | 2/27 |
| `pan-h` | 0/27 |

**Video hiện tại = 25 cú lia dọc xuống liên tiếp.** Bệnh "chỉ có Auto" không phải cảm giác — là cấu
trúc. Xác nhận chẩn đoán của brainstorm bằng số đo.

### Phát hiện phụ — hiệu ứng đang do hằng số config quyết định

Rất nhiều band có `tallness` đúng **3.11 = 2240/720** = chạm trần `maxBandHeight`. Nghĩa là chúng
**bị ép cắt vì quá cao**, không phải cắt tại gutter tìm được.

→ Hình dạng band do trần quyết định → mode do trần quyết định. **Chuyển động camera đang bị điều
khiển bởi `MAX_BAND_HEIGHT`, không phải bởi nội dung truyện.** Nợ kiến trúc đáng điều tra riêng,
ngoài phạm vi plan này.

## Phát hiện 3 — Trim thật sự đổi hiệu ứng (xác nhận rủi ro đã ghi)

Band #14: `720×1129` (tallness 1.57 → `zoom`) → sau trim `516×1046` (tallness 2.03 → **`pan-v`**).

Xác nhận rủi ro "trim đổi shape → đổi mode" là thật, không phải lo xa.

## Phát hiện 4 — `< 250` gray là ĐỦ, không cần color-distance

Research cảnh báo `< 250` có thể vô dụng với webtoon màu (nền gradient → mọi pixel < 250 → bbox =
cả band). **Đo thực tế bác bỏ lo ngại này cho corpus này**: `< 250` vẫn co được bbox (band #14 tới
33.6%), tức gutter/nền trong truyện này **đủ gần trắng tinh**.

→ **Không cần** reference-color-distance + fuzz. Không cần đọc RGB. Không cần Otsu. YAGNI thắng —
tiết kiệm cả một thay đổi kiến trúc.

## Quyết định

| Hạng mục | Trước spike | Sau spike |
|---|---|---|
| Auto-trim lúc tạo storyboard | Có | ❌ **Bỏ** (7.3% không đáng) |
| Nút "Vừa khít nội dung" thủ công | Có | ✅ **Giữ** (2/27 band hưởng lợi) |
| Cơ chế ink | Chưa chốt (A hay B) | ✅ **A: `< 250` gray** — đo chứng minh đủ |
| Ngưỡng "đáng trim" 80-85% | Có | ❌ **Bỏ** — nút thủ công thì người dùng tự quyết |
| Móc `skeletonBeats`/`buildAndCompose` | Có | ❌ **Bỏ** — không còn auto |
| Phạm vi Phase 3 | ~4 file, 5-7h | ~2 file, ~2h |

## Tham số chốt cho nút thủ công

| Tham số | Giá trị | Nguồn |
|---|---|---|
| Ngưỡng ink | `< 250` gray (công thức repo) | Đo: đủ dùng trên corpus |
| Ngưỡng tỉ lệ hàng/cột | 1% | Đo với 1% cho kết quả hợp lý; sweep thêm nếu cần |
| Padding | 3-5% cạnh bbox, floor 12-16px | Research (thẩm mỹ, confidence THẤP) — người dùng thấy ngay nên chỉnh dễ |
| Ngưỡng đáng-trim | **không cần** | Nút thủ công: bấm = muốn trim; bbox=cả ảnh → no-op tự nhiên |

## Câu hỏi chưa giải quyết

1. Trần `MAX_BAND_HEIGHT=2240` ép cắt phần lớn band → mode bị hằng số quyết định. Đáng điều tra
   riêng — có nên nới trần / đổi chiến lược cắt không?
2. Chỉ đo 1 chương của 1 truyện. Truyện khác (nền tối, watermark to) có thể khác — nút thủ công thì
   rủi ro thấp nên không chặn.
3. Padding cụ thể chưa calibrate bằng mắt trên preview — chốt lúc code.

## Tái lập

Script đo nằm ở scratchpad phiên này (không commit — script tạm, không phải code sản phẩm):
`measure-ink.mjs` (slice gốc), `measure-bands.mts` (band thật sau stitch+detectBands).
Chạy: `nvm use 24`, `pnpm tsx <script> '<thư mục ảnh>'` từ `content-extractor/`.
