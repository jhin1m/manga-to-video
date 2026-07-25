// Test thuần lib/subtitle-style.ts: mapping style → force_style của ASS, migrate config v1→v2,
// kẹp biên giá trị rác. Không cần ffmpeg — chạy tức thời.
//
// Vì sao phải đối chiếu TÊN FIELD: libass BỎ QUA IM LẶNG field sai chính tả (đo thực tế:
// `FieldKhongCoThat=9` vẫn cho ffmpeg exit 0), nên exit code không bắt được lỗi gõ nhầm.
import { FONT_CATALOG } from '../lib/fonts';
import { defaultRenderConfig, type SubtitleStyle } from '../lib/schema';
import { SUBTITLE_PRESETS } from '../lib/subtitle-presets';
import {
  ASS_STYLE_FIELDS,
  assColor,
  migrateSubtitleStyle,
  toAssForceStyle,
} from '../lib/subtitle-style';
import { formatCaption, wrapCaption } from '../lib/timeline';

let failures = 0;
const eq = (a: unknown, e: unknown, label: string) => {
  if (JSON.stringify(a) === JSON.stringify(e)) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(e)}\n    actual:   ${JSON.stringify(a)}`,
    );
  }
};
const ok = (cond: boolean, label: string) => eq(Boolean(cond), true, label);

const d = defaultRenderConfig().subtitles;
const fields = (style: SubtitleStyle) =>
  Object.fromEntries(
    toAssForceStyle(style)
      .split(',')
      .map((pair) => {
        const i = pair.indexOf('=');
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
  );

console.log('verify-subtitle-style: tên field ASS');
{
  const keys = Object.keys(fields(d));
  eq(
    keys.filter((k) => !(ASS_STYLE_FIELDS as readonly string[]).includes(k)),
    [],
    'không sinh field ngoài whitelist ASS V4+',
  );
  eq(keys.length, ASS_STYLE_FIELDS.length, `sinh đủ ${ASS_STYLE_FIELDS.length} field`);
}

console.log('verify-subtitle-style: assColor (&HAABBGGRR, AA=00 là đục)');
eq(assColor('#ff0000', 1), '&H000000FF', 'đỏ đục');
eq(assColor('#00ff00', 1), '&H0000FF00', 'xanh lá đục');
eq(assColor('#ff0000', 0.5), '&H800000FF', 'đỏ mờ 50% → alpha 0x80');
eq(assColor('#ffffff', 0), '&HFFFFFFFF', 'trong suốt hoàn toàn → alpha 0xFF');
eq(assColor('không-phải-màu', 1), '&H00FFFFFF', 'hex hỏng → trắng đục');

console.log('verify-subtitle-style: mapping kích thước theo PlayRes (X=384, Y=288)');
{
  const f = fields({ ...d, sizePct: 4.5, marginPct: 8, sideMarginPct: 6 });
  // Cỡ chữ chia 432 chứ không phải 288 — libass render nhỏ hơn 1,5 lần so với công thức
  // PlayResY (đo trong verify-subtitle-render.mts). 4.5% × 432 = 19,44 → 19.
  eq(f.FontSize, '19', 'FontSize = round(4.5% × 432) — số chia riêng cho cỡ chữ');
  eq(f.MarginV, '23', 'MarginV = round(8% × 288)');
  eq(f.MarginL, '23', 'MarginL = round(6% × 384) — lề ngang tính theo PlayResX');
  eq(f.MarginR, '23', 'MarginR = MarginL');
  eq(fields({ ...d, sizePct: 1 }).FontSize, '8', 'FontSize có sàn 8');
}

console.log('verify-subtitle-style: 3 mode viền/nền');
{
  const outline = fields({ ...d, border: 'outline', outlineWidth: 3 });
  eq(outline.BorderStyle, '1', 'outline → BorderStyle 1');
  eq(outline.Outline, '3', 'outline → độ dày giữ nguyên');

  const none = fields({ ...d, border: 'none', outlineWidth: 3 });
  eq(none.BorderStyle, '1', 'none → vẫn BorderStyle 1 (giữ được bóng)');
  eq(none.Outline, '0', 'none → độ dày 0 bất kể outlineWidth');

  // Đã đo bằng libass: ở BorderStyle 3, MÀU HỘP lấy từ OutlineColour, KHÔNG phải BackColour.
  const box = fields({ ...d, border: 'box', outlineColor: '#0b2545', outlineOpacity: 0.85 });
  eq(box.BorderStyle, '3', 'box → BorderStyle 3');
  eq(box.OutlineColour, assColor('#0b2545', 0.85), 'box → màu hộp nằm ở OutlineColour');
  eq(box.BackColour, assColor(d.shadowColor, 1), 'box → BackColour vẫn là màu bóng');
}

console.log('verify-subtitle-style: kiểu chữ + vị trí');
{
  const f = fields({ ...d, bold: true, italic: true, underline: true, letterSpacing: 1.5, shadowDepth: 2 });
  eq(f.Bold, '1', 'Bold');
  eq(f.Italic, '1', 'Italic');
  eq(f.Underline, '1', 'Underline');
  eq(f.Spacing, '1.5', 'Spacing');
  eq(f.Shadow, '2', 'Shadow');
  // force_style dùng hệ SSA v4 cũ: 2/6/10 = dưới/trên/giữa và đều căn GIỮA theo chiều ngang.
  // Numpad V4+ (8=trên, 5=giữa) cho ra sai cả trục dọc lẫn căn lề ngang — đo ở
  // verify-subtitle-render.mts.
  eq(fields({ ...d, position: 'top' }).Alignment, '6', 'top → Alignment 6 (trên-giữa, hệ SSA v4)');
  eq(fields({ ...d, position: 'middle' }).Alignment, '10', 'middle → Alignment 10 (giữa-giữa)');
  eq(fields({ ...d, position: 'bottom' }).Alignment, '2', 'bottom → Alignment 2 (dưới-giữa)');
}

console.log('verify-subtitle-style: font name không phá cú pháp force_style');
{
  eq(fields({ ...d, font: "Be Vietnam Pro" }).FontName, 'Be Vietnam Pro', 'giữ nguyên tên hợp lệ');
  eq(fields({ ...d, font: "A',B:C" }).FontName, 'ABC', "lọc ' : , khỏi FontName");
  eq(fields({ ...d, font: '   ' }).FontName, 'Arial', 'rỗng → Arial');
}

console.log('verify-subtitle-style: migrate config v1 → v2');
{
  const v1 = {
    export: true,
    burnIn: true,
    font: 'Be Vietnam Pro',
    sizePct: 4.5,
    color: '#ffffff',
    outline: true,
    position: 'bottom',
    marginPct: 8,
  };
  const on = migrateSubtitleStyle(v1);
  eq({ border: on.border, outlineWidth: on.outlineWidth }, { border: 'outline', outlineWidth: 2 }, 'outline:true → viền dày 2');
  const off = migrateSubtitleStyle({ ...v1, outline: false });
  eq({ border: off.border, outlineWidth: off.outlineWidth }, { border: 'none', outlineWidth: 0 }, 'outline:false → không viền');
  eq(on.sizePct, 4.5, 'giữ nguyên field v1 hợp lệ');
  eq(on.sideMarginPct, d.sideMarginPct, 'field mới lấy mặc định');
  eq(on.maxCharsPerLine, 0, 'wrap mặc định TẮT — config cũ giữ nguyên hành vi');
}

console.log('verify-subtitle-style: kẹp biên giá trị rác (nguồn là bundle.zip máy khác)');
{
  const junk = migrateSubtitleStyle({
    sizePct: 999,
    color: 'javascript:alert(1)',
    border: 'xyz',
    opacity: 5,
    outlineWidth: -3,
    letterSpacing: 'abc',
    position: 'nowhere',
    maxCharsPerLine: 3,
    marginPct: Number.NaN,
  });
  eq(junk.sizePct, 20, 'sizePct kẹp trần 20');
  eq(junk.color, d.color, 'màu hỏng → mặc định');
  eq(junk.border, d.border, 'border lạ → mặc định');
  eq(junk.opacity, 1, 'opacity kẹp trần 1');
  eq(junk.outlineWidth, 0, 'outlineWidth kẹp sàn 0');
  eq(junk.letterSpacing, d.letterSpacing, 'letterSpacing không phải số → mặc định');
  eq(junk.position, d.position, 'position lạ → mặc định');
  eq(junk.maxCharsPerLine, 0, 'wrap < 12 ký tự là vô nghĩa → tắt');
  eq(junk.marginPct, d.marginPct, 'NaN → mặc định');
  ok(migrateSubtitleStyle(null) !== null, 'null → mặc định, không ném lỗi');
  ok(migrateSubtitleStyle('rác') !== null, 'chuỗi → mặc định, không ném lỗi');
}

console.log('verify-subtitle-style: wrapCaption');
{
  const s = 'Nàng ta bước vào đại sảnh rồi quay đầu nhìn lại một lần cuối';
  eq(wrapCaption(s, 0), s, 'maxChars = 0 → giữ nguyên văn');
  eq(wrapCaption('', 20), '', 'chuỗi rỗng');
  eq(wrapCaption('mottutuchayratdaikhongcokhoangtrang', 10), 'mottutuchayratdaikhongcokhoangtrang', 'một từ dài hơn giới hạn → để tràn, không cắt giữa từ');
  const wrapped = wrapCaption(s, 20);
  ok(wrapped.includes('\n'), 'câu dài → có xuống dòng');
  ok(
    wrapped.split('\n').every((line) => line.length <= 20 || !line.includes(' ')),
    'mọi dòng ≤ 20 ký tự (trừ dòng chỉ có một từ dài)',
  );
  eq(wrapped.replace(/\n/g, ' '), s, 'ghép lại đúng nguyên văn — không mất/thêm chữ');
  eq(wrapCaption('a b', 20), 'a b', 'ngắn hơn giới hạn → một dòng');
}

console.log('verify-subtitle-style: formatCaption (IN HOA + wrap dùng chung cho .srt lẫn preview)');
{
  const s = 'Nàng ta bước vào';
  eq(formatCaption(s, undefined), s, 'không style → nguyên văn');
  eq(formatCaption(s, { uppercase: true, maxCharsPerLine: 0 }), 'NÀNG TA BƯỚC VÀO', 'uppercase giữ dấu tiếng Việt');
  eq(
    formatCaption(s, { uppercase: false, maxCharsPerLine: 12 }),
    'Nàng ta bước\nvào',
    'wrap đúng vị trí',
  );
}

console.log('verify-subtitle-style: preset');
{
  ok(SUBTITLE_PRESETS.length >= 3, `có ${SUBTITLE_PRESETS.length} preset`);
  const fonts = new Set(FONT_CATALOG.map((f) => f.family));
  for (const preset of SUBTITLE_PRESETS) {
    // Preset áp lên style hiện tại rồi phải sống sót qua clamp mà KHÔNG bị đổi giá trị nào.
    const applied = { ...d, ...preset.style };
    eq(migrateSubtitleStyle(applied), applied, `preset "${preset.label}" hợp lệ sau clamp`);
    ok(!preset.style.font || fonts.has(preset.style.font), `preset "${preset.label}" dùng font có trong catalog`);
    ok(preset.style.export === undefined && preset.style.burnIn === undefined, `preset "${preset.label}" không đụng export/burnIn`);
  }
}

console.log(failures === 0 ? '\nSUBTITLE_STYLE_ALL_PASS' : `\nSUBTITLE_STYLE_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
