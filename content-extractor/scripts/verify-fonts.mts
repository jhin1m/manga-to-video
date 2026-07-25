// Kiểm font bundled trong public/fonts:
//   1. Mọi entry trong FONT_CATALOG có đủ file Regular + Bold.
//   2. Tên family bên trong TTF khớp TUYỆT ĐỐI chuỗi trong catalog — lệch một ký tự là libass
//      im lặng rơi về font hệ thống, preview và MP4 lệch nhau mà không có lỗi nào.
//   3. Font có đủ glyph tiếng Việt (ệ ữ ẫ Đ đ) — Anton/Bebas Neue kiểu font caption phổ biến
//      lại thiếu, thêm nhầm là ra ô vuông tofu.
//   4. libass thật sự CHỌN file trong public/fonts (đọc dòng `fontselect:` ở stderr), không
//      phải font trùng tên của hệ thống.
//
// (2)(3) cần fontconfig (fc-scan/fc-query) — thiếu thì SKIP, không fail. (4) cần ffmpeg có
// libass — thiếu cũng SKIP.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundledFontsDir, resolveSubtitleBin } from '../lib/ffmpeg';
import { FONT_CATALOG } from '../lib/fonts';
import { defaultRenderConfig } from '../lib/schema';
import { toAssForceStyle } from '../lib/subtitle-style';

let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
};
const skip = (label: string) => console.log(`  — SKIP ${label}`);

const dir = bundledFontsDir();
const has = (bin: string) => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;

console.log('verify-fonts: file trong catalog tồn tại');
for (const entry of FONT_CATALOG) {
  for (const file of [entry.files.regular, entry.files.bold]) {
    ok(existsSync(path.join(dir, file)), `${entry.family} → ${file}`);
  }
}

console.log('verify-fonts: family name trong TTF khớp catalog');
if (!has('fc-scan')) {
  skip('không có fontconfig (fc-scan) trên máy này');
} else {
  for (const entry of FONT_CATALOG) {
    for (const file of [entry.files.regular, entry.files.bold]) {
      const p = path.join(dir, file);
      if (!existsSync(p)) continue;
      const r = spawnSync('fc-scan', ['--format', '%{family[0]}', p], { encoding: 'utf8' });
      ok(r.stdout.trim() === entry.family, `${file} → family "${r.stdout.trim()}" == "${entry.family}"`);
    }
  }
}

console.log('verify-fonts: glyph tiếng Việt (ệ ữ ẫ Đ đ)');
if (!has('fc-query')) {
  skip('không có fontconfig (fc-query) trên máy này');
} else {
  const CODES = [0x1ec7, 0x1eef, 0x1eab, 0x110, 0x111];
  for (const entry of FONT_CATALOG) {
    for (const file of [entry.files.regular, entry.files.bold]) {
      const p = path.join(dir, file);
      if (!existsSync(p)) continue;
      const charset = spawnSync('fc-query', ['--format', '%{charset}', p], { encoding: 'utf8' }).stdout;
      const ranges = charset.split(/\s+/).filter(Boolean).map((r) => {
        const [a, b] = r.split('-');
        return [Number.parseInt(a, 16), Number.parseInt(b ?? a, 16)] as const;
      });
      const missing = CODES.filter((cp) => !ranges.some(([lo, hi]) => cp >= lo && cp <= hi));
      ok(missing.length === 0, `${file} đủ dấu${missing.length ? ` (thiếu ${missing.map((c) => c.toString(16)).join(',')})` : ''}`);
    }
  }
}

console.log('verify-fonts: libass chọn đúng file trong public/fonts');
{
  const bin = await resolveSubtitleBin();
  if (!bin) {
    skip('không nguồn ffmpeg nào có libass');
  } else {
    const tmp = await mkdtemp(path.join(tmpdir(), 'verify-fonts-'));
    const srt = path.join(tmp, 'one.srt');
    await writeFile(srt, '1\n00:00:00,000 --> 00:00:01,000\nNàng ta bước vào đại sảnh\n');
    // Kiểm 2 họ: mặc định + một họ chắc chắn KHÔNG có sẵn trong macOS/Windows.
    for (const family of ['Be Vietnam Pro', 'Barlow Condensed']) {
      const entry = FONT_CATALOG.find((f) => f.family === family)!;
      const style = { ...defaultRenderConfig().subtitles, font: family, bold: true };
      const r = spawnSync(
        bin,
        [
          '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:d=1',
          '-vf',
          `subtitles=filename='${srt}':force_style='${toAssForceStyle(style)}':fontsdir='${dir}'`,
          '-frames:v', '1', path.join(tmp, 'f.png'),
        ],
        { encoding: 'utf8' },
      );
      const line = String(r.stderr).split('\n').find((l) => l.includes('fontselect:')) ?? '';
      // libass in đích đã chọn: đường dẫn file (provider fontconfig) HOẶC PostScript name
      // (provider coretext trên macOS) — nên so theo tên file đã bỏ đuôi .ttf.
      // "Barlow Condensed" không có sẵn trong macOS/Windows: chọn được nghĩa là fontsdir ăn.
      const stems = [entry.files.bold, entry.files.regular].map((f) => f.replace(/\.ttf$/, ''));
      const picked = line.split('->')[1]?.trim() ?? '(không thấy dòng fontselect)';
      ok(stems.some((s) => line.includes(s)), `${family} → libass chọn font bundled (${picked})`);
    }
    await rm(tmp, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? '\nFONTS_ALL_PASS' : `\nFONTS_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
