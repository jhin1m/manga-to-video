---
title: "Phase 4: Xoá route/hàm chết của Stage 1"
status: done
priority: P2
dependencies: [2, 3]
---

# Phase 4: Xoá route/hàm chết của Stage 1

## Overview

Sau khi UI hết gọi (Phase 2+3), xoá các endpoint/hàm chỉ phục vụ màn Trích xuất cũ. YAGNI —
dead code gây nhiễu. **Chỉ chạy sau khi Phase 2+3 merged** và grep xác nhận không còn caller.

## Requirements

- Xoá route + hàm không còn ai gọi; **giữ** những gì upload/preview/storyboard còn dùng.
- Không phá `.mtvproj` (project export dùng `toManifest` trực tiếp, KHÔNG qua route `/export`).

## Architecture

### Xoá (sau khi verify 0 caller trong `app/**` + `components/**` + `scripts/**` không phải test bị viết lại)
- `app/api/jobs/[id]/run/route.ts` — batch vision job (thay bằng storyboard/generate).
- `app/api/jobs/[id]/stream/route.ts` — SSE tiến độ vision job (chỉ page cũ dùng).
- `app/api/jobs/[id]/export/route.ts` — Export JSON standalone (user yêu cầu bỏ; không route nào đọc lại).
- `app/api/jobs/[id]/items/[i]/retry/route.ts` — retry vision 1 item (chỉ bảng kết quả cũ dùng).
- `lib/pipeline.ts` → `processChapter` (chỉ `/run` gọi). **Giữ** `createPacer`, `downscale`, `ingestBandItems`, `extractImages*`, `expandPdfs` (upload + storyboard/generate còn dùng).
- `app/api/jobs/[id]/items/[i]/route.ts` → bỏ **PATCH** (sửa content — bảng cũ). **Giữ DELETE** (xoá band ở preview `/`).

### Giữ nguyên
- `app/api/jobs/route.ts` (POST upload), `items/[i]/image` (thumbnail preview), `items/[i]` DELETE.
- `lib/jobs.ts` (`updateProgress`/phases vẫn dùng cho job DTO; không cắt để tránh blast radius — job đứng ở `ready`).
- `lib/schema.ts` `Manifest`/`toManifest`/`ProjectItemMeta` — `.mtvproj` cần. `content` cứ để `null`.

## Related Code Files

- Delete: `content-extractor/app/api/jobs/[id]/run/route.ts`
- Delete: `content-extractor/app/api/jobs/[id]/stream/route.ts`
- Delete: `content-extractor/app/api/jobs/[id]/export/route.ts`
- Delete: `content-extractor/app/api/jobs/[id]/items/[i]/retry/route.ts`
- Modify: `content-extractor/app/api/jobs/[id]/items/[i]/route.ts` — bỏ PATCH, giữ DELETE.
- Modify: `content-extractor/lib/pipeline.ts` — xoá `processChapter` (+ import `describeImage`/`classifyError`/`getJob`/`setItem*`/`updateProgress` nếu thành thừa; giữ import cho `ingestBandItems`).

> **Từ validation:** `/run` bị **HAI** e2e test gọi — `e2e-storyboard.mts:163` + `:439` **và**
> `e2e-script-video.mts:87`. Cả hai phải viết lại sang generate-all ở Phase 5 TRƯỚC/ĐỒNG THỜI khi xoá
> `/run`, nếu không `npm run test:e2e*` đỏ. Đây là caller test, không phải caller ứng dụng.

## Implementation Steps

1. Grep chốt 0 caller **ứng dụng**: `grep -rn "/run\b\|/stream'\|/export'\|/retry'" app components` (bỏ `scripts/` — test do Phase 5 lo). Còn caller trong `app`/`components` → dừng, quay lại Phase 2/3.
2. Xoá 4 file route + PATCH handler + `processChapter`.
3. Dọn import mồ côi trong `pipeline.ts` (`tsc` sẽ chỉ ra `noUnusedLocals` nếu bật; nếu không, đọc kỹ).
4. `tsc --noEmit` + `lint` + `npm run build` sạch (Next 16 build bắt route lỗi).

## Success Criteria

- [ ] 4 route xoá; GET các URL đó → 404
- [ ] `items/[i]` PATCH → 405/404; DELETE vẫn xoá band OK
- [ ] `processChapter` biến mất; `ingestBandItems`/`createPacer` còn nguyên
- [ ] `npm run build` xanh; grep không còn caller ứng dụng tới route đã xoá
- [ ] `.mtvproj` export/import vẫn chạy (kiểm ở Phase 5)

## Risk Assessment

- **Rủi ro:** xoá `processChapter` kéo theo import dùng chung làm hỏng `ingestBandItems`. **Giảm thiểu:** hai hàm độc lập; `tsc`/`build` bắt ngay.
- **Rủi ro:** còn caller ẩn (vd test e2e-video). **Giảm thiểu:** bước 1 grep bắt buộc trước khi xoá; Phase 5 xử lý test.
- **Rollback:** các xoá này thuần dead-code — revert commit phase là đủ.
