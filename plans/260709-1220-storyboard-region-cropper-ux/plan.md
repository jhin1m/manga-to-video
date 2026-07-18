---
title: "Nang cap RegionCropper Storyboard (preview + resize handles + motion badge)"
description: ""
status: completed
priority: P2
branch: "main"
tags: []
blockedBy: []
blocks: []
created: "2026-07-09T05:20:40.025Z"
createdBy: "ck:plan"
source: skill
---

# Nang cap RegionCropper Storyboard (preview + resize handles + motion badge)

## Overview

Trị 2 than phiền về RegionCropper trong Storyboard: **"mơ hồ"** (kéo hộp mà không thấy kết quả) và
**"sơ sài"** (hộp không kéo giãn được, chỉ vẽ mới/nhấc). Giữ nguyên vai trò lõi của region (framing
+ Ken Burns) — chỉ nâng UX.

Ba việc (Tầng 1, đã brainstorm & chốt — xem
`docs/brainstorms/2026-07-09-storyboard-region-cropper-ux.md`):
1. **Preview shot sống** — chiếu vùng đang chọn vào ô đúng tỉ lệ khung, chạy lặp pan/zoom. Trị "mơ hồ".
2. **Tay cầm resize 8 hướng** — hộp thành công cụ crop thật. Trị "sơ sài".
3. **Nhãn chuyển động** — chip "Lia dọc ↓ / Lia ngang → / Zoom ⊙" từ `planKenburns`. Minh bạch.

**Nguyên tắc DRY:** logic Ken Burns CSS đã tồn tại inline ở trang video
(`content-extractor/app/video/[jobId]/page.tsx:303-335`) — rút ra module chung, dùng cho cả preview
Storyboard lẫn trang video. Không nhân bản.

**Ngoài phạm vi (Tầng 2, YAGNI):** preset khung, tự gợi ý region, ghi đè chuyển động thủ công, crop
nguồn huỷ-diệt.

## Acceptance criteria (toàn plan)

- Vẽ / kéo giãn / di chuyển hộp → preview cập nhật, lặp đúng pan/zoom mà `planKenburns` sinh cho hình
  dạng hộp.
- Hộp có 8 tay cầm (4 góc + 4 cạnh); kéo tay cầm chỉ đổi cạnh/góc tương ứng (neo cạnh đối diện);
  kéo trong hộp = di chuyển; kéo chỗ trống = vẽ mới. Con trỏ phản ánh mode.
- Chip nhãn khớp `mode` mà `planKenburns` trả về theo hộp hiện tại.
- Ô số x/y/w/h (Nâng cao) vẫn đồng bộ 2 chiều; giữ đường a11y bàn phím.
- Hợp đồng `BeatRegion` + PATCH beat KHÔNG đổi; toạ độ vẫn quy về px ảnh working thật.
- Trang video giữ nguyên hành vi sau khi rút helper (không hồi quy Ken Burns).

## Ràng buộc

- Next.js bản tuỳ biến — **đọc `content-extractor/node_modules/next/dist/docs/` trước khi code** (AGENTS.md).
- Tái dùng `planKenburns` (`content-extractor/lib/kenburns.ts`); rút CSS Ken Burns + `ASPECT_CSS` ra
  module chung.
- shadcn/ui + Tailwind; region phi-huỷ-diệt; preview CSS chỉ xấp xỉ (bản chuẩn là CLI render).
- Default aspect preview = `9:16` (`defaultRenderConfig`, `schema.ts:260`).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Rut helper Ken Burns CSS](./phase-01-rut-helper-ken-burns-css.md) | Completed |
| 2 | [Tay cam resize hop chon](./phase-02-tay-cam-resize-hop-chon.md) | Completed |
| 3 | [Preview shot song + nhan chuyen dong](./phase-03-preview-shot-song-nhan-chuyen-dong.md) | Completed |

## Dependencies

- Cross-plan: không. Mọi plan trước (`260706..260708`) đều `completed`; Stage 2 (kenburns, trang
  video) đã ổn định — Phase 1 chỉ refactor phi-hành-vi.
- Nội bộ: Phase 3 phụ thuộc Phase 1 (preview dùng helper chung). Phase 2 & 3 cùng sửa
  `region-cropper.tsx` → làm tuần tự 2 trước 3 để tránh xung đột.
- Nguồn quyết định: `docs/brainstorms/2026-07-09-storyboard-region-cropper-ux.md`.
