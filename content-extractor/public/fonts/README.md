# Font phụ đề kèm repo

Dùng CHUNG cho hai phía nên preview và MP4 không lệch font:

- Preview: `@font-face` trong `app/globals.css` trỏ `/fonts/<file>.ttf`
- Render: libass đọc thư mục này qua `fontsdir` (xem `bundledFontsDir()` trong `lib/ffmpeg.ts`)

Catalog (tên family dùng cho `FontName` của ASS): `lib/fonts.ts`. Tên family phải khớp
TUYỆT ĐỐI chuỗi bên trong file TTF — libass match theo family name, không theo tên file.
Kiểm bằng:

```bash
fc-scan --format '%{family[0]}|%{style[0]}|%{weight}\n' public/fonts/*.ttf
```

## Nguồn

Tải từ Google Fonts API v1 với User-Agent Android 2.2 (UA đó trả **TTF tĩnh**; UA hiện đại
trả woff2 chia subset, UA IE trả EOT — cả hai libass đều không dùng được):

```
https://fonts.googleapis.com/css?family=<Family>:<400|700>&subset=vietnamese,latin,latin-ext
```

## License

Cả 8 họ đều **SIL Open Font License 1.1**. Bản license đầy đủ nằm trong `licenses/`.

| Họ | Weight | License |
|---|---|---|
| Be Vietnam Pro | 400, 700 | OFL-1.1 |
| Roboto | 400, 700 | OFL-1.1 |
| Montserrat | 400, 700 | OFL-1.1 |
| Nunito | 400, 700 | OFL-1.1 |
| Oswald | 400, 700 | OFL-1.1 |
| Barlow Condensed | 400, 700 | OFL-1.1 |
| Kanit | 400, 700 | OFL-1.1 |
| Merriweather | 400, 700 | OFL-1.1 |

## Thêm font mới — bắt buộc kiểm dấu tiếng Việt

Nhiều font caption phổ biến **không có** dấu tiếng Việt: Anton, Bebas Neue, Archivo Black,
Alfa Slab One, Fredoka, Bungee. Trước khi thêm, kiểm glyph:

```bash
fc-query --format '%{charset}' <file>.ttf   # cần phủ 1ec7 (ệ), 1eef (ữ), 1eab (ẫ), 110/111 (Đ đ)
```

`scripts/verify-fonts.mts` chạy đúng kiểm tra này cho mọi file trong thư mục.
