---
phase: 3
title: "Font bundle + catalog"
status: pending
priority: P1
effort: "5h"
dependencies: [2]
---

# Phase 3: Font bundle + catalog

## Overview

Kèm 8 họ font (đủ dấu tiếng Việt, license OFL/Apache-2.0) vào repo và dùng **cùng một file `.ttf`** cho cả `@font-face` của preview lẫn `fontsdir` của libass → preview khớp render, và render giống nhau trên mọi máy.

## Requirements

- Functional
  - Catalog 8 họ, mỗi họ Regular + Bold.
  - `burnSubs` truyền `fontsdir` trỏ thư mục font bundled khi không có override.
  - Thứ tự resolve: `opts.fontsDir` → `SUBS_FONTS_DIR` → `public/fonts` bundled.
  - Preview nạp đúng những font đó qua `@font-face`.
- Non-functional
  - Chuỗi `family` trong catalog phải **khớp tuyệt đối** tên family bên trong file TTF (libass match theo family name).
  - Không dùng `next/font/local` — cần đường dẫn đĩa ổn định cho ffmpeg.

## Architecture

### Catalog font (đã verify subset `vietnamese` qua Google Fonts CSS API)

| Family (chuỗi dùng cho `FontName`) | Vai trò | License |
|---|---|---|
| Be Vietnam Pro | mặc định, sans hiện đại | OFL |
| Roboto | trung tính an toàn | Apache-2.0 |
| Montserrat | geometric đậm nổi | OFL |
| Oswald | condensed | OFL |
| Kanit | heavy impact | OFL |
| Nunito | bo tròn | OFL |
| Merriweather | serif, tông cổ trang | OFL |
| Barlow Condensed | hẹp, nhiều chữ một dòng | OFL |

**Cấm dùng** (đã đo: KHÔNG có subset tiếng Việt): Anton, Bebas Neue, Archivo Black, Alfa Slab One, Fredoka, Bungee — đúng nhóm font caption hay bị chọn theo quán tính.

### Layout

```
content-extractor/public/fonts/
  BeVietnamPro-Regular.ttf   BeVietnamPro-Bold.ttf
  Roboto-Regular.ttf         Roboto-Bold.ttf
  …
  OFL.txt / LICENSE-*.txt    (giữ nguyên file license theo yêu cầu OFL)
```

```ts
// lib/fonts.ts
export interface FontEntry { id: string; family: string; files: { regular: string; bold: string }; category: 'sans' | 'serif' | 'condensed' | 'display' }
export const FONT_CATALOG: FontEntry[]
export const DEFAULT_FONT = 'Be Vietnam Pro';
export function bundledFontsDir(): string  // path.join(process.cwd(), 'public', 'fonts')
```

`lib/render.ts` truyền `fontsDir` xuống `burnSubs` (hiện đang truyền `undefined` ở `lib/render.ts:253`); `burnSubs` giữ nguyên thứ tự `fontsDir ?? process.env.SUBS_FONTS_DIR`, và bổ sung nấc cuối `bundledFontsDir()`.

`app/globals.css` khai `@font-face` cho 16 file (2 weight × 8 họ), `font-display: block` để preview không nháy font fallback.

## Related Code Files

- Create: `content-extractor/public/fonts/*.ttf` + file license
- Create: `content-extractor/lib/fonts.ts`
- Modify: `content-extractor/app/globals.css` — khối `@font-face`
- Modify: `content-extractor/lib/render.ts:253` — truyền `fontsDir`
- Modify: `content-extractor/lib/ffmpeg.ts` — nấc fallback `bundledFontsDir()`
- Modify: `content-extractor/README.md` — mục `SUBS_FONTS_DIR` nói rõ giờ chỉ là override

## Implementation Steps

1. Tải TTF **static** (không dùng variable font — libass hỗ trợ kém) từ repo `google/fonts` cho 8 họ × 2 weight; đặt tên theo `<Family>-<Weight>.ttf`.
2. Đọc tên family thật trong từng file (`fc-scan --format "%{family}\n" <file>`; nếu máy không có fontconfig thì dùng script node đọc bảng `name` của TTF) và ghi **đúng** chuỗi đó vào catalog.
3. Viết `lib/fonts.ts`.
4. Thêm `@font-face` vào `app/globals.css` trỏ `/fonts/<file>.ttf`.
5. Nối `fontsDir` từ `lib/render.ts` xuống `burnSubs`; thêm nấc `bundledFontsDir()`.
6. Nghiệm thu: burn thử với `FontName='Kanit'` rồi grep stderr dòng `fontselect:` xem có trỏ vào `public/fonts/Kanit-Bold.ttf` không.
7. Ghi lại dung lượng thư mục font; nếu vượt ~6MB thì cắt bớt weight (chốt open question).

## Success Criteria

- [x] `fc-scan` xác nhận family string khớp 16/16 file (`pnpm test:fonts`)
- [x] Burn thử → stderr in `fontselect:` trỏ font bundled. **Đo 2 họ** (Be Vietnam Pro, Barlow Condensed — họ thứ hai chắc chắn không có sẵn trong macOS nên chứng minh `fontsdir` ăn), không phải cả 8
- [x] `fc-query` xác nhận 16/16 file phủ `ệ ữ ẫ Đ đ`; kiểm bằng mắt trên frame thật với Kanit + Barlow Condensed
- [x] Preview trong trình duyệt dùng đúng font — kiểm bằng `getComputedStyle` + `document.fonts.check` trên harness parity (Kanit/Be Vietnam Pro/Barlow Condensed đều `true`)
- [x] `du -sh public/fonts` = 2.6MB ≤ 6MB
- [x] `next build` PASS

Khác plan: `fontsDir` KHÔNG truyền từ `lib/render.ts` xuống; thay vào đó `burnSubs` tự rơi
xuống `bundledFontsDir()` khi không có tham số/env — ít chỗ nối hơn, cùng kết quả.

## Risk Assessment

| Rủi ro | Giảm thiểu |
|---|---|
| Family name trong TTF lệch chuỗi catalog → fallback im lặng | Bắt buộc đọc name-table; nghiệm thu bằng dòng `fontselect:` |
| libass trên macOS dùng provider `coretext` — `fontsdir` có được ưu tiên? | Đo thẳng ở bước 6; nếu coretext lấn át, chuyển sang đặt biến môi trường `FONTCONFIG_FILE` hoặc dùng tên family duy nhất không đụng font hệ thống |
| Repo phình | Chỉ 2 weight/họ, static TTF, không kèm woff2 (browser đọc được TTF) |
| License OFL yêu cầu kèm bản quyền | Copy nguyên file `OFL.txt` của từng họ vào `public/fonts/licenses/` |
