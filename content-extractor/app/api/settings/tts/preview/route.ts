import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { isCrossSiteRequest } from '@/lib/settings';
import { getOutputLanguage } from '@/lib/output-language';
import { TTS_PREVIEW_SAMPLE, readTtsConfig, synthSegment } from '@/lib/tts';
import { catalogVoices } from '@/lib/tts-providers/catalog';

export const runtime = 'nodejs';

// Nút "Nghe thử" trong Settings: synth MỘT câu mẫu hằng số rồi trả thẳng mp3.
// Body: { provider, voiceId, model, apiKey? } (cấu hình DRAFT chưa lưu).
//
// Đi qua synthSegment nên dùng chung CACHE ĐĨA với pipeline: nghe thử cùng một giọng lần
// thứ hai không tốn thêm tiền.

export async function POST(req: Request) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: 'Từ chối request cross-site' }, { status: 403 });
  }
  let body: { provider?: unknown; voiceId?: unknown; model?: unknown; apiKey?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const draftKey = str(body.apiKey);
  let cfg;
  try {
    // readTtsConfig ném khi id provider lạ — đó là lỗi CỦA REQUEST (400), không phải lỗi
    // của nhà cung cấp (502). Tách ra để UI hiện đúng nguyên nhân.
    cfg = readTtsConfig({
      provider: str(body.provider) || undefined,
      voiceId: str(body.voiceId) || undefined,
      model: str(body.model) || undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cấu hình TTS không hợp lệ' },
      { status: 400 },
    );
  }
  // Câu mẫu theo ngôn ngữ của giọng (catalog) — giọng en đọc câu Việt nghe vô nghĩa. Giọng
  // không rõ ngôn ngữ (ElevenLabs, ENV tự đặt) dùng câu vi cũ → cache nghe thử cũ còn HIT.
  const voiceLang = catalogVoices(cfg.provider ?? '')?.find((v) => v.id === cfg.voiceId)?.lang;
  const sample = voiceLang ? getOutputLanguage(voiceLang).previewSample : TTS_PREVIEW_SAMPLE;
  try {
    const { mp3Path } = await synthSegment(sample, {
      ...cfg,
      // Key vừa gõ (chưa Lưu) thắng; chuỗi mask không phải key nên bỏ qua.
      ...(draftKey && !draftKey.startsWith('•') ? { apiKey: draftKey } : {}),
    });
    const data = await readFile(mp3Path);
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    // Thông điệp lỗi của provider (sai key, giọng không tồn tại) không chứa key đã gửi.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Không nghe thử được' },
      { status: 502 },
    );
  }
}
