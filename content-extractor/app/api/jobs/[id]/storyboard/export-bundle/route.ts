import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { writeBundle } from '@/lib/bundle';
import type { RenderConfig } from '@/lib/schema';
import { defaultRenderConfig, toScriptManifest } from '@/lib/schema';
import { getSegmentAudio, getStoryboard, getWorkingImage } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Export bundle.zip = ScriptManifest + band images + render-config (+ audio đã synth + BGM).
// GET: config qua query ?config=<json> (không BGM). POST multipart: field config + file bgm
// (Preview UI dùng POST để đính BGM blob). Bundle là hand-off self-contained cho CLI.

function buildBundle(id: string, config: RenderConfig, bgm?: { filename: string; data: Buffer }) {
  const state = getStoryboard(id);
  if (!state) return { error: 'Chưa có storyboard cho job này', status: 404 } as const;
  if (!state.script || state.script.length === 0) {
    return { error: 'Chưa có kịch bản cho job này', status: 404 } as const;
  }

  const scriptManifest = toScriptManifest({
    jobId: state.jobId,
    createdAt: state.createdAt,
    segments: state.script,
  });

  // Ảnh band: mọi sourceIndex mà shots tham chiếu.
  const images = new Map<number, Buffer>();
  for (const seg of scriptManifest.segments) {
    for (const shot of seg.shots) {
      if (images.has(shot.sourceIndex)) continue;
      const working = getWorkingImage(id, shot.sourceIndex);
      if (!working) {
        return {
          error: `Không tìm thấy ảnh nguồn cho band ${shot.sourceIndex}`,
          status: 400,
        } as const;
      }
      images.set(shot.sourceIndex, working.buffer);
    }
  }
  return { scriptManifest, images, config, bgm } as const;
}

// Audio cache đã synth cho từng đoạn — chỉ đính khi narration chưa đổi so với lúc synth
// (người dùng sửa narration sau khi synth → audio cũ bị loại, CLI tự synth lại).
async function collectAudio(
  id: string,
  scriptManifest: ReturnType<typeof toScriptManifest>,
): Promise<Map<string, Buffer> | undefined> {
  const state = getStoryboard(id);
  if (!state?.ttsAudio || state.ttsAudio.size === 0) return undefined;
  const audio = new Map<string, Buffer>();
  for (const seg of scriptManifest.segments) {
    const stored = getSegmentAudio(id, seg.id);
    if (!stored || stored.text !== seg.narration.trim()) continue;
    try {
      audio.set(seg.id, await readFile(stored.mp3Path));
    } catch {
      // file cache mất → bỏ, CLI synth lại
    }
  }
  return audio.size > 0 ? audio : undefined;
}

function parseConfig(raw: unknown): RenderConfig {
  if (typeof raw !== 'object' || raw === null) return defaultRenderConfig();
  // Merge nông trên default — thiếu field nào lấy default field đó; aspect/fps validate
  // cứng để CLI không chết giữa chừng vì config rác (frameSize không nhận aspect lạ).
  const d = defaultRenderConfig();
  const r = raw as Partial<RenderConfig>;
  const fps = Number(r.fps);
  return {
    ...d,
    ...r,
    version: d.version,
    aspect: r.aspect === '16:9' || r.aspect === '1:1' || r.aspect === '9:16' ? r.aspect : d.aspect,
    fps: Number.isFinite(fps) && fps >= 1 && fps <= 120 ? Math.round(fps) : d.fps,
    subtitles: { ...d.subtitles, ...(r.subtitles ?? {}) },
    bgm: { ...d.bgm, ...(r.bgm ?? {}) },
    tts: { ...d.tts, ...(r.tts ?? {}) },
    kenburns: { ...d.kenburns, ...(r.kenburns ?? {}) },
  };
}

function zipResponse(id: string, zip: Buffer): Response {
  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="bundle-${id}.zip"`,
    },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let config = defaultRenderConfig();
  const rawConfig = new URL(req.url).searchParams.get('config');
  if (rawConfig) {
    try {
      config = parseConfig(JSON.parse(rawConfig));
    } catch {
      return NextResponse.json({ error: 'Query config không phải JSON hợp lệ' }, { status: 400 });
    }
  }
  const built = buildBundle(id, config);
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: built.status });
  const audio = await collectAudio(id, built.scriptManifest);
  return zipResponse(id, writeBundle({ ...built, audio }));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let config = defaultRenderConfig();
  let bgm: { filename: string; data: Buffer } | undefined;
  try {
    const form = await req.formData();
    const rawConfig = form.get('config');
    if (typeof rawConfig === 'string') config = parseConfig(JSON.parse(rawConfig));
    const bgmFile = form.get('bgm');
    if (bgmFile instanceof File && bgmFile.size > 0) {
      bgm = {
        filename: bgmFile.name.replace(/[^\w.\-]/g, '_') || 'bgm.mp3',
        data: Buffer.from(await bgmFile.arrayBuffer()),
      };
    }
  } catch {
    return NextResponse.json(
      { error: 'Body phải là multipart form-data (config JSON + file bgm tuỳ chọn)' },
      { status: 400 },
    );
  }
  const built = buildBundle(id, config, bgm);
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: built.status });
  const audio = await collectAudio(id, built.scriptManifest);
  return zipResponse(id, writeBundle({ ...built, audio }));
}
