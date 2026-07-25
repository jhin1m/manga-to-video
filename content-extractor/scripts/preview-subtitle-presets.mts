// Xuất ảnh mẫu mỗi preset phụ đề (khung 9:16) để soi bằng mắt — dùng ĐÚNG đường engine
// (toAssForceStyle + binary có libass + font bundled), không phải mô phỏng.
//
//   pnpm exec tsx scripts/preview-subtitle-presets.mts [thư-mục-đích]
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundledFontsDir, resolveSubtitleBin } from '../lib/ffmpeg';
import { defaultRenderConfig } from '../lib/schema';
import { SUBTITLE_PRESETS } from '../lib/subtitle-presets';
import { toAssForceStyle } from '../lib/subtitle-style';
import { formatCaption } from '../lib/timeline';

const outDir = process.argv[2] ?? '.render/preset-preview';
const bin = await resolveSubtitleBin();
if (!bin) {
  console.error('Không nguồn ffmpeg nào có libass — không xuất được ảnh mẫu.');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const TEXT = 'Nàng ta bước vào đại sảnh rồi quay đầu nhìn lại một lần cuối';

for (const preset of SUBTITLE_PRESETS) {
  const style = { ...defaultRenderConfig().subtitles, ...preset.style };
  const srt = path.join(outDir, `${preset.id}.srt`);
  await writeFile(srt, `1\n00:00:00,000 --> 00:00:01,000\n${formatCaption(TEXT, style)}\n`);
  const png = path.join(outDir, `${preset.id}.png`);
  const r = spawnSync(
    bin,
    [
      '-y', '-f', 'lavfi', '-i', 'color=c=0x5a5a5a:s=608x1080:d=1',
      '-vf',
      `subtitles=filename='${path.resolve(srt)}':force_style='${toAssForceStyle(style)}':fontsdir='${bundledFontsDir()}'`,
      '-frames:v', '1', png,
    ],
    { encoding: 'utf8' },
  );
  console.log(`${r.status === 0 ? '✓' : '✗'} ${preset.label.padEnd(9)} → ${png}`);
}
