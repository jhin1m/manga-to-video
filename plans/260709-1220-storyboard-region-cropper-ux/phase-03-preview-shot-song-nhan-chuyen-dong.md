---
phase: 3
title: "Preview shot song + nhan chuyen dong"
status: completed
effort: ""
priority: P2
dependencies: [1, 2]
---

# Phase 3: Preview shot sống + nhãn chuyển động (trị "mơ hồ")

## Overview

Cho người dùng **thấy ngay** cái hộp tạo ra gì: một ô preview đúng tỉ lệ khung, chạy lặp pan/zoom mà
`planKenburns` sinh cho hộp hiện tại, kèm một chip nhãn chuyển động. Dùng helper chung từ Phase 1.

## Requirements

- Functional: cạnh ảnh chọn vùng có ô preview nhỏ đúng tỉ lệ khung (mặc định `9:16`), hiển thị đúng
  phần trong region, **chạy lặp** chuyển động (pan-v/pan-h/zoom). Chip nhãn (từ `kenburnsModeLabel`)
  hiện mode hiện tại. Có toggle nhanh tỉ lệ `9:16 / 16:9 / 1:1` (chỉ để xem trước — không lưu vào
  beat). Preview cập nhật realtime theo `region` (kể cả khi đang kéo — dùng preview hộp `shown`).
- Non-functional: tôn trọng `prefers-reduced-motion` (đóng băng ở khung đầu, hoặc nút play/pause);
  RAF loop huỷ khi unmount/đổi nhịp; nhẹ (một `<img>` fg + một `<img>` blur bg như trang video).

## Architecture

Tái dùng cấu trúc player của trang video (`page.tsx:375-398`): container `containerType:'size'` +
`aspectRatio: ASPECT_CSS[aspect]`, lớp nền blur-cover mờ, lớp fg `style={{...fgStyle,
...imgTransformStyle}}`. Khác biệt: nguồn ảnh là **crop theo region** (không phải cả band), và `p`
do một RAF loop nội bộ chạy 0→1→0 (lặp) thay vì timeline thật.

Tạo component con `ShotPreview` (trong `region-cropper.tsx` hoặc file cạnh nó):

```tsx
function ShotPreview({ imageUrl, width, height, region, aspect, zoom }: {...}) {
  // 1. plan = planKenburns({ imgW:width, imgH:height, region, aspect, durationSec: NOMINAL, fps: 30, zoom })
  // 2. RAF loop: p đi 0→1 trong NOMINAL giây rồi lặp; reducedMotion → p cố định 0
  // 3. { fgStyle, imgTransformStyle } = kenburnsFrameStyle(plan, p, zoom)  // helper Phase 1
  // 4. render: container tỉ lệ ASPECT_CSS[aspect]; fg <img> nguồn = crop region (xem dưới)
}
```

**Nguồn ảnh preview = phần trong region.** Cách KISS nhất không cần API mới: đặt một `<div>` bọc
`overflow:hidden` mô phỏng khung region, đặt `<img>` full band bên trong với `transform` dịch/scale
sao cho chỉ phần region lọt vào — TÁI DÙNG chính cơ chế crop-bằng-CSS. Nếu quá rối, phương án B:
cắt thật qua canvas client (`drawImage(img, region..., 0,0,...)`) tạo dataURL một lần mỗi khi region
đổi, rồi feed dataURL đó vào player như trang video. **Chốt phương án lúc code** — ưu tiên A (thuần
CSS, không tạo bitmap); rơi về B nếu canh transform region + Ken Burns cùng lúc quá phức tạp.

Nhãn: `kenburnsModeLabel(plan.mode)` → chip đặt trên/《cạnh》preview. Tỉ lệ: state cục bộ
`aspect` (default `'9:16'` từ `defaultRenderConfig`), segmented toggle nhỏ; `zoom` lấy hằng mặc định
(vd `config.kenburns.zoom` mặc định ~1.15 — đọc từ `defaultRenderConfig().kenburns.zoom`).

`NOMINAL` (durationSec cho preview): hằng ~4s. Lưu ý `planKenburns` kẹp `travelPx` theo `durationSec`
→ preview 4s có thể khác quãng chạy shot thật; chấp nhận (preview là xấp xỉ) hoặc chú thích nhỏ.

## Related Code Files

- Modify: `content-extractor/components/region-cropper.tsx` — thêm `ShotPreview`, prop `aspect?`
  (default `'9:16'`), state tỉ lệ + chip nhãn; đặt preview cạnh vùng ảnh (layout 2 cột trên desktop).
- Modify: `content-extractor/app/storyboard/[jobId]/page.tsx` — (tuỳ) truyền `aspect` mặc định /
  không cần nếu cropper tự default.
- Use: `content-extractor/lib/kenburns-css.ts` (Phase 1), `content-extractor/lib/kenburns.ts`
  (`planKenburns`), `content-extractor/lib/schema.ts` (`Aspect`, `defaultRenderConfig`).

## Implementation Steps

1. Đọc `node_modules/next/dist/docs/` phần liên quan (client component, RAF trong effect) (AGENTS.md).
2. Viết `ShotPreview` dùng `planKenburns` + `kenburnsFrameStyle`; RAF loop p=0→1 lặp; cleanup on
   unmount / khi `imageUrl|region|aspect` đổi; `prefers-reduced-motion` → tĩnh.
3. Hiện crop region trong preview (phương án A CSS; fallback B canvas dataURL).
4. Thêm chip `kenburnsModeLabel`; segmented toggle tỉ lệ (state cục bộ).
5. Bố cục lại RegionCropper: ảnh chọn vùng | preview cạnh nhau (desktop), xếp dọc (mobile); giữ khối
   "Nâng cao" + toggle "Cả trang".
6. Kiểm thử: kéo/resize hộp → preview + chip đổi realtime; 3 tỉ lệ; region cao→"Lia dọc", ngang→"Lia
   ngang", vuông→"Zoom"; cả-trang (region null) → preview cả band; reducedMotion đứng yên.

## Success Criteria

- [x] Ô preview đúng tỉ lệ khung, hiển thị đúng phần region, chạy lặp đúng mode `planKenburns`.
      (Chốt phương án B-biến-thể: crop region vẽ vào 2 `<canvas>` — canvas là replaced element
      có intrinsic size nên tái dùng nguyên fgStyle/object-fit của trang video, không cần
      dataURL; hạ cỡ `PREVIEW_MAX_EDGE=800` đỡ tốn bộ nhớ với strip cao.)
- [x] Chip nhãn khớp mode và đổi realtime khi hộp đổi hình dạng (`region={shown}` — cập nhật
      cả khi đang kéo).
- [x] Toggle 9:16/16:9/1:1 đổi preview; mặc định 9:16 (`defaultRenderConfig`).
- [x] `prefers-reduced-motion` tôn trọng (hook chung `use-reduced-motion.ts`, trang video cùng
      dùng); RAF huỷ trong cleanup, chỉ re-render nội bộ `ShotPreview`.
- [x] `BeatRegion`/API không đổi; `tsc`/lint/build sạch; `test:e2e` storyboard PASS.

## Risk Assessment

- **Crop region + Ken Burns transform chồng nhau (phương án A) rối** → fallback canvas dataURL
  (phương án B) cho ảnh nguồn preview, tách bạch crop khỏi Ken Burns.
- **RAF rò rỉ / nhiều nhịp** → huỷ trong cleanup effect theo key `imageUrl|region|aspect`.
- **Preview lệch bản render CLI** → nêu rõ "xem trước xấp xỉ" (đồng nhất thông điệp trang video).
- **Chi phí CPU khi loop liên tục** → có thể pause khi không hover/không kéo (tối ưu sau nếu cần —
  không phải chặn đứng của Tầng 1).
