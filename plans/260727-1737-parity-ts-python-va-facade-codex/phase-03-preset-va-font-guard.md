# ✅ Phase 03 — `--subs-preset` + cảnh báo font thiếu dấu

**Repo:** `~/.claude/skills/manga-to-video` · **Phụ thuộc:** phase 02 (đọc `schemas/parity.json`)

## Vì sao

Web có 5 preset; skill không có. Chọn *punchy* trên web rồi render lại bằng skill **không ra
cùng kết quả** trừ khi chép tay 17 field. Preset lấy thẳng từ snapshot → một nguồn, không chép.

Font: `FONT_CATALOG` của TS gồm 8 họ đã `fc-query` xác nhận đủ glyph tiếng Việt, kèm blacklist
những họ caption phổ biến **thiếu dấu** (Anton, Bebas Neue, Archivo Black…). Chọn nhầm là phụ đề
mất dấu trong MP4, không lỗi, không cảnh báo — libass im lặng rơi về font hệ thống.

## Files

**Sửa `scripts/mtv/subtitle_style.py`:**

- `load_parity()` — đọc `schemas/parity.json` cạnh skill, cache module-level. Thiếu file →
  `FileNotFoundError` với thông điệp chỉ rõ chạy `pnpm gen:parity` bên repo TS.
- `SUBTITLE_PRESETS` — nạp từ snapshot (`{id: {label, hint, style}}`).
- `resolve_subtitle_style(preset_id, override) -> dict` — hợp nhất theo thứ tự
  **`DEFAULTS ◀ preset ◀ override`** rồi đưa qua `normalize_subtitle_style()` của phase 01.
- `warn_font(style)` — font không nằm trong `catalog`: cảnh báo nhẹ (có thể là font hệ thống hợp
  lệ). Font nằm trong `blacklist`: cảnh báo **rõ là thiếu dấu tiếng Việt**. Cả hai đều không fail —
  người dùng có quyền dùng font ngoài catalog.

**Sửa `scripts/render.py`:**

- `--subs-preset` với `choices` lấy từ `SUBTITLE_PRESETS` (argparse tự in danh sách trong `--help`,
  không cần cờ `--list` riêng).
- Thay khối merge hiện tại bằng `resolve_subtitle_style(args.subs_preset, override)`.
- Gọi `warn_font()` trước khi burn.

**Sửa `SKILL.md`:** thêm dòng preset vào khối lệnh render + một câu về thứ tự đè:

```bash
# [--subs-preset clean|boxed|punchy|classic|news] preset dựng sẵn (khớp web)
```

## Chi tiết cần giữ đúng

- Preset **không chứa** `export`/`burn_in`/`max_chars_per_line` (cố ý bên TS — thuộc quyết định
  của người dùng, không thuộc tạo hình). Skill cũng không được suy ra chúng từ preset.
- `boxed` và `news` **thiếu** `shadow_color` trong định nghĩa → phải rơi về default `#000000`,
  không được coi là lỗi.
- `news` và `boxed` dùng `border: box`: `outline_color` là **màu hộp**, `outline_opacity` là độ
  đục hộp. Đã xử lý ở `to_ass_force_style`, chỉ cần không phá.

## Nghiệm thu

- `--subs-preset punchy` sinh `force_style` **giống hệt** golden `preset:punchy` trong
  `parity.json` — kiểm bằng `test_parity.py` (thêm case gọi qua `resolve_subtitle_style`).
- `--subs-preset punchy --subs-style '{"size_pct":5}'` → `size_pct` = 5, mọi field khác giữ của
  punchy (Kanit, bold, uppercase, outline_width 3, margin_pct 12).
- `--subs-style '{"font":"Anton"}'` → cảnh báo stderr nói rõ thiếu dấu tiếng Việt, vẫn render.
- `--subs-preset lung-tung` → argparse báo lỗi, liệt kê 5 id hợp lệ.
- `run_smoke.py`, `test_auto_region.py`, `test_parity.py` xanh.

## Rủi ro

- `load_parity()` biến `schemas/parity.json` thành **phụ thuộc runtime**, không còn chỉ là test
  fixture. Xoá nhầm file là `render.py` chết ngay cả khi không dùng preset → nạp **lười**, chỉ
  khi thực sự cần preset/blacklist; không có preset thì đường chạy cũ vẫn hoạt động.
- Cảnh báo font dựa trên catalog 8 họ. Người dùng dùng font Việt hợp lệ ngoài catalog sẽ thấy
  cảnh báo thừa — nên phân biệt rõ hai mức: "không có trong catalog" (thông tin) ≠ "trong
  blacklist" (cảnh báo thật).
