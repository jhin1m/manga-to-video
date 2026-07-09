# 2026-07-07 — Gộp + chia band ngay lúc upload, gỡ tách/gộp nhịp, thêm Generate per-beat

## Bối cảnh

Trang Storyboard có hai nút khó hiểu: "Tách đôi" và "Gộp nhịp dưới". Nguyên nhân gốc: biên
nhịp suy từ biên trang gốc (nhánh `pages` — mỗi trang 1 nhịp), chỉ nhánh `strip` mới được
stitch + smart-split. Biên trang sai nhịp → phải sửa tay.

## Thay đổi

1. **Ingest thống nhất** (`lib/pipeline.ts` — `ingestBandItems`): mọi upload (ảnh/zip/PDF)
   downscale → gộp toàn bộ thành MỘT canvas dọc (`stitchSlices`) → smart-split tại khoảng
   an toàn (`detectBands`) → crop lại thành band (`band-01.jpg`, …). Item của job là band
   từ đây; `StoredItem` mang sẵn `width/height`.
2. **Storyboard đơn giản hoá**: bỏ phân loại pages/strip + stitch tại chỗ; 1 band = 1 nhịp,
   region null, narration template từ content Stage 1 — không cần vision config/rpm khi tạo.
3. **Gỡ tách/gộp**: xoá `splitBeat`/`mergeBeatWithNext`, route `beats/split|merge`, 2 nút UI,
   2 select "Tự phân loại nguồn". `classifySource` bỏ (chỉ giữ `readStripRatio` cho downscale).
4. **Generate per-beat**: route mới `beats/{beatId}/generate` — crop vùng nhịp → vision →
   narration (dùng `composeBeat(…, { vision: true })`, giữ rev-guard). UI thay "Thử lại"
   bằng nút ✨ Generate (icon sparkles, accent tím).
5. **Import** dùng cùng ingest → band tái lập đúng phiên export nếu cùng env; manifest
   `strip` cũ vẫn đọc được (nhánh legacy giữ nguyên).

## Kiểm chứng

- Unit 42 assert PASS (thêm test `ingestBandItems`); e2e viết lại 55 assert PASS
  (band ingest, cô lập lỗi band đen qua mock marker mới, Generate, split/merge → 405,
  import roundtrip, PDF).
- `eslint` + `next build` + `tsc --noEmit` sạch.

## Ghi chú

- E2E chạy qua `next start` (Next 16 từ chối 2 dev server cùng thư mục khi dev :3000 đang mở).
- Đánh đổi: mỗi upload stitch cả chapter thành canvas → RAM tạm thời cao với chapter dài
  (ghi ở Known Limitations). Manifest export mới luôn `sourceKind: 'pages'`.
