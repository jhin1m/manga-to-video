import { NextResponse } from 'next/server';
import { isCrossSiteRequest } from '@/lib/settings';
import { readTtsConfig } from '@/lib/tts';
import { DEFAULT_PROVIDER_ID, getTtsProvider } from '@/lib/tts-providers';

export const runtime = 'nodejs';

// Danh sách giọng cho dropdown TTS trong Settings — thay ô gõ voice ID bằng tay.
// Body: { provider, apiKey? } (cấu hình DRAFT chưa lưu; apiKey null = key đã lưu / ENV).
//
// Provider có catalog tĩnh (CapCut) trả thẳng, không chạm mạng. Provider có giọng theo tài
// khoản (ElevenLabs) hỏi API. Route chỉ NHẬN key, không bao giờ trả.

export async function POST(req: Request) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: 'Từ chối request cross-site' }, { status: 403 });
  }
  let body: { provider?: unknown; apiKey?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }

  const providerId = typeof body.provider === 'string' ? body.provider.trim() : '';
  let provider;
  try {
    provider = getTtsProvider(providerId || DEFAULT_PROVIDER_ID);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Provider TTS không hợp lệ' },
      { status: 400 },
    );
  }

  // Catalog tĩnh không cần key và không cần mạng.
  if (!provider.listVoices) {
    return NextResponse.json({ voices: provider.voices ?? [] });
  }

  const draftKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const cfg = readTtsConfig({ provider: provider.id });
  try {
    const voices = await provider.listVoices({
      ...cfg,
      ...(draftKey && !draftKey.startsWith('•') ? { apiKey: draftKey } : {}),
    });
    return NextResponse.json({ voices });
  } catch (err) {
    // Sai key/offline → UI LÙI về ô nhập voiceId tự do, không bị chặn.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Không lấy được danh sách giọng' },
      { status: 502 },
    );
  }
}
