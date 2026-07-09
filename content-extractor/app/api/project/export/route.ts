import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';
import { writeProject } from '@/lib/project';
import { getStoryboard, toBeat } from '@/lib/storyboard-store';
import type { ProjectAudioMeta, ProjectFile } from '@/lib/schema';
import { PROJECT_VERSION, toManifest, toScriptManifest, toStoryboardManifest } from '@/lib/schema';

export const runtime = 'nodejs';

// Lưu cả phiên làm việc thành 1 file .mtvproj (zip): Job Stage 1 + Storyboard + Script
// + audio TTS đã synth. Cần có storyboard (bản lưu có nghĩa từ Stage 1.5 trở đi —
// Stage 1 thuần vẫn có Export JSON riêng).
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'Thiếu tham số jobId' }, { status: 400 });
  }
  const state = getStoryboard(jobId);
  if (!state) {
    return NextResponse.json(
      { error: 'Chưa có storyboard để lưu — hãy tạo storyboard trước.' },
      { status: 404 },
    );
  }
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }

  const working = new Map<number, Buffer>();
  for (const w of state.working) working.set(w.sourceIndex, w.buffer);
  const items = new Map<number, Buffer>();
  for (const it of job.items) items.set(it.index, it.buffer);

  // Audio đã synth: đọc bytes từ cache đĩa; file đã bị dọn thì bỏ qua (mềm) — mở lại
  // project chỉ mất cache audio đó, preview/CLI synth lại được.
  const audio = new Map<string, Buffer>();
  const audioMeta: Record<string, ProjectAudioMeta> = {};
  if (state.ttsAudio) {
    for (const [segId, stored] of state.ttsAudio) {
      if (!stored.mp3Path) continue;
      try {
        const buffer = await readFile(stored.mp3Path);
        audio.set(segId, buffer);
        audioMeta[segId] = {
          key: path.basename(stored.mp3Path, '.mp3'),
          durationSec: stored.durationSec,
          text: stored.text,
        };
      } catch {
        // cache đã bị dọn — bỏ qua
      }
    }
  }

  const hasScript = state.script !== undefined && state.script.length > 0;
  const project: ProjectFile = {
    version: PROJECT_VERSION,
    jobId: state.jobId,
    createdAt: state.createdAt,
    sourceKind: state.sourceKind,
    working: state.working.map((w) => ({
      sourceIndex: w.sourceIndex,
      width: w.width,
      height: w.height,
    })),
    items: job.items.map((it) => ({
      index: it.index,
      mime: it.mime,
      width: it.width,
      height: it.height,
    })),
    ...(hasScript ? { scriptConfirmed: state.scriptConfirmed === true } : {}),
    ...(audio.size > 0 ? { audio: audioMeta } : {}),
  };

  const zip = writeProject({
    project,
    manifest: toManifest(job),
    storyboard: toStoryboardManifest({
      jobId: state.jobId,
      createdAt: state.createdAt,
      sourceKind: state.sourceKind,
      beats: state.beats.map(toBeat),
    }),
    ...(hasScript
      ? {
          script: toScriptManifest({
            jobId: state.jobId,
            createdAt: state.createdAt,
            segments: state.script!,
          }),
        }
      : {}),
    working,
    items,
    ...(audio.size > 0 ? { audio } : {}),
  });

  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="project-${jobId}.mtvproj"`,
    },
  });
}
