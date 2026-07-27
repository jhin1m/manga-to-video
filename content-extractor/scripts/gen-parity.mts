// Xuất snapshot parity: mọi hằng số + golden mà skill Python (~/.claude/skills/manga-to-video)
// phải khớp. Skill là port TAY của lib/ này — 45+ hằng số và toàn bộ logic style phụ đề tồn
// tại hai bản, không có gì buộc chúng bằng nhau. Snapshot là sợi dây đó.
//
// TS là NGUỒN CHÂN LÝ: lệch thì sửa Python theo, không sinh ngược.
//
// Chạy: pnpm gen:parity   (ghi thẳng vào repo skill, rồi commit BÊN ĐÓ)
// Kiểm: pnpm test:parity  (sinh lại trong bộ nhớ, so với file đã commit)
//
// Golden quan trọng hơn constants: constants bắt lệch SỐ, golden bắt lệch LOGIC — thứ tự
// field ASS, cách làm tròn, quy tắc `0 < maxChars < 12 → 0`, vai trò OutlineColour ở
// BorderStyle=3. Nên golden sinh bằng cách GỌI hàm thật, không gõ tay giá trị kỳ vọng.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { AUTO_REGION_DEFAULTS } from '../lib/auto-region';
import { FONT_BLACKLIST, FONT_CATALOG } from '../lib/fonts';
import {
  MAX_PAN_FRAME_PER_SEC,
  PAN_MAX_COVER,
  PAN_MAX_COVER_WIDE,
  PAN_MIN_COVER,
  PAN_SUPERSAMPLE_LOW,
  PAN_SUPERSAMPLE_MAX_PX,
  STRIP_SHAPE,
  SUPERSAMPLE,
} from '../lib/kenburns';
import { defaultRenderConfig, type SubtitleStyle } from '../lib/schema';
import { MIN_BAND_RATIO, SHOT_MAX_HEIGHT_DEFAULT } from '../lib/shot-split';
import { SUBTITLE_PRESETS } from '../lib/subtitle-presets';
import {
  ASS_STYLE_FIELDS,
  FONT_SIZE_DIVISOR,
  PLAY_RES,
  alignmentOf,
  migrateSubtitleStyle,
  toAssForceStyle,
} from '../lib/subtitle-style';
import { TIMELINE_DEFAULTS, formatCaption } from '../lib/timeline';

export const PARITY_VERSION = 1;

// Consumer chính là Python nên khoá đi ra dạng snake_case — bên này chuyển một lần khi sinh.
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeKeys = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v]));

// `export`/`burnIn` là cờ của UI web; skill CLI dùng --subs srt|burn|both thay. Bỏ khỏi
// snapshot để SUBTITLE_STYLE_DEFAULTS bên Python đúng 19 field.
const UI_ONLY_KEYS = ['export', 'burnIn'];
const styleToSnake = (o: Record<string, unknown>) =>
  snakeKeys(Object.fromEntries(Object.entries(o).filter(([k]) => !UI_ONLY_KEYS.includes(k))));

const DEFAULTS = defaultRenderConfig().subtitles;
const withDefaults = (over: Partial<SubtitleStyle>): SubtitleStyle => ({ ...DEFAULTS, ...over });

// --- Golden 1: style đầy đủ → chuỗi force_style ------------------------------
// Phủ 5 preset + mặc định + cả ba mode `border` + cả ba `position`. Chuỗi so TUYỆT ĐỐI, kể
// cả thứ tự field — thứ tự thuộc hợp đồng vì libass đọc theo tên nhưng test đọc theo vị trí.
const FORCE_STYLE_CASES: Array<{ name: string; style: SubtitleStyle }> = [
  { name: 'default', style: DEFAULTS },
  ...SUBTITLE_PRESETS.map((p) => ({ name: `preset:${p.id}`, style: withDefaults(p.style) })),
  { name: 'border:none', style: withDefaults({ border: 'none', outlineWidth: 3 }) },
  { name: 'border:box', style: withDefaults({ border: 'box', outlineColor: '#0b2545', outlineOpacity: 0.85 }) },
  { name: 'position:top', style: withDefaults({ position: 'top' }) },
  { name: 'position:middle', style: withDefaults({ position: 'middle' }) },
  // BẪY làm tròn, cố ý: Math.round của JS làm tròn half-away-from-zero, round() của Python
  // là banker's rounding. Hai pct dưới cho tích ĐÚNG BẰNG n,5 với n CHẴN — chỗ duy nhất hai
  // cách làm tròn ra khác nhau: 7.8125% × 288 = 22,5 → JS 23 / Python 22;
  // 2.734375% × 384 = 10,5 → JS 11 / Python 10. Bên Python phải dùng js_round mới qua.
  { name: 'lam-tron-nua-don-vi', style: withDefaults({ marginPct: 7.8125, sideMarginPct: 2.734375, letterSpacing: 0.5, shadowDepth: 1.5 }) },
  // BẪY alpha: (1−0.3)×255 = 178,5 chằn — giá trị DUY NHẤT trên lưới 4 chữ số thập phân làm
  // Math.round (179 → B3) khác round() của Python (178 → B2). Người dùng gõ 0.3 là chạm ngay.
  { name: 'alpha nua don vi', style: withDefaults({ opacity: 0.3, outlineOpacity: 0.3 }) },
  // `\w` của Python là Unicode, của JS là ASCII — bản TS xoá sạch CJK, Python thì không.
  { name: 'font ngoai ASCII', style: withDefaults({ font: 'Noto Sans JP 日本語' }) },
  { name: 'font toan ky tu bi loc', style: withDefaults({ font: '思源黑体' }) },
];

// --- Golden 2: raw rác → style đã kẹp biên -----------------------------------
// Mỗi dòng của bảng clamp một case. Raw viết camelCase (hợp đồng TS) rồi đổi sang snake khi ghi.
const NORMALIZE_CASES: Array<{ name: string; raw: Record<string, unknown> }> = [
  { name: 'rong', raw: {} },
  { name: 'sizePct tren tran', raw: { sizePct: 45 } },
  { name: 'sizePct duoi san', raw: { sizePct: 0.2 } },
  { name: 'sizePct sai kieu', raw: { sizePct: 'to' } },
  { name: 'opacity ngoai mien', raw: { opacity: 3, outlineOpacity: -1 } },
  { name: 'letterSpacing ngoai mien', raw: { letterSpacing: 99 } },
  { name: 'outlineWidth ngoai mien', raw: { outlineWidth: 9 } },
  { name: 'shadowDepth ngoai mien', raw: { shadowDepth: -4 } },
  { name: 'marginPct ngoai mien', raw: { marginPct: 80, sideMarginPct: 60 } },
  { name: 'maxChars duoi 12', raw: { maxCharsPerLine: 8 } },
  { name: 'maxChars tren tran', raw: { maxCharsPerLine: 500 } },
  { name: 'maxChars le', raw: { maxCharsPerLine: 28.5 } },
  { name: 'position la', raw: { position: 'lung tung' } },
  { name: 'border la', raw: { border: 'vien day' } },
  { name: 'mau khong hop le', raw: { color: 'xanh', outlineColor: '#GGG', shadowColor: '112233' } },
  { name: 'mau viet hoa co #', raw: { color: '#FFAA00' } },
  { name: 'font rong', raw: { font: '   ' } },
  { name: 'font co khoang trang thua', raw: { font: '  Kanit  ' } },
  { name: 'bool sai kieu', raw: { bold: 1, uppercase: 'yes' } },
  { name: 'v1 outline true', raw: { outline: true } },
  { name: 'v1 outline false', raw: { outline: false } },
  { name: 'v1 outline kem border', raw: { outline: false, border: 'box' } },
  { name: 'v1 outline kem outlineWidth', raw: { outline: true, outlineWidth: 4 } },
  { name: 'field la', raw: { khongCoThat: 5 } },
  // Ngữ pháp số của JS ≠ float() của Python, lệch cả hai chiều. `"1_0"`: Python đọc ra 10,
  // JS ra NaN → cùng config mà web dựng chữ 4.5% còn skill dựng 10%.
  { name: 'chuoi gach duoi', raw: { sizePct: '1_0' } },
  { name: 'chuoi hex', raw: { sizePct: '0x10' } },
  { name: 'chuoi nhi phan', raw: { sizePct: '0b101' } },
  { name: 'chuoi inf', raw: { sizePct: 'inf' } },
  { name: 'chuoi so mu', raw: { sizePct: '1e1' } },
  { name: 'mang rong', raw: { sizePct: [] } },
  { name: 'mang mot phan tu', raw: { sizePct: [5] } },
  { name: 'mang hai phan tu', raw: { sizePct: [1, 2] } },
  { name: 'object', raw: { sizePct: {} } },
];

// --- Golden 3: text hiển thị của caption -------------------------------------
const CAPTION_TEXT = 'Nàng ta bước vào đại sảnh, ánh nến lay động trên vách đá lạnh';
const CAPTION_CASES: Array<{ name: string; text: string; style: Pick<SubtitleStyle, 'uppercase' | 'maxCharsPerLine'> }> = [
  { name: 'nguyen van', text: CAPTION_TEXT, style: { uppercase: false, maxCharsPerLine: 0 } },
  { name: 'in hoa', text: CAPTION_TEXT, style: { uppercase: true, maxCharsPerLine: 0 } },
  { name: 'wrap 12', text: CAPTION_TEXT, style: { uppercase: false, maxCharsPerLine: 12 } },
  { name: 'wrap 28', text: CAPTION_TEXT, style: { uppercase: false, maxCharsPerLine: 28 } },
  { name: 'in hoa + wrap 28', text: CAPTION_TEXT, style: { uppercase: true, maxCharsPerLine: 28 } },
  // Từ dài hơn giới hạn phải để TRÀN, không cắt giữa từ.
  { name: 'tu dai hon gioi han', text: 'Nghiêng Thành Khuynh Quốc Tuyệt Sắc Giai Nhân', style: { uppercase: false, maxCharsPerLine: 12 } },
  { name: 'giu xuong dong san co', text: 'Dòng một\nDòng hai dài hơn một chút', style: { uppercase: false, maxCharsPerLine: 12 } },
];

export function buildParity() {
  return {
    version: PARITY_VERSION,
    generated_from: 'content-extractor/lib',
    constants: {
      auto_region: snakeKeys(AUTO_REGION_DEFAULTS as unknown as Record<string, unknown>),
      kenburns: {
        strip_shape: STRIP_SHAPE,
        pan_min_cover: PAN_MIN_COVER,
        pan_max_cover: PAN_MAX_COVER,
        pan_max_cover_wide: PAN_MAX_COVER_WIDE,
        max_pan_frame_per_sec: MAX_PAN_FRAME_PER_SEC,
        supersample: SUPERSAMPLE,
        pan_supersample_max_px: PAN_SUPERSAMPLE_MAX_PX,
        pan_supersample_low: PAN_SUPERSAMPLE_LOW,
      },
      timeline: snakeKeys(TIMELINE_DEFAULTS as unknown as Record<string, unknown>),
      shot_split: {
        shot_max_height_default: SHOT_MAX_HEIGHT_DEFAULT,
        min_band_ratio: MIN_BAND_RATIO,
      },
      subtitle_style: {
        play_res_x: PLAY_RES.x,
        play_res_y: PLAY_RES.y,
        font_size_divisor: FONT_SIZE_DIVISOR,
        alignment: Object.fromEntries(
          (['top', 'middle', 'bottom'] as const).map((p) => [p, alignmentOf(p)]),
        ),
        ass_style_fields: [...ASS_STYLE_FIELDS],
      },
    },
    subtitle_defaults: styleToSnake(DEFAULTS as unknown as Record<string, unknown>),
    subtitle_presets: SUBTITLE_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      hint: p.hint,
      style: styleToSnake(p.style as Record<string, unknown>),
    })),
    fonts: {
      catalog: FONT_CATALOG.map((f) => f.family),
      blacklist: [...FONT_BLACKLIST],
    },
    golden: {
      force_style: FORCE_STYLE_CASES.map((c) => ({
        name: c.name,
        style: styleToSnake(c.style as unknown as Record<string, unknown>),
        expected: toAssForceStyle(c.style),
      })),
      normalize: NORMALIZE_CASES.map((c) => ({
        name: c.name,
        raw: snakeKeys(c.raw),
        expected: styleToSnake(migrateSubtitleStyle(c.raw) as unknown as Record<string, unknown>),
      })),
      captions: CAPTION_CASES.map((c) => ({
        name: c.name,
        text: c.text,
        style: styleToSnake(c.style as unknown as Record<string, unknown>),
        expected: formatCaption(c.text, c.style),
      })),
    },
  };
}

/** Thư mục repo skill, hoặc null nếu không tìm thấy bản cài đặt hợp lệ. */
export function resolveSkillDir(): string | null {
  const dir = process.env.MTV_SKILL_DIR ?? path.join(homedir(), '.claude/skills/manga-to-video');
  // gen ghi RA NGOÀI repo này — trỏ nhầm MTV_SKILL_DIR là rải file bậy vào thư mục lạ. Chỉ
  // nhận thư mục có đủ dấu vân tay của skill.
  const isSkill = existsSync(path.join(dir, 'SKILL.md')) && existsSync(path.join(dir, 'scripts/mtv'));
  return isSkill ? dir : null;
}

export const parityFileIn = (dir: string) => path.join(dir, 'schemas/parity.json');

// So bằng đường dẫn file, KHÔNG bằng `file://${argv[1]}`: URL escape khoảng trắng nên chuỗi
// ghép tay không khớp và script sẽ im lặng không ghi gì.
if (import.meta.filename === process.argv[1]) {
  const skillDir = resolveSkillDir();
  const target = skillDir
    ? parityFileIn(skillDir)
    : path.join(process.cwd(), '.render/parity.json');
  if (!skillDir) {
    console.warn(
      `gen-parity: không thấy repo skill (MTV_SKILL_DIR chưa đặt, hoặc thư mục thiếu SKILL.md/scripts/mtv).\n` +
        `            Ghi tạm ra ${target} — KHÔNG phải nơi skill đọc.`,
    );
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(buildParity(), null, 2)}\n`, 'utf8');
  console.log(`gen-parity: ✓ ${target}`);
  if (skillDir) console.log('            nhớ commit file này BÊN REPO SKILL.');
}
