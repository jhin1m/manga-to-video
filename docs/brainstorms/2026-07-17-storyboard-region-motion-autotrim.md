# Brainstorm — Storyboard: nối dây region, ghi đè hiệu ứng, auto-trim khoảng trắng

- **Ngày:** 2026-07-17
- **Trạng thái:** Đã lập plan → `plans/260717-1702-storyboard-region-motion-autotrim/`
- **⚠️ ĐÃ BỊ SỬA BỞI SỐ ĐO:** spike trên corpus thật **bác bỏ auto-trim** (mục 8) — tiết kiệm TB chỉ
  **7.3%**, 2/27 band đạt ngưỡng; khoảng trắng nằm giữa ảnh chứ không ở lề (webtoon full-bleed ngang).
  Auto-trim bị **bỏ**, chỉ giữ nút thủ công. Cùng spike xác nhận chẩn đoán mục 4 bằng số: **25/27 band
  → `pan-v`**. Xem `plans/260717-1702-storyboard-region-motion-autotrim/reports/spike-260717-1720-ink-bbox-calibration-tren-corpus-that-report.md`.
  Đọc mục 8 dưới đây như bối cảnh lịch sử, KHÔNG phải scope hiện hành.
- **Flags:** (none)
- **Touchpoint chính:** `content-extractor/lib/script.ts`, `lib/kenburns.ts`, `components/region-cropper.tsx`
- **Tiền nhiệm:** `docs/brainstorms/2026-07-09-storyboard-region-cropper-ux.md` (Tầng 1 — đã ship, commit `9519209`)

## 1. Than phiền gốc

3 yêu cầu: (a) vùng ảnh Storyboard dễ dùng hơn; (b) thêm hiệu ứng + tuỳ chọn thay vì chỉ Auto
(mặc định vẫn auto); (c) tự động cắt nội dung chính, bỏ khoảng trắng, auto cắt panel.

Khớp gần 1:1 mục "Ngoài phạm vi — Tầng 2" của brainstorm 07-09.

## 2. Phát hiện chặn đường: region KHÔNG tới render

Đường đi thật: `Beat.region` → **bị vứt** → render Ken Burns trên cả band.

Bằng chứng:
- `lib/script.ts:40-45` — `ScriptBeatInput` không có field `region`.
- `lib/script.ts:157-161` — `toScriptSegments` tạo mọi shot với `region: null` cứng.
- `app/api/jobs/[id]/storyboard/script/route.ts:48-61` — map beat → input, không mang region.
- `app/.../export-bundle/route.ts:17` — **bắt buộc** có script mới render → không có đường vòng.
- `lib/timeline.ts:109` + `scripts/render-video.mts:183` — render đọc `shot.region` (luôn null).
- `RegionCropper` chỉ xuất hiện ở `app/storyboard/[jobId]/page.tsx:470`; script/video page không có.

Region hiện chỉ còn 2 tác dụng: giới hạn vùng gửi vision khi bấm ✨ Generate
(`beats/[beatId]/generate`) và ảnh crop preview. **Không ảnh hưởng video.**

## 3. Nguồn gốc (không phải bug ngẫu nhiên)

`docs/journals/2026-07-07-band-ingest-storyboard-simplification.md:15-16` — refactor band-ingest
chốt "**1 band = 1 nhịp, region null**". Ingest stitch → `detectBands` → mỗi band 1 item. Sợi dây
region→render đứt từ đó. Stage 2 (07-08) dựng script layer trên tiền đề ấy.

→ Brainstorm 07-09 khẳng định "bỏ region = mất Ken Burns → slideshow" là **sai với code sau 07-07**.
Tầng 1 (handles + preview sống) vì vậy đang đánh bóng một nút **chưa nối dây**. Ghi lại để không
lặp lại lỗi suy luận: brainstorm đó đọc `kenburns.ts` nhưng không truy `shot.region` ngược về nguồn.

## 4. Vì sao "chỉ có Auto" (chẩn đoán bệnh đơn điệu)

`planKenburns` (`lib/kenburns.ts:49-91`) suy mode từ **hình dạng** region. region luôn null → luôn
là shape cả band → band từ smart-split đều cao/hẹp → gần như luôn `pan-v`, còn lại `zoom`.
Đơn điệu **có hệ thống**, không phải cảm giác. `RenderConfig.kenburns` cũng chỉ có `{ zoom }`
(`lib/schema.ts:252`).

→ "Thêm hiệu ứng" và "region không tới render" là **cùng một bệnh**, không phải 2 việc.

## 5. Quyết định (chốt qua hỏi đáp)

| Hạng mục | Chốt |
|---|---|
| Region → render | Nối dây `Beat.region` → `Shot.region` |
| Hiệu ứng | Ghi đè mode + hướng, **per-nhịp**, mặc định `auto` |
| Auto cắt | **Chỉ trim khoảng trắng** quanh nội dung (bbox mực) |
| Trim trigger | Cả hai: tự động lúc ingest + nút chỉnh lại |
| Nguồn | Webtoon/manhwa strip dọc |
| Luồng | Chỉnh **trước** khi tạo kịch bản → copy 1 chiều, không cần đồng bộ |
| Thứ tự | P0 → P1 → P2, auto-trim bật **cuối** |

## 6. P0 — Nối dây (nền móng)

~10 dòng. `1 beat = 1 shot` map 1:1 qua `sourceBeatIds` nên copy 1 chiều lúc generate là đủ.

```
ScriptBeatInput  += region, motion            lib/script.ts:40
toScriptSegments:  region: inputs[idx].region lib/script.ts:159  ← thay `region: null`
script/route.ts:   map thêm beat.region/motion   :55-60
Shot             += motion?                   lib/schema.ts:165
```

- **Đánh đổi đã chấp nhận:** sửa beat sau khi có kịch bản → phải tạo lại kịch bản. UI phải nói rõ,
  không âm thầm.
- ⚠️ **Đổi output render của mọi project đang có region đã vẽ.** Đúng ý định, nhưng không vô hại.

## 7. P1 — Ghi đè hiệu ứng

```ts
export type MotionMode = 'auto' | 'pan-v' | 'pan-h' | 'zoom' | 'static';
export interface MotionOverride {
  mode: MotionMode;    // 'auto' = suy từ shape — nhánh hiện tại, giữ nguyên
  reverse?: boolean;   // lia ↑ / lia ← / zoom out
}
```

Rẻ vì `planKenburns` đã thuần:
- `planKenburns` nhận `motion?`; `auto` đi nguyên nhánh cũ.
- filtergraph: `reverse` = đổi `t/dur` → `(1 - t/dur)` (pan), đảo `1→zoom` thành `zoom→1` (zoompan).
- `static` = zoom hệ số 1. Preview CSS: `p` → `1-p` (`lib/kenburns-css.ts:21-44`).

**Mode bất khả thi** — ép `pan-h` lên vùng cao/hẹp là bất khả (scale chiều cao khớp khung thì bề
rộng không dư để lia). Chốt: `availableModes(region, aspect)` → **disable + tooltip** ("vùng này
quá hẹp để lia ngang"). Không chọn hướng "cho chọn rồi âm thầm blur-fill" — ra kết quả kỳ quặc mà
người dùng không hiểu vì sao.

**UX (trả lời "dễ dùng hơn"):** KHÔNG thêm panel điều khiển. Biến **chip nhãn** đang có sẵn trên
preview (`region-cropper.tsx:164-166`, `kenburnsModeLabel`) thành dropdown. Chỗ đang *báo* hệ thống
định làm gì trở thành chỗ *bảo* nó làm khác. Không tốn thêm pixel, và tự dạy quan hệ hình-dạng ↔
chuyển động: chỉnh hộp → chip đổi.

## 8. P2 — Trim khoảng trắng

Module thuần `lib/ink-bbox.ts` — nhận gray array + w/h, **không import sharp** → một logic, hai đầu:
- **Server** (auto ingest): `pipeline.ts` đã gọi `toGray(canvas)` cho `detectBands`; band là
  sub-rect của chính canvas đó → tính bbox trong pass sẵn có, **zero decode thêm**. Quy bbox về gốc
  band (`bbox.x - band.x`, `bbox.y - band.y`).
- **Client** (nút "Vừa khít nội dung"): cropper đã nạp `<img>` + vẽ canvas → `getImageData` → gọi
  cùng hàm. **Không cần API mới.**

Thuật toán: projection profile hàng + cột; hàng/cột tính là "có nội dung" khi **≥ ngưỡng tỉ lệ
pixel mực** — KHÔNG phải "pixel mực đầu tiên" (ngưỡng tỉ lệ mới chống được nhiễu JPEG + watermark
mảnh). Tái dùng `ignorableBorder` của smart-split cho viền; `regionInkDensity`
(`lib/smart-split.ts:181-190`) hiện private → cân nhắc export.

**Hai cạm bẫy phải chặn từ đầu:**
1. **Khoảng trắng là ngôn ngữ kể chuyện, không phải rác.** Trim sát mực = bóp nhân vật vào mép,
   mất không gian thở. → Padding rộng tay + **chỉ trim khi có lợi rõ ràng** (tiết kiệm ≥ ~10% diện
   tích mới áp, không thì để `null`). Auto-trim phải là kẻ nhút nhát.
2. **Trim đổi shape → đổi mode.** Band `2000×800` (`pan-v`) trim còn `1200×800` → dưới `STRIP_SHAPE`
   (1.6) → rơi sang `zoom`. Bật auto-trim = **đổi hiệu ứng hàng loạt** cả chương. Có thể chính là
   thuốc trị đơn điệu — nhưng phải là lựa chọn có ý thức, không phải tác dụng phụ. → **Đây là lý do
   P1 làm trước P2**: có nút giành lại quyền trước khi auto đoán sai.

Nền đen full-bleed → mọi pixel < 250 = ink → bbox = cả band → trim no-op. An toàn.

## 9. Ngoài phạm vi (YAGNI — đã loại ở vòng hỏi)

Tách panel XY-cut; transition giữa shot (fade/dissolve — việc KHÁC, nằm ở khâu concat); hiệu ứng
mới (shake/dolly/parallax); preset khung; `strength`/độ mạnh pan-zoom; mặc định FX toàn dự án;
crop nguồn huỷ-diệt (Frame A của 07-09).

## 10. Acceptance criteria

- Vẽ region → tạo kịch bản → render: khung hình video **khớp** region (hiện: bỏ qua hoàn toàn).
- Chọn "Lia dọc ↑" → video lia **lên**; "Tĩnh" → không chuyển động. `auto` = hành vi y hệt hôm nay.
- Mode bất khả với vùng đang chọn → mờ + tooltip, không render kết quả kỳ quặc.
- Nút "Vừa khít nội dung" co region bỏ lề trắng, còn padding thở; band không có lề thừa → không đụng.
- Toạ độ vẫn px ảnh working thật (`toWorking` giữ nguyên); `BeatRegion` + PATCH beat giữ hợp đồng.
- `.mtvproj`: `motion` là field mới trên Beat/Shot → kiểm tra import/export project còn round-trip.

## 11. Rủi ro

- P0 đổi output render mọi project có region đã vẽ (chủ ý, nhưng cần thông báo).
- Preview CSS chỉ **xấp xỉ** — kế thừa từ 07-09, chấp nhận (duyệt bố cục, không phải bản chuẩn).
- Auto-trim đoán sai trên band nền phức tạp → P1 làm trước để có đường ghi đè.
- `sourceKind: 'pages'` hardcode (`storyboard/route.ts:50`) là nhãn thừa sau refactor 07-07 — không
  đụng lần này, nhưng ghi nhận là nợ.
- Next.js bản tuỳ biến — đọc `node_modules/next/dist/docs/` trước khi code (AGENTS.md).

## 12. Bước tiếp theo

Lập plan 3 phase (P0 nối dây → P1 motion override → P2 auto-trim). `--tdd` đáng cân nhắc cho P0/P1:
`planKenburns` + `toScriptSegments` là module thuần, dễ khoá hành vi bằng test trước khi đổi — và
P0 chính là thứ đổi output render đang chạy.

## 13. Câu hỏi mở

- Padding trim cụ thể (% hay px cố định) và ngưỡng "có lợi rõ ràng" (~10%?) — chốt bằng thử trên
  ảnh thật lúc lập plan.
- Beat sửa sau khi có kịch bản: UI cảnh báo "cần tạo lại kịch bản" đặt ở đâu — Storyboard hay Script?
