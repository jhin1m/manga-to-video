---
phase: 2
title: "Tay cam resize hop chon"
status: completed
effort: ""
priority: P2
dependencies: []
---

# Phase 2: Tay cầm resize hộp chọn (trị "sơ sài")

## Overview

Biến hộp region từ "chỉ vẽ mới / nhấc" thành công cụ crop thật: thêm 8 tay cầm (4 góc + 4 cạnh) để
kéo giãn từng cạnh/góc, kèm con trỏ gợi ý theo mode. Giữ nguyên map toạ độ và hợp đồng `BeatRegion`.

## Requirements

- Functional: khi có `region` (khác cả-trang), hiển thị 8 tay cầm trên viền hộp. Kéo tay cầm =
  resize với **neo cạnh/góc đối diện** cố định; kéo trong hộp = di chuyển (mode `move` sẵn có); kéo
  chỗ trống = vẽ mới (mode `draw` sẵn có). Con trỏ: `nwse/nesw/ns/ew-resize` theo tay cầm, `move`
  trong hộp, `crosshair` chỗ trống.
- Non-functional: mọi kết quả clamp trong biên `width×height` (dùng `clampRegion` sẵn có); kích
  thước tối thiểu ≥ 1px mỗi chiều; hoạt động khi ảnh co giãn responsive (qua `toWorking`).

## Architecture

Hiện `region-cropper.tsx` phân biệt mode ở `onPointerDown` (`:69-83`) bằng điểm bấm trong/ngoài
region → `move`/`draw`, và `computeRect` (`:87-103`) suy hộp mới. Mở rộng:

- Thêm mode `resize` với 8 neo. `DragState` thêm `handle?: Handle` (Handle = `'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'`)
  và lưu **cạnh cố định** (anchor) suy từ region lúc bấm.
- `onPointerDown`: hit-test tay cầm TRƯỚC (ưu tiên cao nhất) → nếu trúng, mode `resize`; kế đó
  trong-region → `move`; còn lại → `draw`. Tay cầm là 8 ô nhỏ (~10-12px hiển thị) đặt tuyệt đối theo
  `%` giống box preview (`pct(...)`), `pointer-events` bật để nhận bấm.
- `computeRect` thêm nhánh `resize`: với con trỏ tại `p` (px working), cập nhật cạnh mà tay cầm điều
  khiển, giữ cạnh đối diện; chuẩn hoá khi kéo vượt qua cạnh đối diện (đổi chiều), rồi `clampRegion`.
- Con trỏ: tính từ `handle` (map tĩnh); vùng trong region → `move`; ngoài → `crosshair`.
  `hover` không kéo cũng nên đổi con trỏ (optional: theo vị trí chuột) — tối thiểu đặt cursor lên
  từng phần tử tay cầm/box.

Không đổi: `toWorking`, `clampRegion`, `pct`, đồng bộ ô số `setField`, `onChange` (vẫn trả
`BeatRegion`), toggle "Cả trang".

## Related Code Files

- Modify: `content-extractor/components/region-cropper.tsx` — thêm type `Handle`, hit-test tay cầm,
  nhánh `resize` trong `computeRect`, render 8 phần tử tay cầm, cursor theo mode.
- (Không tạo file mới; không đụng schema/API.)

## Implementation Steps

1. Đọc `node_modules/next/dist/docs/` phần pointer events / client component nếu cần (AGENTS.md).
2. Định nghĩa `Handle` + bảng offset (mỗi handle → vị trí `%` trên viền + cạnh cố định + cursor).
3. Render 8 tay cầm khi `shown` (region hiện) và không `disabled`; đặt `touch-none`.
4. Sửa `onPointerDown`: `setPointerCapture`, hit-test handle → `resize` (lưu handle + anchor), else
   move/draw như cũ.
5. Thêm nhánh `resize` vào `computeRect` (giữ cạnh đối diện, chuẩn hoá đảo chiều, `clampRegion`).
6. Gắn cursor: box=`move`, handle=cursor tương ứng, nền=`crosshair`.
7. Kiểm thử tay: kéo từng góc/cạnh, kéo lố qua cạnh đối diện, kéo ra biên (clamp cắt tại mép), ô số
   cập nhật đồng bộ. Test trên band cao (strip) và trang thường.

## Success Criteria

- [x] 8 tay cầm hiện trên hộp region; kéo mỗi tay cầm chỉ đổi cạnh/góc đúng, neo cạnh đối diện.
      (Sau review: resize theo DELTA con trỏ từ lúc bấm — click suông trên tay cầm không làm
      cạnh nhảy tới vị trí con trỏ.)
- [x] Kéo lố qua cạnh đối diện xử lý mượt (đổi chiều min/max, không âm kích thước).
- [x] Di chuyển (trong hộp) và vẽ mới (chỗ trống) vẫn hoạt động như trước.
- [x] Con trỏ phản ánh mode; kết quả luôn clamp trong biên; ô số x/y/w/h đồng bộ.
- [x] `BeatRegion` + PATCH beat không đổi; `tsc`/lint/build sạch.

## Risk Assessment

- **Tay cầm ở góc chồng vùng "move"** → hit-test handle ưu tiên trước move; ô tay cầm đủ nhỏ.
- **Ảnh strip rất cao, tay cầm khó bấm** → giữ ô tay cầm kích thước cố định px (không theo %), tăng
  hitbox ẩn quanh tay cầm.
- **Đảo chiều khi kéo lố** → chuẩn hoá bằng min/max như nhánh `draw` sẵn có; test riêng ca này.
