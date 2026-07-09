---
phase: 3
title: Verify & docs
status: completed
priority: P2
dependencies:
  - 1
  - 2
effort: S
---

# Phase 3: Verify & docs

## Overview

Chạy toàn bộ quality gate sau khi Phase 1 + 2 xong, rồi cập nhật docs cho env knobs mới và hành vi cắt band mới. Không code tính năng ở đây.

## Requirements

- **Functional**: docs phản ánh đúng env knobs + hành vi mới; không claim sai.
- **Non-functional**: mọi gate xanh trước khi bàn giao.

## Related Code Files

- Modify: `content-extractor/.env.example` — thêm `MIN_GUTTER_HEIGHT`, `MIN_BAND_HEIGHT`, `MAX_BAND_HEIGHT`, `MIN_INK_DENSITY`; chú thích `SPLIT_HEIGHT` giờ chỉ là fallback suy min/max; gỡ/ghi-chú `SCAN_LINE_STEP`, `MIN_DISTANCE_PCT` (không còn dùng).
- Modify: `content-extractor/README.md` — mô tả cắt band theo gutter (giữ nhân vật kèm bong bóng); nhắc nút xoá ở upload/storyboard; cập nhật Known Limitations nếu cần.

## Implementation Steps

1. `nvm use 24` rồi chạy (trong `content-extractor/`):
   - `pnpm test:unit` (verify-ingest + verify-banding + verify-narration) → PASS.
   - `pnpm test:e2e` → PASS.
   - `pnpm lint` (eslint) → sạch.
   - `pnpm exec tsc --noEmit` → sạch.
   - `pnpm build` (`next build`) → sạch.
2. Sửa lỗi hồi quy nếu có (không nới lỏng test để né).
3. Cập nhật `.env.example` + `README.md`; đọc file trước khi sửa, verify claim khớp code Phase 2.
4. Kiểm tay nhanh (dev :3000): upload → xoá 1 band ở preview; tạo storyboard → xoá 1 nhịp; ngó band mới có giữ nhân vật kèm bong bóng.

## Success Criteria

- [ ] `pnpm test:unit` + `pnpm test:e2e` PASS.
- [ ] `eslint` + `tsc --noEmit` + `next build` sạch.
- [ ] `.env.example` liệt kê đủ knob mới + fallback `SPLIT_HEIGHT`.
- [ ] `README.md` mô tả đúng hành vi cắt band mới + tính năng xoá.
- [ ] Kiểm tay: xoá + banding hoạt động end-to-end.

## Risk Assessment

- **Env cũ trong `.env.local`**: backward-compat qua `SPLIT_HEIGHT` nên không vỡ; ghi rõ trong `.env.example`.
- Rủi ro thấp — phase kiểm chứng, không đổi kiến trúc.
