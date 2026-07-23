// CLI render video từ bundle.zip (nguồn chân lý — Preview UI chỉ là xấp xỉ).
// Cách chạy (Node 24, cần ffmpeg: brew install ffmpeg):
//   npm run render -- bundle.zip --aspect 9:16 --out out.mp4
//   npm run render -- bundle.zip --dry-run            # chỉ timeline.json + .srt, không TTS/ffmpeg
// Flags: --aspect 9:16|16:9|1:1 · --fps N · --out path.mp4 · --bgm path · --subs srt|burn|both
//        --dry-run · --keep (giữ thư mục .render/<jobId>/ để debug)
// Client MỎNG của lib/render.ts::renderVideo — chỉ parse args + dựng RenderInput từ bundle
// + map RenderEvent → log; engine dùng chung với route in-app (không nhân đôi orchestration).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readBundle } from '../lib/bundle';
import type { RenderEvent, RenderInput } from '../lib/render';
import { renderVideo } from '../lib/render';
import type { Aspect, RenderConfig } from '../lib/schema';

interface CliArgs {
  bundlePath: string;
  aspect?: Aspect;
  fps?: number;
  out?: string;
  bgm?: string;
  subs?: 'srt' | 'burn' | 'both';
  dryRun: boolean;
  keep: boolean;
}

function usage(): never {
  console.error(
    'Cách dùng: render-video.mts <bundle.zip> [--aspect 9:16|16:9|1:1] [--fps N] [--out out.mp4] [--bgm file] [--subs srt|burn|both] [--dry-run] [--keep]',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { bundlePath: '', dryRun: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      i++;
      if (i >= argv.length) usage();
      return argv[i];
    };
    if (a === '--aspect') {
      const v = next();
      if (v !== '9:16' && v !== '16:9' && v !== '1:1') usage();
      args.aspect = v;
    } else if (a === '--fps') {
      const v = Number.parseInt(next(), 10);
      if (!Number.isFinite(v) || v < 1) usage();
      args.fps = v;
    } else if (a === '--out') args.out = next();
    else if (a === '--bgm') args.bgm = next();
    else if (a === '--subs') {
      const v = next();
      if (v !== 'srt' && v !== 'burn' && v !== 'both') usage();
      args.subs = v;
    } else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep') args.keep = true;
    else if (a.startsWith('--')) usage();
    else if (!args.bundlePath) args.bundlePath = a;
    else usage();
  }
  if (!args.bundlePath) usage();
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.bundlePath)) {
    console.error(`Không tìm thấy bundle: ${args.bundlePath}`);
    process.exit(1);
  }
  const bundle = readBundle(await readFile(args.bundlePath));
  const { scriptManifest } = bundle;
  // CLI flags đè config trong bundle.
  const config: RenderConfig = {
    ...bundle.config,
    ...(args.aspect ? { aspect: args.aspect } : {}),
    ...(args.fps ? { fps: args.fps } : {}),
  };
  const subsMode = args.subs ?? (config.subtitles.burnIn ? 'both' : 'srt');
  const aspectSlug = config.aspect.replace(':', 'x');
  const outPath = args.out ?? `output-${aspectSlug}.mp4`;
  const outBase = outPath.replace(/\.mp4$/i, '');
  const srtPath = `${outBase}.srt`;
  const timelinePath = `${outBase}.timeline.json`;
  const segments = scriptManifest.segments;

  console.log(
    `[render] bundle ${path.basename(args.bundlePath)}: ${segments.length} đoạn, aspect ${config.aspect}, fps ${config.fps}${args.dryRun ? ' (dry-run)' : ''}`,
  );

  // --bgm (đường dẫn đĩa) đè BGM trong bundle; đọc thành buffer để renderVideo source-agnostic.
  let bgm: { filename: string; data: Buffer } | undefined;
  if (args.bgm) {
    bgm = { filename: path.basename(args.bgm), data: await readFile(args.bgm) };
  } else if (bundle.bgm) {
    bgm = bundle.bgm;
  }

  const input: RenderInput = {
    jobId: scriptManifest.jobId,
    segments,
    config,
    images: bundle.images,
    ...(bundle.audio ? { bundledAudio: bundle.audio } : {}),
    ...(bgm ? { bgm } : {}),
  };

  // Map RenderEvent → log [render] tương đương bản cũ (test:render grep 'cache HIT'/'BGM duck'/'burn-in').
  const fmt = (ev: RenderEvent): string => {
    switch (ev.phase) {
      case 'tts': {
        const label =
          ev.source === 'bundle'
            ? 'audio bundle'
            : ev.source === 'cache'
              ? 'TTS cache HIT'
              : 'TTS synth';
        return `[render] đoạn ${ev.segOrder + 1}: ${label} ${ev.durationSec.toFixed(2)}s`;
      }
      case 'timeline':
        return `[render] timeline ${ev.totalSec.toFixed(2)}s → ${timelinePath}, ${srtPath}`;
      case 'shot':
        return `[render] cảnh ${ev.i}/${ev.n} (đoạn ${ev.segIndex + 1})`;
      case 'concat':
        return '[render] ghép các cảnh';
      case 'audio':
        return '[render] dựng track lời';
      case 'bgm':
        return `[render] BGM duck (${config.bgm.duckDb}dB, volume ${config.bgm.volume})`;
      case 'subs':
        return '[render] phụ đề đã burn-in';
      case 'mux':
        return '[render] đóng gói MP4';
    }
  };

  const res = await renderVideo(input, {
    outPath,
    subsMode,
    dryRun: args.dryRun,
    keep: args.keep,
    onProgress: (ev) => console.log(fmt(ev)),
  });

  if (args.dryRun) {
    console.log('[render] dry-run xong — không gọi TTS/ffmpeg.');
  } else {
    console.log(`[render] XONG → ${res.outPath} (${res.totalSec.toFixed(2)}s)`);
  }
  if (args.keep) {
    console.log(`[render] giữ thư mục làm việc: .render/${scriptManifest.jobId}-${aspectSlug}-${process.pid}`);
  }
}

main().catch((err) => {
  console.error(`[render] LỖI: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
