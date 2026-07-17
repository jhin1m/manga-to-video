// CLI render video từ bundle.zip (nguồn chân lý — Preview UI chỉ là xấp xỉ).
// Cách chạy (Node 24, cần ffmpeg: brew install ffmpeg):
//   npm run render -- bundle.zip --aspect 9:16 --out out.mp4
//   npm run render -- bundle.zip --dry-run            # chỉ timeline.json + .srt, không TTS/ffmpeg
// Flags: --aspect 9:16|16:9|1:1 · --fps N · --out path.mp4 · --bgm path · --subs srt|burn|both
//        --dry-run · --keep (giữ thư mục .render/<jobId>/ để debug)
// Luồng: readBundle → TTS per segment (cache đĩa/audio trong bundle) → buildTimeline
// → Ken Burns per shot → concat + audio track + BGM duck + burn subs → MP4 + .srt + timeline.json
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readBundle } from '../lib/bundle';
import {
  assertFfmpeg,
  buildAudioTrack,
  burnSubs,
  concatVideo,
  duckBgm,
  hasFilter,
  mux,
  probeDurationSec,
  renderShot,
} from '../lib/ffmpeg';
import { kenburns } from '../lib/kenburns';
import type { Aspect, RenderConfig } from '../lib/schema';
import { buildTimeline, TIMELINE_DEFAULTS, toSrt, toTimelineJson } from '../lib/timeline';
import { readTtsConfig, synthSegment } from '../lib/tts';

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
  const segments = scriptManifest.segments;

  console.log(
    `[render] bundle ${path.basename(args.bundlePath)}: ${segments.length} đoạn, aspect ${config.aspect}, fps ${config.fps}${args.dryRun ? ' (dry-run)' : ''}`,
  );

  // ==== Thời lượng từng segment ====
  // dry-run: durationHint (im lặng, không TTS, không ffmpeg). Ngược lại: audio trong bundle
  // (ưu tiên) hoặc synth qua cache đĩa.
  // workDir riêng theo aspect+pid: render 9:16 và 16:9 song song từ cùng bundle không đè
  // shot của nhau, và rm cuối không quét trúng run kia. (jobId đã được readBundle chặn
  // ký tự đường dẫn nguy hiểm.)
  const workDir = path.join('.render', `${scriptManifest.jobId}-${aspectSlug}-${process.pid}`);
  const segDurations: Record<string, number> = {};
  const segAudioPaths = new Map<string, string>();

  if (!args.dryRun) {
    await assertFfmpeg();
    await mkdir(path.join(workDir, 'audio'), { recursive: true });
    for (const seg of segments) {
      const narration = seg.narration.trim();
      if (!narration) {
        segDurations[seg.id] = 0;
        continue;
      }
      const bundled = bundle.audio?.get(seg.id);
      if (bundled) {
        const p = path.join(workDir, 'audio', `seg-${seg.id}.mp3`);
        await writeFile(p, bundled);
        segDurations[seg.id] = await probeDurationSec(p);
        segAudioPaths.set(seg.id, p);
        console.log(`[render] đoạn ${seg.order + 1}: audio bundle ${segDurations[seg.id].toFixed(2)}s`);
      } else {
        const ttsCfg = readTtsConfig({
          provider: config.tts.provider || undefined,
          voiceId: config.tts.voiceId || undefined,
          model: config.tts.model || undefined,
        });
        const r = await synthSegment(narration, ttsCfg);
        segDurations[seg.id] = r.durationSec;
        if (r.mp3Path) segAudioPaths.set(seg.id, r.mp3Path);
        console.log(
          `[render] đoạn ${seg.order + 1}: TTS ${r.cached ? 'cache HIT' : 'synth'} ${r.durationSec.toFixed(2)}s`,
        );
      }
    }
  }

  // ==== Timeline + srt + timeline.json (luôn xuất) ====
  const timeline = buildTimeline(segments, segDurations, config);
  const srt = toSrt(timeline, segments);
  const srtPath = `${outBase}.srt`;
  const timelinePath = `${outBase}.timeline.json`;
  await mkdir(path.dirname(path.resolve(srtPath)), { recursive: true });
  await writeFile(srtPath, srt);
  await writeFile(timelinePath, JSON.stringify(toTimelineJson(timeline, segments), null, 2));
  console.log(`[render] timeline ${timeline.totalSec.toFixed(2)}s → ${timelinePath}, ${srtPath}`);

  if (args.dryRun) {
    console.log('[render] dry-run xong — không gọi TTS/ffmpeg.');
    return;
  }

  // ==== Render từng shot (Ken Burns) ====
  const shotsDir = path.join(workDir, 'shots');
  await mkdir(shotsDir, { recursive: true });
  const bandDims = new Map<number, { w: number; h: number }>();
  const bandPaths = new Map<number, string>();
  for (const [sourceIndex, buffer] of bundle.images) {
    const p = path.join(workDir, `band-${sourceIndex}.jpg`);
    await writeFile(p, buffer);
    const meta = await sharp(buffer).metadata();
    bandDims.set(sourceIndex, { w: meta.width ?? 0, h: meta.height ?? 0 });
    bandPaths.set(sourceIndex, p);
  }

  const shotFiles: string[] = [];
  for (const [si, tseg] of timeline.segments.entries()) {
    for (const [shotIdx, shot] of tseg.shots.entries()) {
      const dims = bandDims.get(shot.sourceIndex)!;
      const durationSec = shot.end - shot.start;
      const filter = kenburns({
        imgW: dims.w,
        imgH: dims.h,
        region: shot.region,
        aspect: config.aspect,
        durationSec,
        fps: config.fps,
        zoom: config.kenburns.zoom,
      });
      const outFile = path.join(shotsDir, `shot-${String(si).padStart(3, '0')}-${shotIdx}.mp4`);
      await renderShot({
        image: bandPaths.get(shot.sourceIndex)!,
        filter,
        durationSec,
        fps: config.fps,
        out: outFile,
      });
      shotFiles.push(outFile);
    }
    console.log(`[render] đoạn ${si + 1}/${timeline.segments.length}: ${tseg.shots.length} shot xong`);
  }

  // ==== Ghép cuối: concat → audio track → BGM duck → burn subs → mux ====
  const silentPath = path.join(workDir, 'silent.mp4');
  await concatVideo(shotFiles, silentPath);

  // Narration đặt sau padHead của segment — khớp buildTimeline.
  const narrationPath = path.join(workDir, 'narration.wav');
  await buildAudioTrack(
    timeline.segments
      .filter((tseg) => segAudioPaths.has(tseg.segId))
      .map((tseg) => ({
        path: segAudioPaths.get(tseg.segId)!,
        startSec: tseg.start + TIMELINE_DEFAULTS.padHeadSec,
      })),
    timeline.totalSec,
    narrationPath,
  );

  let audioPath = narrationPath;
  const bgmPath =
    args.bgm ??
    (bundle.bgm
      ? await (async () => {
          const p = path.join(workDir, bundle.bgm!.filename);
          await writeFile(p, bundle.bgm!.data);
          return p;
        })()
      : null);
  if (bgmPath) {
    const mixedPath = path.join(workDir, 'mixed.wav');
    await duckBgm(narrationPath, bgmPath, config.bgm, timeline.totalSec, mixedPath);
    audioPath = mixedPath;
    console.log(`[render] BGM duck (${config.bgm.duckDb}dB, volume ${config.bgm.volume})`);
  }

  // .srt rời LUÔN được giữ (kể cả mode burn) — hợp đồng "luôn xuất .srt".
  let videoPath = silentPath;
  if (subsMode === 'burn' || subsMode === 'both') {
    if (await hasFilter('subtitles')) {
      const burnedPath = path.join(workDir, 'burned.mp4');
      await burnSubs(silentPath, srtPath, config.subtitles, burnedPath);
      videoPath = burnedPath;
      console.log('[render] phụ đề đã burn-in');
    } else {
      console.warn(
        '[render] CẢNH BÁO: bản ffmpeg này thiếu filter subtitles (libass) — bỏ qua burn-in, dùng .srt rời. Cài bản đầy đủ: brew install ffmpeg (bottle chính thức có libass).',
      );
    }
  }

  await mux(videoPath, audioPath, outPath);
  console.log(`[render] XONG → ${outPath} (${timeline.totalSec.toFixed(2)}s)`);

  if (!args.keep) {
    await rm(workDir, { recursive: true, force: true });
  } else {
    console.log(`[render] giữ thư mục làm việc: ${workDir}`);
  }
}

main().catch((err) => {
  console.error(`[render] LỖI: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
