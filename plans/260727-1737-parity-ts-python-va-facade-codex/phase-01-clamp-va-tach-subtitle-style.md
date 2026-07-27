# ✅ Phase 01 — Clamp `--subs-style` + tách `mtv/subtitle_style.py`

**Repo:** `~/.claude/skills/manga-to-video` · **Phụ thuộc:** không

## Vì sao

`render.py` hiện làm `subs_style.update(json.loads(args.subs_style))` rồi ném thẳng vào
`force_style`. Bản TS có `migrateSubtitleStyle()` kẹp mọi giá trị. Gõ `{"size_pct": 45}` bên
skill là ra chữ chiếm nửa khung, exit 0, không cảnh báo — libass **bỏ qua im lặng** cả field sai
chính tả (đo thực tế: `FieldKhongCoThat=9` vẫn cho ffmpeg exit 0), nên không có gì bắt được.

Tách module vì `ffmpeg_cmd.py` đang gánh hai mối quan tâm: dựng lệnh ffmpeg **và** logic style
ASS. Bản TS đã tách sẵn (`lib/subtitle-style.ts` ≠ `lib/ffmpeg.ts`) — đi theo ranh giới có sẵn,
không phát minh cái mới. Phase 02 cần `to_ass_force_style()` gọi được độc lập để so golden.

## Files

**Mới** — `scripts/mtv/subtitle_style.py`, chuyển từ `ffmpeg_cmd.py` sang:

- `SUBTITLE_STYLE_DEFAULTS`, `PLAY_RES_X`, `PLAY_RES_Y`, `FONT_SIZE_DIVISOR`, `_ALIGNMENT`
- `ass_color(hex, opacity)` (đang là `_ass_color`)
- `ASS_STYLE_FIELDS` — bản Python của hằng cùng tên trong TS, dùng để test thứ tự field
- `normalize_subtitle_style(raw) -> dict` — thay `_normalize_style`, thêm clamp
- `to_ass_force_style(style) -> str` — tách khỏi `burn_subs`

**Sửa:**

- `scripts/mtv/ffmpeg_cmd.py` — `burn_subs()` import từ module mới, chỉ còn lo `fontsdir`/lệnh
  ffmpeg. Bỏ `re` nếu không còn dùng.
- `scripts/render.py` — thay `dict.update` bằng `normalize_subtitle_style()`; import
  `SUBTITLE_STYLE_DEFAULTS` từ `mtv.subtitle_style`.

## Clamp — đối chiếu `migrateSubtitleStyle()` (lib/subtitle-style.ts:186-238)

| Field | Miền | Ngoài miền |
|---|---|---|
| `size_pct` | 1–20 | về default 4.5 |
| `opacity`, `outline_opacity` | 0–1 | về default |
| `letter_spacing` | -2–10 | về default 0 |
| `outline_width` | 0–4 | về default 2 |
| `shadow_depth` | 0–4 | về default 0 |
| `margin_pct` | 0–40 | về default 8 |
| `side_margin_pct` | 0–25 | về default 6 |
| `max_chars_per_line` | 0–80, **`0 < x < 12` → 0** | về default 0 |
| `position` | `top\|middle\|bottom` | về default `bottom` |
| `border` | `none\|outline\|box` | về default `outline` |
| `color`, `outline_color`, `shadow_color` | `#rrggbb` (chuẩn hoá) | về default |
| `font` | chuỗi non-empty (trim) | về default |

TS dùng `clamp(raw, min, max, default)`: giá trị NaN/sai kiểu → **default**, giá trị ngoài biên →
**kẹp về biên**. Bám đúng ngữ nghĩa đó.

Giữ nguyên đường quy đổi v1: `{"outline": bool}` và không có `border` → `border` +
`outline_width` (2 hoặc 0).

## Khác chủ ý với TS: cảnh báo stderr

TS im lặng vì UI có slider — người dùng không gõ được số vô lý. CLI thì gõ tay, nuốt im lặng là
dở. Khi một field bị kẹp hoặc bỏ, in **một dòng** stderr:

```
[render] CẢNH BÁO: subs-style size_pct=45 ngoài miền 1-20 → dùng 20
```

Không fail. Field lạ (gõ sai tên) cũng cảnh báo — đây chính là loại lỗi libass nuốt im lặng.

## Các bước

1. Tạo `mtv/subtitle_style.py`, chuyển nguyên xi phần hiện có (chưa đổi hành vi).
2. `ffmpeg_cmd.py` + `render.py` import chỗ mới; chạy `tests/run_smoke.py` xác nhận chưa vỡ.
3. Thêm `_clamp()`, `_normalize_hex()`, `_enum()` + cảnh báo vào `normalize_subtitle_style`.
4. `render.py` gọi `normalize_subtitle_style(dict(SUBTITLE_STYLE_DEFAULTS) | override)`.

## Nghiệm thu

- `--subs-style '{"size_pct":45}'` → `FontSize` tính theo 20, có 1 dòng cảnh báo stderr, exit 0.
- `--subs-style '{"max_chars_per_line":8}'` → thành 0 (tắt wrap).
- `--subs-style '{"position":"lung tung"}'` → `Alignment=2`, có cảnh báo.
- `--subs-style '{"outline":false}'` (config v1) → `BorderStyle=1`, `Outline=0`.
- `--subs-style '{"size_pcttt":5}'` → cảnh báo field lạ, không vỡ.
- `run_smoke.py` 16/16 PASS, `test_auto_region.py` PASS, `--dry-run` in được lệnh như cũ.

## Rủi ro

`SUBTITLE_STYLE_DEFAULTS` đang được `render.py` import từ `mtv.ffmpeg_cmd`. Nếu chỉ chuyển đi mà
quên sửa import là `ImportError` ngay lúc chạy — không có type check bắt hộ. Chạy `render.py
--dry-run` sau bước 2 trước khi làm tiếp.
