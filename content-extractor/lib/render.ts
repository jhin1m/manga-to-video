// Orchestration render video DÙNG CHUNG cho CLI (scripts/render-video.mts) và route in-app
// (POST /storyboard/render). Source-agnostic: caller dựng RenderInput từ bundle.zip (CLI)
// hoặc từ store RAM (route) rồi gọi renderVideo — engine ffmpeg/timeline/tts KHÔNG đổi.
// Luồng: TTS per segment (cache đĩa/audio đính kèm) → buildTimeline → Ken Burns per shot →
// concat + audio track + BGM duck + burn subs → MP4 + .srt + timeline.json.
//
// onProgress: phát RenderEvent ở mỗi mốc (tiến trình theo shot i/N cho UI). signal: AbortSignal
// → hủy giữa chừng kill child ffmpeg đang chạy + throw AbortError (caller phân biệt hủy/lỗi).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { assertSafeName } from './bundle';
import {
  abortError,
  assertFfmpeg,
  buildAudioTrack,
  burnSubs,
  concatVideo,
  duckBgm,
  mux,
  probeDurationSec,
  renderShot,
  resolveSubtitleBin,
} from './ffmpeg';
import { defaultFill, kenburns, resolveShotMotion } from './kenburns';
import type { OutputLanguage } from './output-language';
import type { RenderConfig, ScriptManifest } from './schema';
import { buildTimeline, TIMELINE_DEFAULTS, toSrt, toTimelineJson } from './timeline';
import { readTtsConfig, synthSegment } from './tts';

export interface RenderInput {
  jobId: string;
  segments: ScriptManifest['segments']; // = scriptManifest.segments (id, order, narration, shots[])
  config: RenderConfig;
  images: Map<number, Buffer>; // sourceIndex → band bytes
  bundledAudio?: Map<string, Buffer>; // segId → mp3 đã synth (bundle hoặc store) → bỏ qua TTS
  bgm?: { filename: string; data: Buffer };
  outputLanguage?: OutputLanguage; // ngôn ngữ lời kể → chọn giọng TTS; vắng = 'vi'
}

// Event tiến trình engine phát ra — KHÔNG gồm 'done': hoàn tất là việc của caller (CLI in
// "XONG", route gói results.zip rồi ghi dòng done kèm URL tải).
export type RenderEvent =
  | {
      phase: 'tts';
      i: number;
      n: number;
      segOrder: number;
      source: 'bundle' | 'cache' | 'synth';
      durationSec: number;
    }
  | { phase: 'timeline'; totalSec: number }
  | { phase: 'shot'; i: number; n: number; segIndex: number }
  | { phase: 'concat' }
  | { phase: 'audio' }
  | { phase: 'bgm' }
  | { phase: 'subs' }
  | { phase: 'mux' };

export interface RenderOptions {
  outPath: string; // đường dẫn MP4 cuối; .srt/.timeline.json suy từ outBase
  subsMode?: 'srt' | 'burn' | 'both'; // default: config.subtitles.burnIn ? 'both' : 'srt'
  dryRun?: boolean; // chỉ timeline + .srt + .timeline.json, không TTS/ffmpeg
  keep?: boolean; // giữ workDir để debug (mặc định xoá)
  workRoot?: string; // thư mục gốc chứa workDir tạm (default '.render')
  onProgress?: (ev: RenderEvent) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  outPath: string;
  srtPath: string;
  timelinePath: string;
  totalSec: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

// Đường dẫn workDir tạm (bands/shots/audio/track trung gian). Riêng theo aspect+pid: hai render
// khác aspect từ cùng job không đè shot của nhau; TÁCH khỏi thư mục output (route ghi output vào
// .render/<jobId>-<aspect>/, workDir là .render/<jobId>-<aspect>-<pid>/ — thư mục anh em) nên rm
// workDir không quét trúng output. Export để caller (route) dọn khi renderVideo thoát giữa chừng
// (Cancel/lỗi): renderVideo chỉ tự rm ở nhánh thành công. Cùng process → cùng process.pid.
export function renderWorkDir(jobId: string, aspect: string, workRoot = '.render'): string {
  return path.join(workRoot, `${jobId}-${aspect.replace(':', 'x')}-${process.pid}`);
}

export async function renderVideo(input: RenderInput, opts: RenderOptions): Promise<RenderResult> {
  const { config, segments } = input;
  const { onProgress, signal } = opts;
  assertSafeName(input.jobId, 'jobId'); // input.jobId đi vào workDir — chặn ../ ở biên (route + CLI)
  const subsMode = opts.subsMode ?? (config.subtitles.burnIn ? 'both' : 'srt');
  const dryRun = opts.dryRun ?? false;
  const outPath = opts.outPath;
  const outBase = outPath.replace(/\.mp4$/i, '');
  const srtPath = `${outBase}.srt`;
  const timelinePath = `${outBase}.timeline.json`;
  const workDir = renderWorkDir(input.jobId, config.aspect, opts.workRoot ?? '.render');

  // ==== Thời lượng từng segment ====
  // dry-run: durationHint (im lặng, không TTS/ffmpeg). Ngược lại: audio đính kèm (ưu tiên)
  // hoặc synth qua cache đĩa.
  const segDurations: Record<string, number> = {};
  const segAudioPaths = new Map<string, string>();

  if (!dryRun) {
    await assertFfmpeg();
    await mkdir(path.join(workDir, 'audio'), { recursive: true });
    const ttsTotal = segments.filter((s) => s.narration.trim()).length;
    let ttsIdx = 0;
    for (const seg of segments) {
      throwIfAborted(signal);
      const narration = seg.narration.trim();
      if (!narration) {
        segDurations[seg.id] = 0;
        continue;
      }
      ttsIdx++;
      const bundled = input.bundledAudio?.get(seg.id);
      if (bundled) {
        const p = path.join(workDir, 'audio', `seg-${seg.id}.mp3`);
        await writeFile(p, bundled);
        const durationSec = await probeDurationSec(p, signal);
        segDurations[seg.id] = durationSec;
        segAudioPaths.set(seg.id, p);
        onProgress?.({
          phase: 'tts',
          i: ttsIdx,
          n: ttsTotal,
          segOrder: seg.order,
          source: 'bundle',
          durationSec,
        });
      } else {
        const ttsCfg = readTtsConfig({
          provider: config.tts.provider || undefined,
          voiceId: config.tts.voiceId || undefined,
          model: config.tts.model || undefined,
          // Bundle vắng field = kịch bản 'vi' — vẫn áp để giọng catalog sai ngôn ngữ bị đổi, cùng
          // quy tắc với route synth của trang video (không thì preview và render khác giọng).
          lang: input.outputLanguage ?? 'vi',
        });
        const r = await synthSegment(narration, ttsCfg);
        segDurations[seg.id] = r.durationSec;
        if (r.mp3Path) segAudioPaths.set(seg.id, r.mp3Path);
        onProgress?.({
          phase: 'tts',
          i: ttsIdx,
          n: ttsTotal,
          segOrder: seg.order,
          source: r.cached ? 'cache' : 'synth',
          durationSec: r.durationSec,
        });
      }
    }
  }

  // ==== Timeline + srt + timeline.json (luôn xuất) ====
  const timeline = buildTimeline(segments, segDurations, config);
  const srt = toSrt(timeline, segments, config.subtitles);
  await mkdir(path.dirname(path.resolve(srtPath)), { recursive: true });
  await writeFile(srtPath, srt);
  await writeFile(timelinePath, JSON.stringify(toTimelineJson(timeline, segments), null, 2));
  onProgress?.({ phase: 'timeline', totalSec: timeline.totalSec });

  if (dryRun) {
    return { outPath, srtPath, timelinePath, totalSec: timeline.totalSec };
  }

  // ==== Render từng shot (Ken Burns) ====
  throwIfAborted(signal);
  const shotsDir = path.join(workDir, 'shots');
  await mkdir(shotsDir, { recursive: true });
  const bandDims = new Map<number, { w: number; h: number }>();
  const bandPaths = new Map<number, string>();
  for (const [sourceIndex, buffer] of input.images) {
    const p = path.join(workDir, `band-${sourceIndex}.jpg`);
    await writeFile(p, buffer);
    const meta = await sharp(buffer).metadata();
    bandDims.set(sourceIndex, { w: meta.width ?? 0, h: meta.height ?? 0 });
    bandPaths.set(sourceIndex, p);
  }

  // Đếm shot toàn cục (i/N across all segments) để progress bar mượt.
  const totalShots = timeline.segments.reduce((s, tseg) => s + tseg.shots.length, 0);
  let shotIdx = 0;
  const shotFiles: string[] = [];
  for (const [si, tseg] of timeline.segments.entries()) {
    for (const [shotIdxInSeg, shot] of tseg.shots.entries()) {
      throwIfAborted(signal);
      const dims = bandDims.get(shot.sourceIndex)!;
      const durationSec = shot.end - shot.start;
      const filter = kenburns({
        imgW: dims.w,
        imgH: dims.h,
        region: shot.region,
        motion: resolveShotMotion(shot.motion, config.kenburns.motion),
        aspect: config.aspect,
        durationSec,
        fps: config.fps,
        zoom: config.kenburns.zoom,
        fill: config.kenburns.fill ?? defaultFill(config.aspect),
      });
      const outFile = path.join(shotsDir, `shot-${String(si).padStart(3, '0')}-${shotIdxInSeg}.mp4`);
      await renderShot({
        image: bandPaths.get(shot.sourceIndex)!,
        filter,
        durationSec,
        fps: config.fps,
        out: outFile,
        signal,
      });
      shotFiles.push(outFile);
      shotIdx++;
      onProgress?.({ phase: 'shot', i: shotIdx, n: totalShots, segIndex: si });
    }
  }

  // ==== Ghép cuối: concat → audio track → BGM duck → burn subs → mux ====
  const silentPath = path.join(workDir, 'silent.mp4');
  onProgress?.({ phase: 'concat' });
  await concatVideo(shotFiles, silentPath, signal);

  // Narration đặt sau padHead của segment — khớp buildTimeline.
  const narrationPath = path.join(workDir, 'narration.wav');
  onProgress?.({ phase: 'audio' });
  await buildAudioTrack(
    timeline.segments
      .filter((tseg) => segAudioPaths.has(tseg.segId))
      .map((tseg) => ({
        path: segAudioPaths.get(tseg.segId)!,
        startSec: tseg.start + TIMELINE_DEFAULTS.padHeadSec,
      })),
    timeline.totalSec,
    narrationPath,
    signal,
  );

  let audioPath = narrationPath;
  if (input.bgm) {
    // filename sanitize để không thoát workDir (route đã lọc, CLI dùng basename — lọc thêm lần nữa vô hại).
    const bgmName = input.bgm.filename.replace(/[^\w.\-]/g, '_') || 'bgm.mp3';
    const bgmPath = path.join(workDir, bgmName);
    await writeFile(bgmPath, input.bgm.data);
    const mixedPath = path.join(workDir, 'mixed.wav');
    onProgress?.({ phase: 'bgm' });
    await duckBgm(narrationPath, bgmPath, config.bgm, timeline.totalSec, mixedPath, signal);
    audioPath = mixedPath;
  }

  // .srt rời LUÔN được giữ (kể cả mode burn) — hợp đồng "luôn xuất .srt".
  let videoPath = silentPath;
  if (subsMode === 'burn' || subsMode === 'both') {
    // Binary riêng cho burn: bản chính thiếu libass thì tự rơi xuống bundled (ffmpeg-static).
    const subBin = await resolveSubtitleBin();
    if (subBin) {
      const burnedPath = path.join(workDir, 'burned.mp4');
      onProgress?.({ phase: 'subs' });
      await burnSubs({
        bin: subBin,
        video: silentPath,
        srtPath,
        style: config.subtitles,
        out: burnedPath,
        signal,
      });
      videoPath = burnedPath;
    } else {
      console.warn(
        '[render] CẢNH BÁO: không nguồn ffmpeg nào (PATH lẫn bundled) có filter subtitles (libass) — bỏ qua burn-in, dùng .srt rời. Cài bản đầy đủ: brew install ffmpeg (bottle chính thức có libass).',
      );
    }
  }

  onProgress?.({ phase: 'mux' });
  await mux(videoPath, audioPath, outPath, signal);

  if (!opts.keep) {
    await rm(workDir, { recursive: true, force: true });
  }

  return { outPath, srtPath, timelinePath, totalSec: timeline.totalSec };
}
