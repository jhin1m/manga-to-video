---
phase: 2
title: "Ghi đè hiệu ứng per-nhịp"
status: done
priority: P1
effort: "6-8h"
dependencies: [1]
---

# Phase 2: Ghi đè hiệu ứng per-nhịp

## Overview

Cho người dùng giành lại quyền khi `planKenburns` đoán sai: mỗi nhịp chọn được mode + đảo hướng,
mặc định `auto` giữ **nguyên xi** hành vi hôm nay. Trị bệnh "chỉ có Auto" mà Phase 1 mới chỉ tạo
điều kiện cần.

**Research nền:** [`from-researcher-to-planner-260717-1641-ffmpeg-reverse-kenburns-expressions-report.md`](../reports/from-researcher-to-planner-260717-1641-ffmpeg-reverse-kenburns-expressions-report.md)
— biểu thức reverse đã được xác minh tới tận source C của FFmpeg, không phải đoán.

## Requirements

**Functional**
- [ ] Mỗi nhịp chọn: Auto | Lia dọc | Lia ngang | Zoom | Tĩnh, kèm cờ đảo hướng
- [ ] `auto` (mặc định) → filtergraph **byte-identical** với trước plan này
- [ ] Mode bất khả thi với vùng đang chọn → disable + tooltip, KHÔNG âm thầm blur-fill
- [ ] Preview CSS trong cropper phản ánh đúng mode/hướng đã chọn
- [ ] `motion` round-trip qua `.mtvproj`

**Non-functional**
- [ ] `planKenburns`/`kenburns`/`kenburns-css` giữ **thuần** — không I/O, test được bằng string assert
- [ ] Beat/Shot không có `motion` (project cũ) → coi như `auto`, tương thích ngược

## Architecture

### Hợp đồng dữ liệu

```ts
// lib/schema.ts
export type MotionMode = 'auto' | 'pan-v' | 'pan-h' | 'zoom' | 'static';
export interface MotionOverride {
  mode: MotionMode;
  reverse?: boolean;   // lia ↑ / lia ← / zoom-out. VÔ NGHĨA với 'static' và 'auto'
}
// Beat.motion?: MotionOverride    (UI chỉnh)
// Shot.motion?: MotionOverride    (render đọc)
```

`undefined` = `auto`. Không đặt default cứng `{mode:'auto'}` — giữ field optional để project cũ và
`.mtvproj` cũ tự khớp mà không cần migration.

### ⚠️ Cạm bẫy rớt field im lặng

`toStoryboardManifest` (`lib/schema.ts:148-157`) và `toScriptManifest` (`:209-217`) map **tường minh
từng field**. Quên thêm `motion` vào **cả hai** → `motion` biến mất khi export `.mtvproj`, không có
lỗi nào báo. Dùng cùng mẫu spread có điều kiện đang có sẵn:
```ts
...(b.motion !== undefined ? { motion: { ...b.motion } } : {}),
```
Chiều import thì an toàn sẵn: `project/import/route.ts:88` dùng `...b` spread.

### Biểu thức ffmpeg (đã xác minh)

| Mode | Forward | Reverse |
|---|---|---|
| pan-v / pan-h | `'base+travel*(t/dur)'` | `'base+travel*(1-t/dur)'` |
| zoom | `z='1+(Z-1)*on/(frames-1)'` | `z='Z-(Z-1)*on/(frames-1)'` |

Rút thành một chỗ, dùng chung cả 2 trục:
```ts
const frac = reverse ? `(1-t/${dur.toFixed(3)})` : `(t/${dur.toFixed(3)})`;
```

Ghi chú từ research (đừng phát minh lại):
- `crop` tự kẹp giá trị x/y ngoài biên → sai số float tự lành. Không cần guard thêm.
- `on` **0-indexed** (trace `vf_zoompan.c:175/289` + `avfilter.c:1107`) → công thức `on/(frames-1)`
  hiện tại đúng, reverse giữ nguyên dạng đóng.
- Jitter của zoompan là **direction-agnostic** (do truncate int cửa sổ crop mỗi frame) → mẹo
  supersample ×2 sẵn có ở `kenburns.ts:126,138` che luôn zoom-out. **Không cần làm gì thêm.**
- **CẤM** dùng idiom `z='if(eq(on,1),Z,zoom-step)'` — tự tham chiếu frame trước, tích luỹ sai số FP.
- Undershoot frame cuối (`t` không bao giờ chạm đúng `dur`) là **lỗi có sẵn của nhánh forward**,
  không phải do reverse sinh ra. Ngoài phạm vi phase này — đừng "tiện tay sửa".

### `static` — bỏ hẳn zoompan

`zoompan` tồn tại trong file này để animate `z`. Không animate thì đừng gọi nó (research Q3):
- **Khớp tỉ lệ khung** → `scale` + `crop` tĩnh. Tái dùng đúng nhánh pan với `travelPx = 0` mà
  `kenburns.ts:104-107` **đã** xử lý sẵn (`travelPx > 0 ? expr : String(basePx)`).
- **Lệch tỉ lệ** → blur-fill: giữ nguyên dòng `bg` (`:137`), riêng `fg` thay `zoompan` bằng
  `scale=${fw}:${fh}` — không cần supersample ×2 (không có gì đổi giữa các frame thì không có
  rounding drift để mà jitter).
- KHÔNG dùng `zoompan` với `z=1`: `.toFixed(4)` có thể ra không đúng `1.0` → micro-zoom ngoài ý muốn.
- `even()` vẫn bắt buộc cho `fw`/`fh` (yuv420p đòi kích thước chẵn) — không đổi.

**Quyết định tường minh:** `reverse` là **no-op im lặng** với `static` và `auto`. Không ném lỗi —
`auto` + reverse là tổ hợp UI có thể dựng ra khi người dùng đổi mode qua lại, ném lỗi ở đó là phiền
vô ích. Ghi comment tại `planKenburns` để người sau không tưởng là bug.

### Mode khả thi

```ts
export function availableModes(region, imgW, imgH, aspect): MotionMode[]
```
- `auto`, `zoom`, `static`: **luôn** khả thi (đã có blur-fill lo phần lệch tỉ lệ).
- `pan-v`: chỉ khi `coverV >= PAN_MIN_COVER` (1.05) — phải có phần dư dọc để mà lia.
- `pan-h`: chỉ khi `coverH >= PAN_MIN_COVER`.

**Cố ý bỏ trần `PAN_MAX_COVER` (3) khi ép thủ công.** Trần đó tồn tại để *auto* không tự chọn cú pan
phóng đại quá đà; người dùng chủ động ép thì tôn trọng. An toàn vì `MAX_PAN_FRAME_PER_SEC` (0.35)
vẫn kẹp vận tốc. Ghi rõ khác biệt này vào comment — nếu không, người sau sẽ tưởng là quên đồng bộ.

### UX — chip thành dropdown, không thêm panel

Chip nhãn `kenburnsModeLabel` đang nằm sẵn trên preview (`region-cropper.tsx:164-166`) → biến chính
nó thành dropdown. Chỗ đang *báo* hệ thống định làm gì trở thành chỗ *bảo* nó làm khác. Không tốn
thêm pixel nào, và tự dạy quan hệ hình-dạng ↔ chuyển động: kéo hộp → chip đổi theo.

- Mode đang là `auto` → chip hiện nhãn suy ra kèm dấu hiệu "tự động" (vd "Auto · Lia dọc ↓").
- Mode ép tay → hiện nhãn đã chọn, không có chữ "Auto".
- Nút đảo hướng: chỉ hiện khi mode hiện hành có hướng (`pan-v`/`pan-h`/`zoom`).

## Related Code Files

- Modify: `lib/schema.ts` — `MotionMode`/`MotionOverride`, `Beat.motion`, `Shot.motion`,
  `toStoryboardManifest` (148-157), `toScriptManifest` (209-217)
- Modify: `lib/kenburns.ts` — `KenburnsInput.motion`, `planKenburns` (49-91), `kenburns` (95-142),
  thêm `availableModes`
- Modify: `lib/kenburns-css.ts` — `kenburnsFrameStyle` nhận reverse (`p` → `1-p`), nhãn mode
- Modify: `components/region-cropper.tsx` — chip → dropdown + nút đảo hướng, disable mode bất khả
- Modify: `app/storyboard/[jobId]/page.tsx` — wire `motion` → PATCH
- Modify: `app/api/jobs/[id]/storyboard/beats/[beatId]/route.ts` — parse + validate `motion`
- Modify: `lib/storyboard-store.ts` — `updateBeat` patch `motion` (137-155)
- Modify: `lib/script.ts` + `app/api/jobs/[id]/storyboard/script/route.ts` — nối `motion` (3 chỗ y
  như Phase 1 đã làm cho `region`)
- Read-only: `app/video/[jobId]/page.tsx:303-335` (trang video dùng chung `kenburns-css` — đổi chữ
  ký hàm là đụng nó, kiểm tra không vỡ)

## Implementation Steps

1. **Chốt hợp đồng trước, UI sau.** `lib/schema.ts`: `MotionMode`, `MotionOverride`, `Beat.motion?`,
   `Shot.motion?`. Thêm `motion` vào **cả hai** hàm manifest ngay lúc này — đừng để cuối, đó là chỗ
   dễ quên nhất.

2. `lib/kenburns.ts` — `planKenburns` nhận `motion?`:
   - `undefined` hoặc `mode: 'auto'` → **return sớm theo nhánh cũ, không đổi một dòng nào**.
   - mode ép → dựng plan tương ứng, tính `travelPx`/`basePx`/`blurFill` bằng đúng công thức sẵn có.
   - `KenburnsPlan` thêm `reverse?: boolean` để `kenburns()` và `kenburns-css` cùng đọc từ một nguồn.

3. `lib/kenburns.ts` — `kenburns()`: rút `frac` dùng chung, thêm nhánh `static`. Nhánh `auto` phải ra
   **chuỗi y hệt** trước đó.

4. `availableModes()` — thuần, không phụ thuộc React. Export cho cropper.

5. `lib/kenburns-css.ts` — `kenburnsFrameStyle` đọc `plan.reverse` → `p` → `1-p`; `static` → khung
   đứng. ⚠️ Trang video (`app/video/[jobId]/page.tsx:303-335`) dùng chung hàm này — đổi chữ ký thì
   phải sửa cả hai chỗ gọi.

6. **API + store**: `beats/[beatId]/route.ts` thêm `motion` vào `PatchBody` + `parsePatchBody`
   (validate `mode` thuộc enum, `reverse` là boolean — mẫu `parseRegion` dòng 21-35).
   `storyboard-store.ts:140` mở rộng `Pick<Beat, ...>` + `if (patch.motion !== undefined)`.
   `updateBeat` đã tự tăng `beat.rev` → compose đang bay bị vô hiệu, đúng ý.

7. **Nối `motion` vào script** — lặp lại đúng 3 điểm Phase 1: `ScriptBeatInput`, `toScriptSegments`,
   `script/route.ts`.

8. **UI cropper**: chip → dropdown; disable mode không có trong `availableModes` + tooltip lý do
   ("vùng này quá hẹp để lia ngang"); nút đảo hướng theo điều kiện.

9. **Verify**:
   ```bash
   nvm use 24
   pnpm build
   pnpm tsx scripts/verify-kenburns-css.mts
   pnpm tsx scripts/verify-render.mts
   ```
   - **Regression gate quan trọng nhất**: với `motion` undefined, chuỗi filtergraph phải **byte-identical**
     với trước phase này. So bằng string assert (rẻ, không cần ffmpeg — research Q4 tier 1).
   - Reverse thật sự đảo: render 1 shot, trích frame đầu/cuối, xem bằng mắt:
     ```bash
     ffmpeg -y -i shot.mp4 -vf "select=eq(n\,0)" -vframes 1 first.png
     ffmpeg -y -sseof -1 -i shot.mp4 -update 1 -q:v 2 last.png
     ```
     Mở 2 PNG bằng Read tool, xác nhận nội dung trên/dưới (pan-v) đã hoán đổi so với bản forward.

10. **Round-trip `.mtvproj`** với `motion` ≠ undefined: export → import → render → mode giữ nguyên.
    Đây là gate duy nhất bắt được lỗi quên `motion` ở hàm manifest.

## Success Criteria

- [ ] `motion` undefined → filtergraph byte-identical bản trước phase (string assert)
- [ ] "Lia dọc" + đảo hướng → video lia **lên**; frame đầu/cuối hoán đổi so với forward
- [ ] "Tĩnh" → video đứng yên, filtergraph **không chứa** `zoompan`
- [ ] Vùng cao/hẹp → nút "Lia ngang" bị mờ + tooltip giải thích
- [ ] Kéo hộp → chip đổi nhãn theo (mode `auto`)
- [ ] `.mtvproj` export→import giữ `motion`; project cũ không có `motion` vẫn chạy như `auto`
- [ ] Trang video (`/video/[jobId]`) không vỡ sau khi đổi chữ ký `kenburns-css`
- [ ] `pnpm build` + 2 script verify xanh

## Risk Assessment

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| `motion` rớt im lặng khi export `.mtvproj` | **Cao** | Thêm vào cả 2 hàm manifest ở bước 1 (không để cuối) + gate round-trip bước 10 |
| Nhánh `auto` bị đổi vô tình → hồi quy toàn bộ video cũ | **Cao** | String assert byte-identical; return sớm cho `auto` thay vì lồng if |
| Đổi chữ ký `kenburns-css` làm vỡ trang video | Trung | Grep chỗ gọi trước khi đổi; `verify-kenburns-css.mts` + mở `/video/[jobId]` |
| Ép pan trên vùng `coverV > 3` → ảnh scale to, hơi mờ | Thấp | Chủ ý (tôn trọng lựa chọn người dùng); `MAX_PAN_FRAME_PER_SEC` vẫn kẹp vận tốc |
| `reverse` + `static` thành footgun im lặng | Thấp | Quyết định tường minh: no-op + comment tại `planKenburns` |

## Notes

- Undershoot frame cuối là lỗi có sẵn của nhánh forward — **ngoài phạm vi**, đừng tiện tay sửa
  (sẽ làm hỏng gate byte-identical).
- Research chưa pin phiên bản ffmpeg của repo so với master; ngữ nghĩa biến `crop`/`zoompan` ổn định
  từ 4.x–7.x nên rủi ro thấp, nhưng nếu thấy hành vi lạ thì kiểm tra `ffmpeg -version` trước tiên.
- Phase này sửa `lib/schema.ts` — working tree đang có thay đổi TTS chưa commit ở cùng file. Kiểm
  tra conflict trước khi bắt đầu.
