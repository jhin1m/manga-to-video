// Nguồn DUY NHẤT quy đổi SubtitleStyle → ASS (burn-in) và → CSS (preview). Trước đây hai
// phía tự map riêng nên preview lệch render; mọi thay đổi style từ nay chỉ sửa ở đây.
//
// Module THUẦN: không import node:*, không I/O — client component import được, và test chạy
// bằng tsx không cần spawn ffmpeg.
//
// Đơn vị: ffmpeg chuyển .srt sang ASS với PlayResX=384 / PlayResY=288, libass scale theo chiều
// cao video. Nên mọi kích thước tính theo phần trăm khung rồi nhân với PLAY_RES.
import type { CSSProperties } from 'react';
import type { SubtitleBorder, SubtitleStyle } from './schema';
import { defaultRenderConfig } from './schema';

export const PLAY_RES = { x: 384, y: 288 } as const;

// Cỡ chữ KHÔNG dùng PLAY_RES.y. Đo thực tế (libass 0.17 qua filter `subtitles`, khung
// 608×1080 / 1920×1080 / 1080×1080 — kết quả chỉ phụ thuộc chiều CAO khung):
//
//   FontSize=13 (=4.5% × 288) → chữ hoa cao 25px trên khung 1080 = 2,3% chiều cao
//   FontSize=19,5 (=4.5% × 432) → cao ~35px = 3,2% ≈ đúng bằng 4.5% × tỉ lệ cap-height
//
// Tức libass render chữ nhỏ hơn 1,5 lần so với công thức PlayResY=288. Lề và viền/bóng thì
// KHÔNG dính hệ số này (đã đo: MarginV 23→8,7% và 46→16,8%, đúng độ dốc 288; Outline 4 →
// dày 15px = 4 × 1080/288). Nên chỉ cỡ chữ dùng số chia riêng, để "Cỡ chữ x%" trong UI ra
// đúng x% chiều cao khung trong MP4 — và khớp với preview (`font-size: x cqh`).
// scripts/verify-subtitle-render.mts canh gác con số này: libass đổi hành vi là test đỏ.
export const FONT_SIZE_DIVISOR = 432;

// Bảng vai trò màu trong ASS — ĐÃ ĐO bằng libass 0.17, không phải suy đoán:
//
//                  BorderStyle=1 (viền)   BorderStyle=3 (hộp)
//   OutlineColour   màu viền               MÀU HỘP
//   BackColour      màu bóng               màu bóng
//
// Vì vậy outlineColor phục vụ cả hai mode; shadowColor luôn là BackColour.

const HEX_RE = /^#?([0-9a-f]{6})$/i;

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHex(v: unknown, fallback: string): string {
  const m = typeof v === 'string' ? v.trim().match(HEX_RE) : null;
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

// #rrggbb + độ đục → &HAABBGGRR (ASS: AA=00 đục hoàn toàn, FF trong suốt hoàn toàn).
export function assColor(hex: string, opacity = 1): string {
  const m = hex.trim().match(HEX_RE);
  const alpha = Math.round((1 - clamp(opacity, 0, 1, 1)) * 255)
    .toString(16)
    .padStart(2, '0');
  if (!m) return `&H${alpha}FFFFFF`.toUpperCase();
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  return `&H${alpha}${bb}${gg}${rr}`.toUpperCase();
}

// #rrggbb + độ đục → rgba() cho preview.
function cssColor(hex: string, opacity = 1): string {
  const m = hex.trim().match(HEX_RE);
  const a = clamp(opacity, 0, 1, 1);
  if (!m) return `rgba(255,255,255,${a})`;
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(m[1].slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

// Font là free-text (config cũ / bundle máy khác) — lọc ký tự phá cú pháp force_style (' : , \).
function safeFontName(font: string): string {
  return font.replace(/[^\w À-ỹ.-]/g, '').trim() || 'Arial';
}

// CẢNH BÁO: `force_style` của ffmpeg đi qua ass_process_force_style, và libass parse chuỗi đó
// theo hệ căn lề SSA v4 CŨ — KHÔNG phải numpad của ASS V4+. Đo toàn bảng (libass 0.17):
//
//   1 dưới-trái   2 dưới-GIỮA   3 dưới-phải
//   5 trên-trái   6 trên-GIỮA   7 trên-phải
//   9 giữa-trái  10 giữa-GIỮA  11 giữa-phải
//
// Dùng numpad (top=8, middle=5) như trực giác sẽ ra "giữa khung căn trái" và "trên căn trái".
// scripts/verify-subtitle-render.mts đo lại vị trí thật nên đổi hành vi là test đỏ.
export function alignmentOf(position: SubtitleStyle['position']): number {
  return position === 'top' ? 6 : position === 'middle' ? 10 : 2;
}

// BorderStyle của ASS chỉ có 1 (viền + bóng) và 3 (hộp đục). Mode 'none' = BorderStyle 1 với
// độ dày viền 0 — vẫn giữ được bóng.
function borderStyleOf(border: SubtitleBorder): 1 | 3 {
  return border === 'box' ? 3 : 1;
}

/** Chuỗi force_style cho filter `subtitles` của ffmpeg. */
export function toAssForceStyle(style: SubtitleStyle): string {
  const fontSize = Math.max(8, Math.round((style.sizePct / 100) * FONT_SIZE_DIVISOR));
  const marginV = Math.round((style.marginPct / 100) * PLAY_RES.y);
  const marginSide = Math.round((style.sideMarginPct / 100) * PLAY_RES.x);
  const outline = style.border === 'none' ? 0 : style.outlineWidth;
  return [
    `FontName=${safeFontName(style.font)}`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${assColor(style.color, style.opacity)}`,
    `OutlineColour=${assColor(style.outlineColor, style.outlineOpacity)}`,
    `BackColour=${assColor(style.shadowColor, 1)}`,
    `Bold=${style.bold ? 1 : 0}`,
    `Italic=${style.italic ? 1 : 0}`,
    `Underline=${style.underline ? 1 : 0}`,
    `Spacing=${style.letterSpacing}`,
    `BorderStyle=${borderStyleOf(style.border)}`,
    `Outline=${outline}`,
    `Shadow=${style.shadowDepth}`,
    `Alignment=${alignmentOf(style.position)}`,
    `MarginL=${marginSide}`,
    `MarginR=${marginSide}`,
    `MarginV=${marginV}`,
  ].join(',');
}

// Danh sách field ASS mà toAssForceStyle được phép sinh. libass BỎ QUA IM LẶNG field sai tên
// (đo: `FieldKhongCoThat=9` vẫn exit 0), nên đây là lưới an toàn duy nhất — test đối chiếu.
export const ASS_STYLE_FIELDS = [
  'FontName',
  'FontSize',
  'PrimaryColour',
  'OutlineColour',
  'BackColour',
  'Bold',
  'Italic',
  'Underline',
  'Spacing',
  'BorderStyle',
  'Outline',
  'Shadow',
  'Alignment',
  'MarginL',
  'MarginR',
  'MarginV',
] as const;

/**
 * CSS cho overlay caption trong preview. Trả về style của phần TỬ CHỮ; caller lo phần định vị
 * (top/bottom theo position) và padding ngang từ `sideMarginPct`.
 *
 * Xấp xỉ có kiểm soát:
 * - `-webkit-text-stroke` vẽ nét CĂN GIỮA đường viền chữ, ASS vẽ RA NGOÀI → nhân đôi độ dày.
 * - Hộp CSS bo theo dòng (`box-decoration-break: clone`), libass vẽ hộp sát chữ hơn.
 */
export function toPreviewCss(style: SubtitleStyle): CSSProperties {
  const unit = (assUnits: number) => `${(assUnits / PLAY_RES.y) * 100}cqh`;
  const isBox = style.border === 'box';
  const outline = style.border === 'none' ? 0 : style.outlineWidth;
  const shadow =
    style.shadowDepth > 0
      ? `${unit(style.shadowDepth)} ${unit(style.shadowDepth)} 0 ${cssColor(style.shadowColor, 1)}`
      : undefined;
  return {
    fontFamily: `'${style.font}', sans-serif`,
    fontSize: `${style.sizePct}cqh`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    letterSpacing: style.letterSpacing ? unit(style.letterSpacing) : undefined,
    color: cssColor(style.color, style.opacity),
    // Viền chỉ vẽ ở mode 'outline'; mode 'box' dùng nền thay cho viền (giống libass).
    WebkitTextStroke: !isBox && outline > 0 ? `${unit(outline * 2)} ${cssColor(style.outlineColor, style.outlineOpacity)}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: shadow,
    backgroundColor: isBox ? cssColor(style.outlineColor, style.outlineOpacity) : undefined,
    padding: isBox ? `${unit(outline)} ${unit(outline * 2)}` : undefined,
    boxDecorationBreak: isBox ? 'clone' : undefined,
    WebkitBoxDecorationBreak: isBox ? 'clone' : undefined,
    whiteSpace: 'pre-line', // wrapCaption chèn '\n' — preview phải ngắt cùng chỗ với .srt
  } as CSSProperties;
}

/**
 * Đọc style từ nguồn ngoài (bundle.zip máy khác, .mtvproj cũ, body request) → SubtitleStyle
 * hợp lệ. Gộp cả migrate v1→v2 lẫn kẹp biên: config rác không được phép làm chết ffmpeg.
 */
export function migrateSubtitleStyle(raw: unknown): SubtitleStyle {
  const d = defaultRenderConfig().subtitles;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;

  // v1 chỉ có `outline: boolean`. Bật → viền dày 2 (xấp xỉ hình cũ), tắt → không viền.
  const legacyOutline = typeof r.outline === 'boolean' ? r.outline : undefined;
  const border: SubtitleBorder =
    r.border === 'none' || r.border === 'outline' || r.border === 'box'
      ? r.border
      : legacyOutline === undefined
        ? d.border
        : legacyOutline
          ? 'outline'
          : 'none';
  const outlineWidth =
    r.outlineWidth === undefined && legacyOutline !== undefined
      ? legacyOutline
        ? 2
        : 0
      : clamp(r.outlineWidth, 0, 4, d.outlineWidth);

  const maxChars = clamp(r.maxCharsPerLine, 0, 80, d.maxCharsPerLine);
  return {
    export: bool(r.export, d.export),
    burnIn: bool(r.burnIn, d.burnIn),
    font: typeof r.font === 'string' && r.font.trim() ? r.font.trim() : d.font,
    sizePct: clamp(r.sizePct, 1, 20, d.sizePct),
    color: normalizeHex(r.color, d.color),
    opacity: clamp(r.opacity, 0, 1, d.opacity),
    bold: bool(r.bold, d.bold),
    italic: bool(r.italic, d.italic),
    underline: bool(r.underline, d.underline),
    uppercase: bool(r.uppercase, d.uppercase),
    letterSpacing: clamp(r.letterSpacing, -2, 10, d.letterSpacing),
    border,
    outlineWidth,
    outlineColor: normalizeHex(r.outlineColor, d.outlineColor),
    outlineOpacity: clamp(r.outlineOpacity, 0, 1, d.outlineOpacity),
    shadowDepth: clamp(r.shadowDepth, 0, 4, d.shadowDepth),
    shadowColor: normalizeHex(r.shadowColor, d.shadowColor),
    position:
      r.position === 'top' || r.position === 'middle' || r.position === 'bottom'
        ? r.position
        : d.position,
    marginPct: clamp(r.marginPct, 0, 40, d.marginPct),
    sideMarginPct: clamp(r.sideMarginPct, 0, 25, d.sideMarginPct),
    // Wrap dưới 12 ký tự/dòng là vô nghĩa (chữ vỡ vụn) — coi như tắt.
    maxCharsPerLine: maxChars > 0 && maxChars < 12 ? 0 : Math.round(maxChars),
  };
}
