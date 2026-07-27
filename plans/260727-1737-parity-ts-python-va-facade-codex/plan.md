# Parity TS ↔ skill Python + hợp nhất SKILL.md cho Codex

**Trạng thái:** hoàn tất (4/4 phase) · tạo 2026-07-27 · thực thi 2026-07-27 · **chưa commit**

## Vấn đề

Hai đường drift đã xảy ra thật, mỗi cái một lần trong 8 ngày:

1. **TS ↔ Python.** Skill là port tay của `content-extractor/lib`. Hiện 45+ hằng số vẫn khớp
   tuyệt đối (auto-region 16/16, kenburns 4/4, timeline 4/4, shot-split 2/2, subtitle-style
   19/19 field) — nhưng **không có gì kiểm** điều đó. 16 smoke case chỉ kiểm schema/fixture,
   không so một con số nào với TS. Drift lần tới im lặng, chỉ lộ ra bằng video sai.
2. **SKILL.md ↔ facade Codex.** `~/.codex/skills/manga-to-video/SKILL.md` (20/07) trễ 2 feature
   so với bản gốc: auto-region v2.1 và style phụ đề. Engine dùng chung nên code mới vẫn chạy —
   chỉ là Codex **không biết** flag `--no-auto-region`, `--subs-style` tồn tại.

Kèm 3 gap tính năng phát hiện khi đối chiếu:

- Python **không clamp** `--subs-style` (TS kẹp `sizePct 1–20`, `opacity 0–1`, `maxChars<12→0`…).
  `{"size_pct": 45}` ra chữ nửa khung, không lỗi, không cảnh báo. **Hồi quy thật.**
- `subtitle-presets.ts` (5 preset) chưa port → chọn *punchy* trên web rồi render bằng skill
  **không ra cùng kết quả**.
- `fonts.ts` FONT_CATALOG + blacklist font thiếu dấu tiếng Việt chưa port → chọn nhầm Anton
  là phụ đề mất dấu trong MP4, im lặng.

## Quyết định đã chốt

| Việc | Chọn |
|---|---|
| Facade Codex | **Hợp nhất 1 SKILL.md** — facade = copy byte-for-byte, sync bằng `cp` + verify sha256 |
| Snapshot parity | **Chỉ skill repo** (`schemas/parity.json`), dùng cho cả runtime lẫn test |
| Preset | **Đủ 5 preset + `--subs-preset`**, thứ tự `DEFAULTS ◀ preset ◀ --subs-style` |

Hệ quả đã chấp nhận: CI project **không** kiểm được parity (không có skill repo trên CI).
Chỉ máy dev có cả 2 repo mới kiểm. `verify-parity.mts` phải SKIP + PASS khi thiếu skill, không
được fail CI.

## Nguyên tắc

- **TS là nguồn chân lý.** Lệch thì Python sửa theo, không ngược lại.
- **Skill vẫn standalone** — chạy được khi không có repo TS. Snapshot đã commit, không sinh lúc chạy.
- Chia sẻ **dữ liệu**, không chia sẻ code. Hai runtime tồn tại có lý do (skill không cần `node_modules`).

## Phases

| # | Nội dung | Repo | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| [01](phase-01-clamp-va-tach-subtitle-style.md) | Clamp `--subs-style` + tách `mtv/subtitle_style.py` | skill | — | ✅ xong |
| [02](phase-02-parity-snapshot.md) | `gen-parity.mts` + `schemas/parity.json` + `test_parity.py` | cả 2 | 01 | ✅ xong |
| [03](phase-03-preset-va-font-guard.md) | `--subs-preset` + cảnh báo font thiếu dấu | skill | 02 | ✅ xong |
| [04](phase-04-hop-nhat-skill-md-facade.md) | Hợp nhất SKILL.md + `sync_codex_facade.py` | skill | — | ✅ xong |

Phase 04 độc lập hoàn toàn — làm lúc nào cũng được.

## Lệch so với plan lúc thực thi (đã kiểm, có chủ ý)

1. **Phải `export` thêm 10 hằng bên TS.** `kenburns.ts` (8) và `shot-split.ts` (2) khai
   `const` không export nên `gen-parity.mts` không đọc được. Chỉ thêm từ khoá `export`,
   không đổi giá trị nào.
2. **kenburns lấy 8 hằng, không phải 4.** Plan liệt kê 4; cả hai phía đều có đủ 8
   (`strip_shape`, `pan_min_cover`, `pan_max_cover`, `pan_max_cover_wide` là 4 cái thêm).
   Lấy hết vì rẻ và cùng loại rủi ro.
3. **`auto_region` có 15 khoá, không phải 16** — đếm lại cả hai phía đều 15. Plan đếm nhầm.
4. **`normalize_subtitle_style(raw)` nhận raw thô**, không nhận `DEFAULTS | override` như
   phase 01 bước 4 viết. Lý do: khớp đúng chữ ký `migrateSubtitleStyle(raw)` của TS (golden
   `normalize` trong snapshot là `raw → expected`), và chỉ khi biết field nào do người dùng
   gõ mới cảnh báo được đúng chỗ.
5. **Dùng `js_round` thay `round`** ở `to_ass_force_style` và `max_chars_per_line`. Code cũ
   dùng `round()` của Python (banker's rounding) — lệch `Math.round` của JS ở mọi giá trị
   `n,5` với `n` chẵn. Golden `lam-tron-nua-don-vi` canh đúng chỗ này.
6. **`verify-parity.mts` import `./gen-parity.mjs`** (không phải `.mts`) — `tsc --noEmit`
   báo TS5097 với đuôi `.mts`.

## Acceptance chung

- Sửa lệch 1 hằng bên Python → `test_parity.py` FAIL.
- Sửa 1 hằng bên TS mà quên `pnpm gen:parity` → `pnpm test:parity` FAIL trên máy dev.
- `pnpm test:unit` không hỏng trên máy không có skill repo (SKIP, exit 0).
- `--subs-preset punchy` sinh `force_style` **giống hệt** golden do TS xuất.
- `sync_codex_facade.py --check` exit 0; `codex debug prompt-input | grep manga-to-video` thấy `r0/`.
- `tests/run_smoke.py` (16 case) và `tests/test_auto_region.py` vẫn PASS.

## Bàn giao

Hai commit riêng, hai repo:

- project → `jhin1m/manga-to-video` (`scripts/gen-parity.mts`, `verify-parity.mts`, `lib/fonts.ts`, `package.json`)
- skill → `jhin1m/claude-skill-manga-to-video` (mọi thứ còn lại)

`docs/` của project chỉ có `brainstorms/` + `journals/` — không có tài liệu kiến trúc để cập nhật.
Tài liệu người dùng của skill nằm trong SKILL.md, cập nhật ở phase 03 và 04.

## Câu hỏi chưa giải

- `blacklist` font hiện chỉ nằm trong **comment** của `lib/fonts.ts`. Phase 02 nâng nó thành
  hằng export `FONT_BLACKLIST`. Cần xác nhận danh sách đủ chưa: Anton, Bebas Neue, Archivo
  Black, Alfa Slab One, Fredoka, Bungee.
- Golden cho `build_timeline` (round3, sàn segment/shot) chưa đưa vào scope — rẻ và đúng chỗ dễ
  lệch, nhưng chưa có bằng chứng đã từng lệch. Thêm sau nếu phase 02 chạy trơn.
