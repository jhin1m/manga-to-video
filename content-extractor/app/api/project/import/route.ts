import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { createJob, setItemError, setItemResult, updateProgress } from '@/lib/jobs';
import { readProject } from '@/lib/project';
import {
  createStoryboard,
  getStoryboard,
  setScript,
  setScriptConfirmed,
  setSegmentAudio,
  updateStoryboardProgress,
  type StoredBeat,
  type WorkingImage,
} from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Mở project .mtvproj: hydrate Job + Storyboard + Script + Audio vào store in-memory.
// KHÔNG re-ingest (ảnh working embed sẵn trong file) → không phụ thuộc env, toạ độ
// region khớp tuyệt đối với phiên đã lưu. Trả { jobId, stage } để client điều hướng.
export async function POST(req: Request) {
  let file: File;
  try {
    const form = await req.formData();
    const field = form.get('file');
    if (!(field instanceof File)) {
      return NextResponse.json({ error: 'Thiếu file .mtvproj' }, { status: 400 });
    }
    file = field;
  } catch {
    return NextResponse.json(
      { error: 'Body phải là multipart form-data với field file' },
      { status: 400 },
    );
  }

  let data: ReturnType<typeof readProject>;
  try {
    data = readProject(Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không đọc được file project';
    return NextResponse.json({ error: `File project không hợp lệ: ${message}` }, { status: 400 });
  }
  const { project, manifest, storyboard, script } = data;

  // ==== Job Stage 1: band + content từ manifest (không chạy lại vision) ====
  const sortedItems = [...project.items].sort((a, b) => a.index - b.index);
  const job = createJob(
    sortedItems.map((meta) => {
      const m = manifest.items.find((x) => x.index === meta.index)!;
      return {
        filename: m.filename,
        buffer: data.items.get(meta.index)!,
        mime: meta.mime,
        width: meta.width,
        height: meta.height,
      };
    }),
    project.context ?? '', // .mtvproj cũ không có field → job context rỗng như trước
  );
  let processed = 0;
  for (const m of manifest.items) {
    if (m.content) {
      setItemResult(job.id, m.index, m.content);
      processed++;
    } else if (m.error) {
      setItemError(job.id, m.index, m.error);
      processed++;
    }
  }
  // Có kết quả Stage 1 → 'done' (bảng kết quả); chưa chạy vision → 'ready' (lưới xem trước).
  updateProgress(job.id, { phase: processed > 0 ? 'done' : 'ready', currentIndex: null });

  // ==== Storyboard: working embed + beats từ manifest ====
  const working: WorkingImage[] = project.working.map((w) => ({
    sourceIndex: w.sourceIndex,
    buffer: data.working.get(w.sourceIndex)!,
    width: w.width,
    height: w.height,
    // pages: working ↔ band 1:1 → content Stage 1 dùng lại cho narration template/Generate.
    ...(project.sourceKind === 'pages'
      ? { content: manifest.items.find((m) => m.index === w.sourceIndex)?.content ?? null }
      : {}),
  }));
  const beats: StoredBeat[] = [...storyboard.beats]
    .sort((a, b) => a.order - b.order)
    .map((b, i) => ({
      ...b,
      order: i,
      status: b.narration ? 'done' : b.error ? 'error' : 'pending',
      rev: 0,
    }));
  createStoryboard({ jobId: job.id, sourceKind: project.sourceKind, working, beats });
  const state = getStoryboard(job.id)!;
  state.createdAt = project.createdAt; // giữ vết thời gian phiên gốc
  updateStoryboardProgress(job.id, {
    phase: 'done',
    done: beats.filter((b) => b.status !== 'pending').length,
    total: beats.length,
    currentIndex: null,
  });

  // ==== Script + audio (setScript reset ttsAudio → audio phải hydrate SAU) ====
  if (script && script.segments.length > 0) {
    setScript(job.id, script.segments);
    setScriptConfirmed(job.id, project.scriptConfirmed === true);
    if (data.audio && project.audio) {
      const cacheDir = process.env.TTS_CACHE_DIR || path.join('.cache', 'tts');
      await mkdir(cacheDir, { recursive: true });
      for (const [segId, buffer] of data.audio) {
        const meta = project.audio[segId];
        if (!meta || !script.segments.some((s) => s.id === segId)) continue;
        // Ghi lại đúng <cacheDir>/<key>.mp3 (+ meta durationSec) — synth cùng text/voice/model
        // sau này HIT cache, không gọi lại ElevenLabs.
        const mp3Path = path.join(cacheDir, `${meta.key}.mp3`);
        await writeFile(mp3Path, buffer);
        await writeFile(
          path.join(cacheDir, `${meta.key}.json`),
          JSON.stringify({ durationSec: meta.durationSec }),
        );
        setSegmentAudio(job.id, segId, {
          mp3Path,
          durationSec: meta.durationSec,
          text: meta.text,
        });
      }
    }
  }

  const stage =
    script && script.segments.length > 0
      ? project.scriptConfirmed === true
        ? 'video'
        : 'script'
      : 'storyboard';
  return NextResponse.json({ jobId: job.id, stage });
}
