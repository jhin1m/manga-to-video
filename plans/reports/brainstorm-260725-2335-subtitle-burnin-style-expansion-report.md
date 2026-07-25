# Brainstorm — Mở rộng tuỳ chọn phụ đề burn-in

Ngày: 2026-07-25 · Trạng thái: ĐÃ DUYỆT (full scope, gồm lề ngang + wrap dòng)

## 1. Problem statement

Panel "Phụ đề" hiện chỉ có 7 control và engine burn-in chỉ map 5 field ASS — quá nghèo so với thứ `force_style` cho phép. Scout còn lộ 3 lỗi thật nằm dưới, không chỉ là "ít option":

| # | Hiện trạng | Vị trí | Hậu quả |
|---|---|---|---|
| 1 | `burnSubs` map đúng `FontName, FontSize, PrimaryColour, Outline=0\|1, Alignment(2/5/8), MarginV`; `BorderStyle=1` hardcode | `lib/ffmpeg.ts:362-409` | Bỏ trống ~14 field ASS khác (OutlineColour, BackColour, Shadow, Bold/Italic/Underline, Spacing, ScaleX/Y, MarginL/R, alpha) |
| 2 | Font là ô text tự do, default `Be Vietnam Pro` **không kèm trong repo**; `public/` chỉ có svg; `burnSubs(..., fontsDir=undefined)` | `lib/schema.ts:293`, `lib/render.ts:253` | libass fallback font hệ thống → **preview ≠ render**, render máy khác/Windows ra font khác |
| 3 | Preview CSS tự map style riêng (`textShadow` hack) | `app/video/[jobId]/page.tsx:524-550` | 2 nguồn sự thật → thêm option nào cũng lệch tiếp |
| 4 | `toSrt` 1 câu = 1 cue, không wrap dòng; SRT→ASS mặc định MarginL/R=10 @PlayResX=384 ≈ 2.6%/bên | `lib/timeline.ts:166-179` | Câu tiếng Việt dài chạy sát mép khung 9:16, điểm ngắt dòng do libass tự quyết |
| 5 | `parseConfig` merge nông, **không clamp/validate** subtitles | `lib/storyboard-render-input.ts:75` | config rác từ bundle.zip máy khác → ffmpeg chết giữa chừng |
| 6 | Bản Python song sinh hardcode `SUBTITLE_STYLE_DEFAULTS` | `~/.claude/skills/manga-to-video/scripts/mtv/ffmpeg_cmd.py:135` | Đổi schema TS → lệch 2 bản |
| 7 | **ffmpeg trên PATH (brew 8.1.2) build THIẾU libass**, mà `resolveBin` ưu tiên PATH | `lib/ffmpeg.ts:109-134` | **Burn-in hiện KHÔNG chạy trên máy dev** — chỉ in cảnh báo. Bản bundled `ffmpeg-static` (6.0) lại CÓ libass |

## 2. Requirements đã chốt

- **Expected output**: panel Phụ đề đầy đủ (font catalog, màu + độ mờ, viền dày + màu, bóng, nền hộp, bold/italic/underline/IN HOA, giãn chữ, lề ngang, wrap dòng, preset) — burn-in ra MP4 khớp preview.
- **Acceptance**:
  - Burn-in **thực sự chạy** trên máy dev hiện tại (hiện đang bị skip vì ffmpeg PATH thiếu libass).
  - Đổi bất kỳ option nào → preview CSS đổi tương ứng, render MP4 ra kết quả cùng hướng (sai số chỉ ở bo góc hộp + điểm wrap).
  - Render 2 máy khác nhau (macOS + Windows) cùng config → **cùng font**.
  - bundle.zip config v1 cũ vẫn render được (migrate `outline:bool` → `outlineWidth`).
  - `pnpm test:unit` + verify mới PASS; ffmpeg thiếu libass vẫn degrade cảnh báo như cũ.
- **Out of scope**: sinh .ass (fade/karaoke/blur/per-cue), preset tự lưu của user, persist renderConfig vào `.mtvproj`, upload font riêng.
- **Constraints**: giữ pipeline SRT → `subtitles` filter; `.srt` rời LUÔN xuất; engine dùng chung CLI + in-app route; font phải OFL/Apache-2.0 và **đủ dấu tiếng Việt**.
- **Touchpoints**: `lib/schema.ts`, `lib/ffmpeg.ts`, `lib/render.ts`, `lib/storyboard-render-input.ts`, `lib/timeline.ts`, `app/video/[jobId]/page.tsx`, `app/globals.css`, `public/fonts/`, `scripts/verify-*.mts`, `mtv/ffmpeg_cmd.py`, README.

## 3. Approaches đã cân nhắc

| Approach | Pros | Cons | Kết luận |
|---|---|---|---|
| **A. Mở rộng `force_style` (giữ SRT)** | Rủi ro thấp nhất, không đụng pipeline, Python sync dễ, phủ ~20 field ASS | Không có fade in/out, `\blur`, karaoke từng chữ, style riêng per-cue | ✅ **CHỌN** |
| B. Sinh `.ass` riêng cho burn-in | Mở khoá fade/blur/karaoke/`\pos`/nhiều style | +~120 dòng ASS writer + test; Python lệch xa hơn; chưa có word-timing thật nên karaoke chỉ là giả lập theo ký tự | Để dành |
| C. A trước, chừa interface lên B | Ít việc nhất | Nguy cơ refactor lần 2 | Không cần — A đã phủ hết yêu cầu hiện tại |

**Font**: bundle font OFL vào repo (thắng) > dropdown font hệ thống (render máy khác vẫn lệch) > cho upload font riêng (phát sinh sanitize + phình bundle.zip).

## 4. Giải pháp chốt

### 4.1 Một module, hai đầu ra — diệt tận gốc "preview ≠ render"

```
lib/subtitle-style.ts   (thuần, không I/O → test không cần spawn ffmpeg)
  ├─ toAssForceStyle(style) → "FontName=…,Bold=1,Outline=2,BackColour=&H80000000,…"
  └─ toPreviewCss(style)    → { fontFamily, WebkitTextStroke, paintOrder, textShadow, … }
```

`burnSubs` chỉ còn ghép chuỗi + gọi ffmpeg; `page.tsx` chỉ còn spread object CSS.

### 4.2 Schema v2

```ts
interface SubtitleStyle {
  export, burnIn, position, marginPct          // giữ nguyên
  font: string                                 // family name từ catalog (vẫn nhận free-text)
  sizePct: number
  color: string;  opacity: number              // → PrimaryColour &HAABBGGRR
  bold, italic, underline, uppercase: boolean
  letterSpacing: number                        // → Spacing
  border: 'none' | 'outline' | 'box'           // → BorderStyle 1(+Outline=0) | 1 | 3
  outlineWidth: number                         // 0–4, THAY outline:boolean
  outlineColor: string; outlineOpacity: number // → OutlineColour (xem ghi chú)
  shadowDepth: number                          // 0–4 → Shadow
  shadowColor: string                          // → BackColour
  sideMarginPct: number                        // → MarginL = MarginR
  maxCharsPerLine: number                      // áp trong toSrt (0 = tắt)
}
```

**Ghi chú ASS quan trọng — ĐÃ SỬA sau khi đo thực nghiệm** (bản nháp đầu ghi nhầm là `BackColour`). Field mang 2 nghĩa là `OutlineColour`:

| | `BorderStyle=1` | `BorderStyle=3` |
|---|---|---|
| `OutlineColour` | màu viền | **màu hộp** |
| `BackColour` | màu bóng | màu bóng |

Bằng chứng: `BorderStyle=3 + OutlineColour=&H0000FF00` → hộp xanh lá, `BackColour` đỏ không ảnh hưởng; `BorderStyle=1 + OutlineColour` đỏ + `BackColour` xanh dương → viền đỏ, bóng xanh. Nên UI dùng **một** field `outlineColor` cho cả viền lẫn nền hộp (đổi nhãn theo mode), `shadowColor` là field riêng → `BackColour`.

- `RENDER_CONFIG_VERSION` 1 → 2. Migration trong `parseConfig`: `outline:true → outlineWidth:2`, `false → 0`.
- Thêm `clampSubtitles()`: số kẹp biên, màu regex `^#[0-9a-f]{6}$`, enum whitelist, font trim. Bắt buộc — input đến từ bundle.zip ngoài.

### 4.3 Font bundle (WYSIWYG thật)

`content-extractor/public/fonts/*.ttf` (Regular + Bold mỗi họ) + `lib/fonts.ts` catalog. **Cùng file .ttf** phục vụ 2 đường:

- Browser: `@font-face { src: url('/fonts/…​.ttf') }` trong `globals.css`
- ffmpeg: `fontsdir='<cwd>/public/fonts'`

Thứ tự resolve: `opts.fontsDir` → `SUBS_FONTS_DIR` → `public/fonts` bundled.

Catalog 8 họ — **đã verify bằng Google Fonts CSS API** là có subset `vietnamese`:

| Họ | Vai trò | License |
|---|---|---|
| Be Vietnam Pro | mặc định, sans hiện đại | OFL |
| Roboto | trung tính an toàn | Apache-2.0 |
| Montserrat | geometric đậm nổi | OFL |
| Oswald | condensed — thay Anton/Bebas | OFL |
| Kanit | heavy impact, caption viral | OFL |
| Nunito | bo tròn, tông nhẹ | OFL |
| Merriweather | serif, tông cổ trang | OFL |
| Barlow Condensed | hẹp, nhét nhiều chữ 1 dòng | OFL |

**KHÔNG dùng** (verify: thiếu dấu tiếng Việt): **Anton, Bebas Neue, Archivo Black, Alfa Slab One, Fredoka, Bungee** — đúng nhóm font "caption viral" hay bị chọn theo quán tính.

### 4.4 Panel UI

```
Phụ đề
├ Preset:  [Sạch] [Nền đen] [Đậm nổi] [Cổ trang] [Tin tức]
├ Font        [Select ▾ 8 họ, mỗi item render bằng chính font đó]
├ Cỡ chữ      ─────●──  4.5%          Độ mờ ──────● 100%
├ Màu chữ     [■]
├ Kiểu        [B] [I] [U] [IN HOA]    Giãn chữ ──●── 0
├ Viền/Nền    ( ) Không  (•) Viền  ( ) Nền hộp
│   ├ Viền:  dày ──●── 2   màu [■] + độ mờ   ← nhãn đổi thành "Nền hộp: đệm / màu / độ mờ" ở mode hộp
│   └ Bóng:  sâu ──●── 1   màu [■]            ← giữ nguyên ở mọi mode (BackColour)
├ Vị trí      [Dưới ▾]   Lề dọc ──●── 8%   Lề ngang ──●── 6%
├ Wrap        tối đa ──●── 34 ký tự/dòng
└ Burn-in     [on]  (luôn kèm .srt rời)
```

5 preset hằng số trong `lib/subtitle-presets.ts`: Sạch · Nền đen · Đậm nổi (TikTok) · Cổ trang · Tin tức. **Không** làm preset tự lưu — `renderConfig` không persist vào `.mtvproj`, preset custom sẽ mất khi mở lại project (muốn có phải đổi format `.mtvproj` — scope khác).

### 4.5 Preview parity

| ASS | CSS |
|---|---|
| `Outline=w` + `OutlineColour` | `paint-order: stroke fill` + `-webkit-text-stroke: {w*2}px` (CSS stroke căn giữa, ASS căn ngoài → nhân đôi) |
| `Shadow=d` + `BackColour` | `text-shadow: {d}px {d}px 0 {color}` |
| `BorderStyle=3` | `background` + `padding` + `box-decoration-break: clone` |
| `Spacing` | `letter-spacing` |
| `MarginL/R` | `padding-inline` theo `cqw` |
| đơn vị ASS @PlayResY=288 | `calc({v}/2.88 * 1cqh)` — khung preview đã là container query |

Badge "Preview xấp xỉ" giữ nguyên.

### 4.6 Wrap dòng

`toSrt` chèn `\n` theo `maxCharsPerLine` (ngắt ở khoảng trắng, giữ nguyên số cue) → cải thiện luôn file `.srt` sidecar cho YouTube, không chỉ burn-in. Hàm wrap đặt trong `lib/timeline.ts` cạnh `splitSentences` để preview dùng chung.

## 5. Phases đề xuất

Plan chi tiết: `plans/260725-2348-subtitle-burnin-style-expansion/`

| P | Nội dung | Files |
|---|---|---|
| 1 | **Chọn ffmpeg có libass cho bước burn** (fix burn-in không chạy) | `ffmpeg.ts`, `render.ts`, `README.md` |
| 2 | Schema v2 + migration + clamp + `lib/subtitle-style.ts` | `schema.ts`, `subtitle-style.ts`, `storyboard-render-input.ts` |
| 3 | Font bundle + `lib/fonts.ts` + `@font-face` + wiring `fontsdir` | `public/fonts/`, `fonts.ts`, `globals.css`, `ffmpeg.ts`, `render.ts` |
| 4 | Panel UI mới + `lib/subtitle-presets.ts` | `components/video/subtitle-panel.tsx`, `subtitle-presets.ts`, `page.tsx` |
| 5 | Preview parity + wrap dòng trong `toSrt` | `page.tsx`, `timeline.ts`, `subtitle-style.ts` |
| 6 | Test `verify-subtitle-style.mts` + sync Python + README | `scripts/`, `mtv/ffmpeg_cmd.py`, `README.md` |

## 6. Risks

| Rủi ro | Giảm thiểu |
|---|---|
| Family name trong TTF lệch chuỗi `FontName` → font im lặng fallback | Test bằng `fc-scan` lúc thêm font; catalog lưu **đúng** family name đọc từ file |
| bundle.zip v1 cũ migrate sai | Test migration trong `verify-subtitle-style.mts` với fixture v1 |
| Repo phình 3–5MB | Chỉ Regular + Bold, 8 họ; không kèm woff2 (dùng chung .ttf cho cả browser) |
| Preview vẫn lệch ở bo góc hộp / điểm wrap | Chấp nhận, badge "xấp xỉ"; wrap đã đồng bộ nhờ dùng chung hàm |
| Cả hai nguồn ffmpeg đều thiếu libass | Giữ nguyên nhánh degrade + cảnh báo hiện có |
| **Sai tên field ASS → libass bỏ qua IM LẶNG** (đã đo: `FieldKhongCoThat=9` cho exit 0) | Test đối chiếu chuỗi `force_style` với whitelist field V4+, không dựa vào exit code ffmpeg |
| Lệch TS ↔ Python | Phase 6 sync `SUBTITLE_STYLE_DEFAULTS` + builder force_style |

## 6b. Kiểm chứng thực nghiệm (2026-07-25)

| # | Phát hiện | Bằng chứng |
|---|---|---|
| 1 | ffmpeg PATH (brew 8.1.2) **không có** filter `subtitles`/`ass` | `No such filter: 'subtitles'` |
| 2 | ffmpeg bundled (`ffmpeg-static` 5.3.0 = ffmpeg 6.0) **có** libass 0.17.0 | config `--enable-libass --enable-libfreetype --enable-fontconfig` |
| 3 | `force_style` nhận đủ field dự định (Bold/Italic/Underline/Spacing/Outline*/Back*/BorderStyle 1\|3/Margin L,R,V/alpha) | render OK toàn bộ |
| 4 | Màu hộp `BorderStyle=3` = `OutlineColour` | hộp xanh lá khi `OutlineColour=&H0000FF00` |
| 5 | `BorderStyle=1`: viền = `OutlineColour`, bóng = `BackColour` | viền đỏ + bóng xanh dương |
| 6 | Alpha `PrimaryColour` hoạt động | `&H80FFFFFF` → chữ mờ 50% |
| 7 | Field sai tên bị bỏ qua im lặng | `FieldKhongCoThat=9` → exit 0 |
| 8 | Font không tồn tại → fallback im lặng nhưng libass log stderr | `fontselect: (KhongTonTai123, 400, 0) -> /System/Library/Fonts/Helvetica.ttc` → dùng làm assertion test font |

## 7. Success metrics

- Render cùng config trên macOS + Windows → font/viền/nền giống nhau (so ảnh frame).
- Screenshot preview vs frame MP4 cùng mốc thời gian → chữ cùng font, cùng vị trí, cùng kiểu viền.
- bundle.zip v1 cũ render không lỗi.
- `pnpm test:unit` + `verify-subtitle-style.mts` PASS.

## 8. Câu hỏi còn treo

- Weight bundle: chỉ Regular+Bold, hay cần thêm ExtraBold cho Montserrat/Kanit (caption đậm)? → chốt lúc P2 sau khi cân dung lượng thật.
- `maxCharsPerLine` mặc định bao nhiêu cho 9:16 ở `sizePct` 4.5? → đo thực nghiệm ở P4.
