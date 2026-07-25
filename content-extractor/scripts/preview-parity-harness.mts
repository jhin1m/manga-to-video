// Dựng file HTML mô phỏng ĐÚNG khung player của /video/[jobId] (aspect 9:16, container query)
// với style sinh từ toPreviewCss — để so trực tiếp với frame libass do
// preview-subtitle-presets.mts xuất ra. Không mô phỏng lại CSS bằng tay: mọi thuộc tính lấy
// thẳng từ lib/subtitle-style.ts.
//
//   pnpm exec tsx scripts/preview-parity-harness.mts [file-html-đích]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultRenderConfig, type SubtitleStyle } from '../lib/schema';
import { SUBTITLE_PRESETS } from '../lib/subtitle-presets';
import { toPreviewCss } from '../lib/subtitle-style';
import { formatCaption } from '../lib/timeline';

const out = process.argv[2] ?? '.render/preset-preview/parity.html';
const TEXT = 'Nàng ta bước vào đại sảnh rồi quay đầu nhìn lại một lần cuối';

// React CSSProperties → chuỗi CSS. Khoá dạng `WebkitTextStroke` phải ra `-webkit-text-stroke`
// (có gạch đầu) — React tự làm việc này, harness thì phải làm tay.
function toCssText(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const kebab = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      return `${k.startsWith('Webkit') ? `-${kebab}` : kebab}: ${v}`;
    })
    .join('; ');
}

const panels = SUBTITLE_PRESETS.map((preset) => {
  const style: SubtitleStyle = { ...defaultRenderConfig().subtitles, ...preset.style };
  const css = toCssText(toPreviewCss(style) as Record<string, unknown>);
  const pos =
    style.position === 'top'
      ? `top: ${style.marginPct}cqh`
      : style.position === 'middle'
        ? 'top: 50%; transform: translateY(-50%)'
        : `bottom: ${style.marginPct}cqh`;
  return `
  <figure>
    <div class="player">
      <div class="cap" style="${pos}; padding-inline: ${style.sideMarginPct}cqw;">
        <span style="${css}">${formatCaption(TEXT, style)}</span>
      </div>
    </div>
    <figcaption>${preset.label} (${preset.id})</figcaption>
  </figure>`;
}).join('\n');

// @font-face trỏ file thật trong public/fonts — giống hệt app/globals.css.
const faces = [
  ['Be Vietnam Pro', 'BeVietnamPro'],
  ['Roboto', 'Roboto'],
  ['Montserrat', 'Montserrat'],
  ['Nunito', 'Nunito'],
  ['Oswald', 'Oswald'],
  ['Barlow Condensed', 'BarlowCondensed'],
  ['Kanit', 'Kanit'],
  ['Merriweather', 'Merriweather'],
]
  // Trang này phải mở qua HTTP (Chrome chặn file://) — phục vụ từ gốc content-extractor:
  //   pnpm exec http-server . -p 3110   → /.render/preset-preview/parity.html
  .flatMap(([family, slug]) => [
    `@font-face{font-family:'${family}';font-weight:400;src:url('/public/fonts/${slug}-Regular.ttf') format('truetype');}`,
    `@font-face{font-family:'${family}';font-weight:700;src:url('/public/fonts/${slug}-Bold.ttf') format('truetype');}`,
  ])
  .join('\n');

await writeFile(
  out,
  `<!doctype html><meta charset="utf-8"><title>Preview parity</title>
<style>
${faces}
body{margin:0;background:#222;display:flex;gap:12px;padding:12px;font-family:system-ui}
figure{margin:0}
figcaption{color:#bbb;font-size:12px;text-align:center;margin-top:6px}
.player{width:304px;aspect-ratio:9/16;container-type:size;background:#5a5a5a;position:relative;overflow:hidden}
.cap{position:absolute;left:0;right:0;display:flex;justify-content:center;text-align:center;line-height:1.15}
</style>
${panels}
`,
  'utf8',
);
console.log('đã ghi', path.resolve(out));
