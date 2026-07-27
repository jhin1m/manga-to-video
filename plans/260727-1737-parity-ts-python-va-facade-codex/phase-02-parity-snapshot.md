# ✅ Phase 02 — `gen-parity.mts` + `schemas/parity.json` + `test_parity.py`

**Repo:** cả hai · **Phụ thuộc:** phase 01 (cần `to_ass_force_style()` gọi được độc lập)

## Thiết kế

```
project (TS)                                skill repo (Python)
────────────                                ───────────────────
lib/*.ts  ──▶ scripts/gen-parity.mts ──ghi──▶ schemas/parity.json  (commit)
                     │                              │
              verify-parity.mts ◀──── đọc ──────────┤  runtime: --subs-preset (phase 03)
              (SKIP nếu ko có skill)                └──▶ tests/test_parity.py
```

Một snapshot duy nhất, không có cặp file nào phải giữ giống nhau. Đổi lại CI project không kiểm
được parity — đã chấp nhận, xem `plan.md`.

Hai vòng khép kín:

- **TS đổi mà quên regen** → `pnpm test:parity` FAIL (máy dev).
- **Snapshot đổi mà Python chưa theo** → `test_parity.py` FAIL (chạy standalone, không cần TS).

## Định dạng `schemas/parity.json`

Khoá **snake_case** vì consumer chính là Python; phía TS chuyển camel→snake khi so (một hàm nhỏ
trong `verify-parity.mts`). `version` để test Python từ chối snapshot format lạ.

```jsonc
{
  "version": 1,
  "generated_from": "content-extractor/lib",
  "constants": {
    "auto_region":  { /* 16 khoá: max_edge, bright_thr, min_bubble_area_frac, ... */ },
    "kenburns":     { "supersample": 4, "pan_supersample_max_px": 26000000,
                      "pan_supersample_low": 2, "max_pan_frame_per_sec": 0.35 },
    "timeline":     { "pad_head_sec": 0.15, "pad_tail_sec": 0.35,
                      "floor_sec": 2, "shot_floor_sec": 0.8 },
    "shot_split":   { "shot_max_height_default": 1100, "min_band_ratio": 0.6 },
    "subtitle_style": { "play_res_x": 384, "play_res_y": 288, "font_size_divisor": 432,
                        "alignment": { "top": 6, "middle": 10, "bottom": 2 },
                        "ass_style_fields": ["FontName", "FontSize", "..."] }
  },
  "subtitle_defaults": { /* 19 field, KHÔNG gồm export/burn_in (cờ UI, skill dùng --subs) */ },
  "subtitle_presets": [ { "id": "clean", "label": "Sạch", "hint": "...", "style": { /* partial */ } } ],
  "fonts": { "catalog": ["Be Vietnam Pro", "..."], "blacklist": ["Anton", "..."] },
  "golden": {
    "force_style": [ { "name": "preset:punchy", "style": {...}, "expected": "FontName=Kanit,FontSize=..." } ],
    "normalize":   [ { "name": "size_pct ngoài miền", "raw": {"size_pct": 45}, "expected": {...} } ],
    "captions":    [ { "name": "uppercase+wrap", "text": "...", "style": {...}, "expected": "..." } ]
  }
}
```

**Golden quan trọng hơn constants.** Constants bắt lệch số; golden bắt lệch *logic* — thứ tự
field, cách làm tròn, quy tắc `0 < maxChars < 12 → 0`, vai trò `OutlineColour` ở `BorderStyle=3`.
Sinh golden bằng cách gọi thẳng `toAssForceStyle` / `migrateSubtitleStyle` / `formatCaption`, không gõ tay.

Bộ golden tối thiểu:

- `force_style`: 5 preset + default + `border: none` + `border: box` + `position: top/middle`
- `normalize`: mỗi dòng bảng clamp ở phase 01 một case + config v1 `{"outline": false}` + `{}` rỗng
- `captions`: uppercase tắt/bật × `max_chars` 0/12/28, kèm một câu có từ dài hơn giới hạn

## Files — project (TS)

| File | Việc |
|---|---|
| `scripts/gen-parity.mts` (mới) | Dựng object, ghi `$MTV_SKILL_DIR/schemas/parity.json` (mặc định `~/.claude/skills/manga-to-video`). Không thấy thư mục → ghi `.render/parity.json` + cảnh báo, exit 0. |
| `scripts/verify-parity.mts` (mới) | Sinh lại trong bộ nhớ, so với file skill. Thiếu skill → in `SKIP` + exit 0. Lệch → in đúng khoá lệch + exit 1. |
| `lib/fonts.ts` | Nâng blacklist từ **comment** thành `export const FONT_BLACKLIST` (Anton, Bebas Neue, Archivo Black, Alfa Slab One, Fredoka, Bungee). |
| `scripts/verify-fonts.mts` | Thêm assert: không entry nào của `FONT_CATALOG` nằm trong `FONT_BLACKLIST`. |
| `package.json` | `"gen:parity": "tsx scripts/gen-parity.mts"`, `"test:parity": "tsx scripts/verify-parity.mts"`, nối `verify-parity.mts` vào cuối `test:unit`. |

Bám phong cách `verify-*.mts` sẵn có: đếm `failures`, in `✓`/`✗`, `process.exit(failures ? 1 : 0)`.

## Files — skill (Python)

| File | Việc |
|---|---|
| `schemas/parity.json` (mới) | Sinh ra rồi **commit**. Skill phải chạy được khi không có repo TS. |
| `tests/test_parity.py` (mới) | Đọc snapshot, so 5 nhóm constants + `subtitle_defaults` + 3 nhóm golden. Bám phong cách `test_auto_region.py` (thuần stdlib + `sys.path.insert`, in PASS/FAIL, exit code). |

`test_parity.py` so:

1. `AUTO_REGION_DEFAULTS`, `MAX_PAN_FRAME_PER_SEC`/`SUPERSAMPLE`/`PAN_SUPERSAMPLE_*`,
   `TIMELINE_DEFAULTS`, `SHOT_MAX_HEIGHT_DEFAULT`/`MIN_BAND_RATIO`,
   `PLAY_RES_*`/`FONT_SIZE_DIVISOR`/`_ALIGNMENT`/`ASS_STYLE_FIELDS`
2. `SUBTITLE_STYLE_DEFAULTS` khớp `subtitle_defaults`
3. golden: `to_ass_force_style(style) == expected`, `normalize_subtitle_style(raw) == expected`,
   `format_caption(text, style) == expected`

## Các bước

1. `lib/fonts.ts`: export `FONT_BLACKLIST`; cập nhật `verify-fonts.mts`; `pnpm test:fonts`.
2. Viết `gen-parity.mts`; chạy `pnpm gen:parity`; đọc mắt file sinh ra (đủ khối, số đúng).
3. Viết `verify-parity.mts`; `pnpm test:parity` phải PASS; đổi tạm một hằng TS → phải FAIL.
4. Nối vào `test:unit`; chạy full `pnpm test:unit`.
5. Bên skill: viết `test_parity.py`; chạy phải PASS.
6. Đổi tạm `SUPERSAMPLE = 3` bên Python → `test_parity.py` phải FAIL. Hoàn nguyên.

## Nghiệm thu

- `pnpm gen:parity` ghi đúng `~/.claude/skills/manga-to-video/schemas/parity.json`.
- `MTV_SKILL_DIR=/khong/ton/tai pnpm test:parity` → SKIP, exit 0.
- Đổi lệch một hằng bất kỳ ở **một trong hai** phía → đúng một test FAIL, nêu đúng tên khoá.
- `pnpm test:unit` xanh; `run_smoke.py` + `test_auto_region.py` + `test_parity.py` xanh.

## Rủi ro

- **Golden `force_style` là chuỗi so tuyệt đối** → đổi thứ tự field bên TS làm FAIL cả loạt. Đó là
  ý đồ (thứ tự thuộc hợp đồng), nhưng phải regen snapshot khi TS đổi thật, đừng sửa Python cho khớp.
- `gen-parity.mts` ghi ra **ngoài** repo project. Nếu `MTV_SKILL_DIR` trỏ nhầm là ghi bậy vào thư
  mục khác — script phải kiểm tra thư mục đích có `SKILL.md` + `scripts/mtv/` trước khi ghi.
- Float trong JSON: `0.1 + 0.2` không phải vấn đề vì chỉ so giá trị literal, nhưng
  `max_pan_frame_per_sec` kiểu `0.35` phải so bằng `==` chứ không `math.isclose` — lệch thật thì
  phải FAIL, không dung sai.
