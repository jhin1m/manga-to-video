---
phase: 1
title: "Chọn ffmpeg có libass cho bước burn"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Chọn ffmpeg có libass cho bước burn

## Overview

Burn-in hiện KHÔNG chạy trên máy dev: `resolveBin` ưu tiên ffmpeg trên PATH (brew 8.1.2, build thiếu libass) nên `hasFilter('subtitles')` trả false → `lib/render.ts:249-259` bỏ qua burn, chỉ in cảnh báo. Bản bundled `ffmpeg-static` (ffmpeg 6.0) LẠI có libass. Phase này cho bước burn tự rơi xuống binary có libass, giữ nguyên binary cho mọi bước khác.

## Requirements

- Functional
  - `hasFilter('subtitles')` false trên binary chính → thử binary bundled; có libass thì burn bằng binary đó.
  - Cả hai đều thiếu → giữ nguyên hành vi cũ (cảnh báo + `.srt` rời, không throw).
  - `FFMPEG_PATH` do người dùng đặt vẫn là override cứng cho các bước khác; bước burn được phép dùng binary khác và **phải log rõ** đang dùng bản nào.
- Non-functional
  - Không đổi engine của các bước Ken Burns/concat/audio/mux (giữ lý do đã ghi ở `lib/ffmpeg.ts:7-10`: máy đã cài ffmpeg giữ nguyên engine).
  - Kết quả probe cache theo tiến trình như `filterListCache` hiện có.

## Architecture

`lib/ffmpeg.ts` hiện có: `resolveBin(bin)` (env → PATH → bundled, cache promise) và `hasFilter(name)` (cache 1 chuỗi `-filters` của binary đã resolve).

Thêm:

```ts
// Binary dùng riêng cho bước burn: ưu tiên binary chính, thiếu libass thì thử bundled.
// null = không nguồn nào có libass → caller degrade như cũ.
export async function resolveSubtitleBin(): Promise<string | null>
```

- Đổi `hasFilter` nhận thêm tham số binary (mặc định binary chính) và cache theo **binary path** (`Map<string, string>`) thay vì 1 biến — vì giờ có 2 binary khác nhau.
- `burnSubs` nhận `bin` từ caller thay vì gọi `runFfmpeg` (đang bind cứng binary chính).
- `lib/render.ts`: `if (await hasFilter('subtitles'))` → `const subBin = await resolveSubtitleBin(); if (subBin) { … } else { warn }`.

Cảnh báo mới khi phải dùng bundled:
```
[render] ffmpeg trên PATH thiếu libass — dùng bản bundled (node_modules/ffmpeg-static) cho bước burn phụ đề.
```

## Related Code Files

- Modify: `content-extractor/lib/ffmpeg.ts` — `hasFilter` (cache theo binary), `resolveSubtitleBin` (mới), `burnSubs` (nhận bin)
- Modify: `content-extractor/lib/render.ts:249-259` — nhánh chọn binary + thông điệp degrade
- Modify: `content-extractor/README.md` — mục ffmpeg: ghi rõ burn-in cần libass và app tự rơi xuống bundled

## Implementation Steps

1. Trong `lib/ffmpeg.ts`, đổi `filterListCache: string | null` → `Map<string, Promise<string>>` khoá theo binary path; `hasFilter(name, bin?)` resolve binary chính khi không truyền.
2. Viết `bundledBinPath()` tái dùng `bundledBin('ffmpeg')` sẵn có (đang là hàm private — export nội bộ trong module là đủ).
3. Viết `resolveSubtitleBin()`: binary chính có `subtitles` → trả nó; không → bundled có `subtitles` → trả bundled (kèm `console.warn` một lần); không → `null`.
4. `burnSubs(...)` thêm tham số `bin: string` và gọi `runCommand(bin, args, signal)` thay `runFfmpeg`.
5. `lib/render.ts` dùng `resolveSubtitleBin()`; giữ nguyên thông điệp cũ cho nhánh `null`.
6. Cập nhật README mục ffmpeg (`README.md`, bảng env quanh dòng `SUBS_FONTS_DIR`).

## Success Criteria

- [x] Trên máy dev hiện tại (brew ffmpeg 8.1.2 thiếu libass): render in-app ra MP4 **có chữ** burn vào hình
- [x] Log in đúng một dòng cảnh báo "dùng bản bundled cho bước burn"
- [ ] Giả lập cả hai nguồn thiếu libass → vẫn ra MP4 + `.srt`, chỉ cảnh báo — **CHƯA chạy được**: `bundledBin` là hàm private, không stub được từ ngoài mà không sửa `node_modules`. Nhánh degrade chỉ là `if (subBin) … else warn`, đã typecheck và chính là hành vi của repo trước thay đổi này. `verify-render.mts` vẫn giữ nhánh assert cho trường hợp đó
- [x] `pnpm test:render` PASS — RENDER_ALL_PASS, log in `chuyển sang bản bundled … cho riêng bước burn phụ đề`

## Risk Assessment

| Rủi ro | Giảm thiểu |
|---|---|
| Bundled ffmpeg 6.0 khác brew 8.1.2 → khác biệt encode ở đoạn burn | Bước burn chỉ re-encode video đã chuẩn hoá bằng libx264/yuv420p; tham số giữ y nguyên. Nghiệm thu bằng phát thử file cuối |
| `bundledBin` trả null (platform lạ, postinstall fail) | `resolveSubtitleBin` trả `null` → degrade đúng nhánh cũ |
| Người dùng cố tình đặt `FFMPEG_PATH` và bất ngờ vì burn dùng binary khác | Log rõ ràng một dòng; README ghi rõ quy tắc |
