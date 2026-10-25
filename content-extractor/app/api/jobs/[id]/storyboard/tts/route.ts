import { NextResponse } from 'next/server';
import pLimit from 'p-limit';
import { getJob } from '@/lib/jobs';
import { readTtsConfig, synthSegment } from '@/lib/tts';
import { getScript, getStoryboard, setSegmentAudio } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Synth TTS cho các đoạn kịch bản (preview "có audio"). Body: { segIds?, voiceId?, model? }
// — bỏ segIds = synth mọi đoạn có narration. Lỗi cô lập từng đoạn (mẫu composeStoryboard);
// cache đĩa của lib/tts đảm bảo cùng text+voice+model không gọi API lần 2.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  const script = getScript(id);
  if (!state || !script) {
    return NextResponse.json(
      { error: state ? 'Chưa có kịch bản cho job này' : 'Chưa có storyboard cho job này' },
      { status: 404 },
    );
  }

  let segIds: string[] | undefined;
  let provider: string | undefined;
  let voiceId: string | undefined;
  let model: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      segIds?: unknown;
      provider?: unknown;
      voiceId?: unknown;
      model?: unknown;
    };
    if (body.segIds !== undefined) {
      if (!Array.isArray(body.segIds) || !body.segIds.every((s) => typeof s === 'string')) {
        return NextResponse.json({ error: 'segIds phải là mảng chuỗi' }, { status: 400 });
      }
      segIds = body.segIds;
    }
    if (typeof body.provider === 'string' && body.provider) provider = body.provider;
    if (typeof body.voiceId === 'string' && body.voiceId) voiceId = body.voiceId;
    if (typeof body.model === 'string' && body.model) model = body.model;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }

  let cfg;
  try {
    // Giọng theo ngôn ngữ lời kể của job (job vắng — vd sau restart — thì không ràng buộc).
    cfg = readTtsConfig({ provider, voiceId, model, lang: getJob(id)?.outputLanguage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cấu hình TTS không hợp lệ';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const targets = script.filter((seg) => (segIds ? segIds.includes(seg.id) : true));
  const limit = pLimit(2);
  const results = await Promise.all(
    targets.map((seg) =>
      limit(async () => {
        // Chốt text TRƯỚC await: người dùng PATCH narration trong lúc synth thì audio này
        // gắn với text cũ → export-bundle so text tự loại, không ship audio lệch lời.
        const text = seg.narration.trim();
        try {
          const r = await synthSegment(text, cfg);
          if (r.durationSec > 0) {
            setSegmentAudio(id, seg.id, {
              mp3Path: r.mp3Path,
              durationSec: r.durationSec,
              text,
            });
          }
          return {
            segId: seg.id,
            durationSec: r.durationSec,
            cached: r.cached,
            audioUrl:
              r.durationSec > 0 ? `/api/jobs/${id}/storyboard/tts/${seg.id}/audio` : null,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Synth thất bại';
          return { segId: seg.id, durationSec: 0, cached: false, audioUrl: null, error: message };
        }
      }),
    ),
  );

  return NextResponse.json({ results });
}
