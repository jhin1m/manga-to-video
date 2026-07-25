import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SubtitleStyle } from './schema';

// Wrapper ffmpeg/ffprobe qua child_process.spawn. Đường dẫn binary resolve theo thứ tự:
// env FFMPEG_PATH/FFPROBE_PATH → PATH hệ thống → bản bundled từ npm (ffmpeg-static /
// @ffprobe-installer). PATH đứng trước bundled để máy đã cài ffmpeg (vd brew ffmpeg 8)
// giữ nguyên engine đang dùng; máy chưa cài (Windows mới clone) tự rơi xuống bundled.

// AbortSignal → hủy render: child ffmpeg đang chạy bị kill (SIGKILL), lời gọi reject bằng
// lỗi tên 'AbortError' để caller (route render) phân biệt "người hủy" với "render lỗi thật".
export function abortError(message = 'Render bị hủy'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

// signal (tùy chọn, param cuối) giữ chữ ký cũ tương thích — CLI không truyền vẫn chạy như trước.
export function runCommand(bin: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    signal?.addEventListener('abort', onAbort);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      cleanup();
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT: path sai · EACCES/EPERM: không có quyền thực thi (vd Defender chặn binary
      // download, hoặc FFMPEG_PATH trỏ file thường) · EISDIR: trỏ nhầm thư mục (vd đặt
      // FFMPEG_PATH=C:\ffmpeg\bin thay vì file .exe). Chỉ còn xảy ra khi env override sai
      // hoặc binary bundled hỏng — resolveBin đã lo fallback PATH/bundled trước khi tới đây.
      if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EISDIR') {
        reject(
          new Error(
            `Không chạy được "${bin}" (${code}) — file không tồn tại, không có quyền thực thi, ` +
              `hoặc trỏ nhầm thư mục. Kiểm tra FFMPEG_PATH/FFPROBE_PATH nếu có đặt, hoặc ${installHint()}.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      cleanup();
      // Child bị kill do abort → close code≠0; bọc thành AbortError thay vì "thoát mã null".
      if (aborted) {
        reject(abortError());
        return;
      }
      if (code === 0) resolve(stdout);
      else {
        // Đuôi stderr chứa lỗi thật của ffmpeg — cắt gọn cho dễ đọc.
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        reject(new Error(`${bin} thoát mã ${code}:\n${tail}`));
      }
    });
  });
}

// ==== Resolve binary: env → PATH hệ thống → bundled ====

type FfBin = 'ffmpeg' | 'ffprobe';

// Lệnh cài theo OS — dùng trong cả message ENOENT lẫn message "hết nguồn resolve".
function installHint(): string {
  return process.platform === 'win32'
    ? 'cài ffmpeg: winget install Gyan.FFmpeg (hoặc scoop install ffmpeg) rồi mở lại terminal'
    : process.platform === 'darwin'
      ? 'cài ffmpeg: brew install ffmpeg'
      : 'cài ffmpeg bằng package manager (vd: sudo apt install ffmpeg)';
}

// Path bundled từ npm — import lazy trong try/catch: thiếu package/binary (platform lạ,
// postinstall download fail, chạy standalone không node_modules) → null, không crash module.
async function bundledBin(bin: FfBin): Promise<string | null> {
  try {
    if (bin === 'ffmpeg') {
      const mod = await import('ffmpeg-static');
      const p = mod.default;
      return typeof p === 'string' && existsSync(p) ? p : null;
    }
    const mod = await import('@ffprobe-installer/ffprobe');
    const p = (mod.default ?? mod) as { path?: string };
    return p.path && existsSync(p.path) ? p.path : null;
  } catch {
    return null;
  }
}

// Cache promise per-process (pattern như filterListCache). Chỉ khi CẢ ba nguồn đều thiếu
// (reject) mới xoá khỏi cache cho lần gọi sau thử lại; đã resolve thì binary giữ nguyên
// tới hết tiến trình — đổi env hay cài ffmpeg mới cần restart server mới ăn.
const binCache = new Map<FfBin, Promise<string>>();

function resolveBin(bin: FfBin): Promise<string> {
  let cached = binCache.get(bin);
  if (!cached) {
    cached = (async () => {
      const envVar = bin === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH';
      const fromEnv = process.env[envVar]?.trim();
      // Env là override cứng: trỏ sai sẽ lỗi rõ lúc spawn, không silent fallback.
      if (fromEnv) return fromEnv;
      try {
        await runCommand(bin, ['-version']);
        return bin;
      } catch {
        // PATH không có hoặc binary hỏng → thử bundled.
      }
      const bundled = await bundledBin(bin);
      if (bundled) return bundled;
      throw new Error(
        `Không tìm thấy ${bin} trên PATH lẫn bản bundled trong node_modules — ${installHint()}; ` +
          `hoặc đặt ${envVar} trỏ thẳng tới binary.`,
      );
    })();
    cached.catch(() => binCache.delete(bin));
    binCache.set(bin, cached);
  }
  return cached;
}

// Mọi call site ffmpeg/ffprobe trong repo đi qua 2 hàm này để hưởng resolver.
export async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<string> {
  return runCommand(await resolveBin('ffmpeg'), args, signal);
}

export async function runFfprobe(args: string[], signal?: AbortSignal): Promise<string> {
  return runCommand(await resolveBin('ffprobe'), args, signal);
}

export async function assertFfmpeg(): Promise<void> {
  await runFfmpeg(['-version']);
  await runFfprobe(['-version']);
}

// Một số bản ffmpeg build thiếu libass (filter subtitles) — burn-in phụ đề phải kiểm tra
// trước và degrade rõ ràng thay vì chết giữa chừng. Cache theo tiến trình.
let filterListCache: string | null = null;
export async function hasFilter(name: string): Promise<boolean> {
  if (filterListCache === null) {
    filterListCache = await runFfmpeg(['-hide_banner', '-filters']);
  }
  return new RegExp(`\\s${name}\\s`).test(filterListCache);
}

// Độ dài (giây) của file media — nguồn duy nhất cho cả TTS (P3) và render (P5).
export async function probeDurationSec(filePath: string, signal?: AbortSignal): Promise<number> {
  const out = await runFfprobe(
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    signal,
  );
  const sec = Number.parseFloat(out.trim());
  if (!Number.isFinite(sec) || sec < 0) {
    throw new Error(`ffprobe không đọc được độ dài: ${filePath}`);
  }
  return sec;
}

// Có video + audio stream không (assert đầu ra cuối).
export async function probeStreams(filePath: string): Promise<string[]> {
  const out = await runFfprobe([
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return out.trim().split('\n').filter(Boolean);
}

// Render MỘT shot: ảnh tĩnh + filtergraph Ken Burns → đoạn video chuẩn hoá
// (libx264/yuv420p, cùng fps/size để concat demuxer nối thẳng không re-encode).
export async function renderShot(opts: {
  image: string;
  filter: string; // filtergraph từ lib/kenburns.ts — kết thúc ở nhãn [v]
  durationSec: number;
  fps: number;
  out: string;
  signal?: AbortSignal;
}): Promise<void> {
  await runFfmpeg(
    [
      '-y',
      '-loop',
      '1',
      '-framerate',
      String(opts.fps), // input t chạy đúng nhịp output → biểu thức pan theo t không judder
      '-i',
      opts.image,
      '-filter_complex',
      opts.filter,
      '-map',
      '[v]',
      '-t',
      opts.durationSec.toFixed(3),
      '-r',
      String(opts.fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      opts.out,
    ],
    opts.signal,
  );
}

// ==== Ghép cuối (P6) ====

// Nối các shot bằng concat demuxer — mọi shot đã chuẩn hoá cùng codec/fps/size/pix_fmt
// từ renderShot nên copy thẳng, không re-encode.
export async function concatVideo(shotFiles: string[], out: string, signal?: AbortSignal): Promise<void> {
  const listPath = `${out}.list.txt`;
  // concat demuxer cần đường dẫn escape quote đơn.
  const list = shotFiles
    .map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`)
    .join('\n');
  await writeFile(listPath, list);
  await runFfmpeg(
    ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', out],
    signal,
  );
}

// Dựng track narration dài totalSec: mỗi seg audio đặt tại đúng start_seg (adelay),
// đoạn không audio = im lặng. amix normalize=0 giữ nguyên mức từng nguồn (không chồng
// lấn thời gian nên không lo clip).
export async function buildAudioTrack(
  segAudio: Array<{ path: string; startSec: number }>,
  totalSec: number,
  out: string,
  signal?: AbortSignal,
): Promise<void> {
  if (segAudio.length === 0) {
    await runFfmpeg(
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=44100:cl=stereo:d=${totalSec.toFixed(3)}`,
        '-c:a',
        'pcm_s16le',
        out,
      ],
      signal,
    );
    return;
  }
  const args: string[] = ['-y'];
  for (const seg of segAudio) {
    args.push('-i', seg.path);
  }
  const delayed = segAudio
    .map((seg, i) => {
      const ms = Math.round(seg.startSec * 1000);
      return `[${i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`;
    })
    .join(';');
  const labels = segAudio.map((_, i) => `[a${i}]`).join('');
  const mixOrCopy =
    segAudio.length === 1
      ? `${labels}apad=whole_dur=${totalSec.toFixed(3)}[aout]`
      : `${labels}amix=inputs=${segAudio.length}:normalize=0,apad=whole_dur=${totalSec.toFixed(3)}[aout]`;
  args.push(
    '-filter_complex',
    `${delayed};${mixOrCopy}`,
    '-map',
    '[aout]',
    '-t',
    totalSec.toFixed(3),
    '-c:a',
    'pcm_s16le',
    out,
  );
  await runFfmpeg(args, signal);
}

// Trộn BGM dưới narration với sidechain ducking: BGM hạ khi có lời (sidechaincompress),
// loop khi ngắn / cắt theo totalSec khi dài. duckDb âm càng sâu → nén càng mạnh.
export async function duckBgm(
  narrationTrack: string,
  bgmPath: string,
  opts: { volume: number; duckDb: number },
  totalSec: number,
  out: string,
  signal?: AbortSignal,
): Promise<void> {
  // Map duckDb → ratio nén: -6dB → 4, -12dB → 8, -18dB → 12 (kẹp 2..20).
  const ratio = Math.max(2, Math.min(20, Math.abs(opts.duckDb) * (2 / 3)));
  await runFfmpeg(
    [
      '-y',
      '-i',
      narrationTrack,
      '-stream_loop',
      '-1',
      '-i',
      bgmPath,
      '-filter_complex',
      [
        `[1:a]atrim=0:${totalSec.toFixed(3)},aresample=44100,aformat=channel_layouts=stereo,volume=${opts.volume}[bgm]`,
        `[bgm][0:a]sidechaincompress=threshold=0.02:ratio=${ratio.toFixed(2)}:attack=20:release=400[ducked]`,
        `[0:a][ducked]amix=inputs=2:normalize=0[aout]`,
      ].join(';'),
      '-map',
      '[aout]',
      '-t',
      totalSec.toFixed(3),
      '-c:a',
      'pcm_s16le',
      out,
    ],
    signal,
  );
}

// #rrggbb → &HAABBGGRR (ASS, alpha 00 = đục).
function assColor(hex: string): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return '&H00FFFFFF';
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

// Escape đường dẫn cho filter subtitles (Windows-style colon + quote).
function escapeFilterPath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// Burn phụ đề vào video theo style config. libass canh FontSize/Margin theo PlayResY=288
// mặc định của SRT. Font tiếng Việt: chỉ định tên font trong style; SUBS_FONTS_DIR (hoặc
// opts.fontsDir) trỏ thư mục font tuỳ chọn khi font không nằm trong hệ thống.
export async function burnSubs(
  video: string,
  srtPath: string,
  style: SubtitleStyle,
  out: string,
  fontsDir?: string,
  signal?: AbortSignal,
): Promise<void> {
  const playResY = 288;
  const fontSize = Math.max(8, Math.round((style.sizePct / 100) * playResY));
  const marginV = Math.round((style.marginPct / 100) * playResY);
  const alignment = style.position === 'top' ? 8 : style.position === 'middle' ? 5 : 2;
  // Font là free-text từ UI/bundle — lọc ký tự phá cú pháp force_style (' : , \).
  const safeFont = style.font.replace(/[^\w À-ỹ.-]/g, '').trim() || 'Arial';
  const forceStyle = [
    `FontName=${safeFont}`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${assColor(style.color)}`,
    `Outline=${style.outline ? 1 : 0}`,
    `BorderStyle=1`,
    `Alignment=${alignment}`,
    `MarginV=${marginV}`,
  ].join(',');
  const dir = fontsDir ?? process.env.SUBS_FONTS_DIR;
  // ffmpeg 8 parse option theo key=value — filename phải là option CÓ TÊN khi đi kèm
  // force_style (positional + quoted bị parser mới từ chối).
  const filter =
    `subtitles=filename='${escapeFilterPath(srtPath)}':force_style='${forceStyle}'` +
    (dir ? `:fontsdir='${escapeFilterPath(dir)}'` : '');
  await runFfmpeg(
    [
      '-y',
      '-i',
      video,
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      out,
    ],
    signal,
  );
}

// Ghép video + audio → MP4 cuối (video copy, audio AAC).
export async function mux(video: string, audio: string, out: string, signal?: AbortSignal): Promise<void> {
  await runFfmpeg(
    ['-y', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out],
    signal,
  );
}
