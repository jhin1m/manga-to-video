// Test HÌNH HỌC của phụ đề đã burn: render frame thật rồi ĐO pixel, thay vì tin vào công
// thức. Bắt đúng loại lỗi mà test chuỗi không thấy — libass đổi cách quy đổi đơn vị thì
// force_style vẫn "đúng cú pháp" nhưng chữ ra sai cỡ/sai chỗ.
//
// Vì sao cần: đo thực tế cho thấy libass render cỡ chữ nhỏ hơn 1,5 lần so với công thức
// PlayResY=288 (nên FONT_SIZE_DIVISOR = 432), trong khi lề/viền vẫn theo 288. Ba assertion
// dưới đây khoá cả ba quy tắc đó.
//
// Cần ffmpeg có libass — thiếu thì SKIP, không fail.
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundledFontsDir, resolveSubtitleBin } from '../lib/ffmpeg';
import { defaultRenderConfig, type SubtitleStyle } from '../lib/schema';
import { toAssForceStyle } from '../lib/subtitle-style';

let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
};

const W = 608;
const H = 1080;
// Chuỗi chỉ gồm chữ HOA không dấu, không khoảng trắng: bbox mực = đúng khối chữ, không lẫn
// phần nhô của dấu hay descender.
const TEXT = 'HINHANH';

const bin = await resolveSubtitleBin();
if (!bin) {
  console.log('  — SKIP: không nguồn ffmpeg nào có libass');
  console.log('\nSUBTITLE_RENDER_SKIPPED');
  process.exit(0);
}

const tmp = await mkdtemp(path.join(tmpdir(), 'verify-subs-render-'));
const srt = path.join(tmp, 'a.srt');
await writeFile(srt, `1\n00:00:00,000 --> 00:00:01,000\n${TEXT}\n`);

// Đo hộp bao của pixel có mực trong frame render ra.
function inkBox(style: SubtitleStyle, tag: string) {
  const png = path.join(tmp, `${tag}.png`);
  const render = spawnSync(
    bin!,
    [
      '-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1`,
      '-vf',
      `subtitles=filename='${srt}':force_style='${toAssForceStyle(style)}':fontsdir='${bundledFontsDir()}'`,
      '-frames:v', '1', png,
    ],
    { encoding: 'utf8' },
  );
  if (render.status !== 0) throw new Error(`render ${tag} lỗi: ${String(render.stderr).split('\n').slice(-3).join(' ')}`);
  const raw = spawnSync(bin!, ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {
    maxBuffer: 1 << 28,
  }).stdout;
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (raw[y * W + x] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1, minX, maxX, minY, maxY };
}

const base = defaultRenderConfig().subtitles;

console.log('verify-subtitle-render: cỡ chữ đúng % chiều cao khung');
{
  // Chữ HOA cao khoảng 0,7 em → sizePct% khung ứng với ~0,7 × sizePct% chiều cao pixel.
  // Khoảng chấp nhận rộng để không phụ thuộc cap-height cụ thể của từng font.
  for (const sizePct of [4.5, 7]) {
    const { h } = inkBox({ ...base, sizePct, border: 'none', shadowDepth: 0 }, `size-${sizePct}`);
    const pct = (h / H) * 100;
    ok(
      pct > sizePct * 0.6 && pct < sizePct * 0.85,
      `sizePct ${sizePct}% → chữ hoa cao ${pct.toFixed(2)}% chiều cao khung (cần ${(sizePct * 0.6).toFixed(1)}–${(sizePct * 0.85).toFixed(1)}%)`,
    );
  }
  const small = inkBox({ ...base, sizePct: 4, border: 'none', shadowDepth: 0 }, 'size-4');
  const big = inkBox({ ...base, sizePct: 8, border: 'none', shadowDepth: 0 }, 'size-8');
  ok(Math.abs(big.h / small.h - 2) < 0.15, `cỡ chữ tuyến tính: 8% cao gấp ${(big.h / small.h).toFixed(2)}× so với 4%`);
}

console.log('verify-subtitle-render: lề đúng % khung');
{
  const a = inkBox({ ...base, marginPct: 8, border: 'none', shadowDepth: 0 }, 'mv-8');
  const b = inkBox({ ...base, marginPct: 16, border: 'none', shadowDepth: 0 }, 'mv-16');
  // Chênh lệch đáy giữa 2 mốc = 8% chiều cao khung (phần bù baseline triệt tiêu khi trừ).
  const delta = (H - 1 - a.maxY - (H - 1 - b.maxY)) * -1;
  ok(Math.abs(delta - 0.08 * H) < 0.012 * H, `lề dọc 8%→16% dịch ${Math.abs(delta).toFixed(0)}px (cần ~${(0.08 * H).toFixed(0)}px)`);

  // force_style dùng hệ căn lề SSA v4 cũ (2/6/10 = dưới/trên/giữa, đều căn GIỮA ngang) —
  // dễ nhầm sang numpad V4+ nên đo cả trục dọc lẫn trục ngang.
  const centered = (box: { minX: number; maxX: number }) =>
    Math.abs((box.minX + box.maxX) / 2 - W / 2) < 0.05 * W;

  const top = inkBox({ ...base, position: 'top', marginPct: 8, border: 'none', shadowDepth: 0 }, 'top');
  ok(top.maxY < H / 3, `position=top → chữ ở phần ba TRÊN (y=${top.minY}..${top.maxY})`);
  ok(centered(top), 'position=top → vẫn căn giữa theo chiều ngang');

  const mid = inkBox({ ...base, position: 'middle', border: 'none', shadowDepth: 0 }, 'mid');
  ok(
    Math.abs((mid.minY + mid.maxY) / 2 - H / 2) < 0.08 * H,
    `position=middle → chữ quanh giữa khung (y=${mid.minY}..${mid.maxY})`,
  );
  ok(centered(mid), 'position=middle → vẫn căn giữa theo chiều ngang');

  const bottom = inkBox({ ...base, position: 'bottom', border: 'none', shadowDepth: 0 }, 'bottom');
  ok(bottom.minY > (H * 2) / 3, `position=bottom → chữ ở phần ba DƯỚI (y=${bottom.minY}..${bottom.maxY})`);
  ok(centered(bottom), 'position=bottom → căn giữa theo chiều ngang');
}

console.log('verify-subtitle-render: viền dày lên đúng hướng');
{
  // Viền phải TRẮNG: nền test màu đen, viền đen mặc định sẽ vô hình trong phép đo mực.
  const white = { ...base, outlineColor: '#ffffff' };
  const none = inkBox({ ...white, border: 'none', shadowDepth: 0 }, 'ol-0');
  const thin = inkBox({ ...white, border: 'outline', outlineWidth: 1, shadowDepth: 0 }, 'ol-1');
  const thick = inkBox({ ...white, border: 'outline', outlineWidth: 4, shadowDepth: 0 }, 'ol-4');
  ok(thin.h > none.h && thick.h > thin.h, `viền 0 < 1 < 4 nở dần (${none.h} < ${thin.h} < ${thick.h}px)`);
  // Outline scale theo PlayResY=288: mỗi đơn vị ≈ H/288 = 3,75px mỗi bên.
  const perUnit = (thick.h - thin.h) / 2 / 3;
  ok(Math.abs(perUnit - H / 288) < 1.2, `mỗi đơn vị viền dày ${perUnit.toFixed(2)}px (cần ~${(H / 288).toFixed(2)}px)`);
}

console.log('verify-subtitle-render: nền hộp phủ rộng hơn chữ');
{
  const outline = inkBox({ ...base, border: 'outline', outlineWidth: 2, shadowDepth: 0 }, 'box-off');
  const box = inkBox({ ...base, border: 'box', outlineWidth: 2, outlineColor: '#ffffff', shadowDepth: 0 }, 'box-on');
  ok(box.w > outline.w && box.h > outline.h, `hộp trùm ra ngoài chữ (${box.w}×${box.h} > ${outline.w}×${outline.h})`);
}

await rm(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nSUBTITLE_RENDER_ALL_PASS' : `\nSUBTITLE_RENDER_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
