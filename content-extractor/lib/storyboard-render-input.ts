import { readFile } from 'node:fs/promises';
import { getJob } from './jobs';
import type { RenderConfig } from './schema';
import { defaultRenderConfig, toScriptManifest } from './schema';
import { migrateSubtitleStyle } from './subtitle-style';
import { getSegmentAudio, getStoryboard, getWorkingImage } from './storyboard-store';

// Đọc store RAM → dữ liệu render, DÙNG CHUNG cho export-bundle (gói zip hand-off cho CLI) và
// route render in-app (dựng RenderInput cho lib/render.ts). Trích ra đây để hai route không
// nhân đôi logic đọc storyboard/script/band/audio.

export function buildBundle(id: string, config: RenderConfig, bgm?: { filename: string; data: Buffer }) {
  const state = getStoryboard(id);
  if (!state) return { error: 'Chưa có storyboard cho job này', status: 404 } as const;
  if (!state.script || state.script.length === 0) {
    return { error: 'Chưa có kịch bản cho job này', status: 404 } as const;
  }

  const scriptManifest = toScriptManifest({
    jobId: state.jobId,
    createdAt: state.createdAt,
    segments: state.script,
    // Ngôn ngữ đi theo kịch bản vào bundle → CLI render chọn đúng giọng TTS (readTtsConfig).
    outputLanguage: getJob(id)?.outputLanguage,
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
// (người dùng sửa narration sau khi synth → audio cũ bị loại, engine tự synth lại).
export async function collectAudio(
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
      // file cache mất → bỏ, engine synth lại
    }
  }
  return audio.size > 0 ? audio : undefined;
}

export function parseConfig(raw: unknown): RenderConfig {
  if (typeof raw !== 'object' || raw === null) return defaultRenderConfig();
  // Merge nông trên default — thiếu field nào lấy default field đó; aspect/fps validate
  // cứng để engine không chết giữa chừng vì config rác (frameSize không nhận aspect lạ).
  const d = defaultRenderConfig();
  const r = raw as Partial<RenderConfig>;
  const fps = Number(r.fps);
  return {
    ...d,
    ...r,
    version: d.version,
    aspect: r.aspect === '16:9' || r.aspect === '1:1' || r.aspect === '9:16' ? r.aspect : d.aspect,
    fps: Number.isFinite(fps) && fps >= 1 && fps <= 120 ? Math.round(fps) : d.fps,
    // Style phụ đề đi qua migrate + clamp riêng: nguồn có thể là bundle.zip v1 của máy khác.
    subtitles: migrateSubtitleStyle(r.subtitles),
    bgm: { ...d.bgm, ...(r.bgm ?? {}) },
    tts: { ...d.tts, ...(r.tts ?? {}) },
    kenburns: { ...d.kenburns, ...(r.kenburns ?? {}) },
  };
}

// Parse multipart form (config JSON + file bgm tuỳ chọn) — chung cho export-bundle POST và
// render POST. Ném lỗi khi form/JSON hỏng → caller bắt và trả 400.
export async function parseRenderForm(
  req: Request,
): Promise<{ config: RenderConfig; bgm?: { filename: string; data: Buffer } }> {
  const form = await req.formData();
  const rawConfig = form.get('config');
  const config = typeof rawConfig === 'string' ? parseConfig(JSON.parse(rawConfig)) : defaultRenderConfig();
  let bgm: { filename: string; data: Buffer } | undefined;
  const bgmFile = form.get('bgm');
  if (bgmFile instanceof File && bgmFile.size > 0) {
    bgm = {
      filename: bgmFile.name.replace(/[^\w.\-]/g, '_') || 'bgm.mp3',
      data: Buffer.from(await bgmFile.arrayBuffer()),
    };
  }
  return { config, bgm };
}
