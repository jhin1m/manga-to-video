import { NextResponse } from 'next/server';
import { PROVIDER_PRESETS, type AiProviderId } from '@/lib/ai-providers';
import { testProviderConnection } from '@/lib/ai-probe';
import { isCrossSiteRequest, resolveProbeApiKey, resolveProbeBaseURL } from '@/lib/settings';

// Nút "Kiểm tra" trong Settings: gửi 1 request bé nhất (max_tokens=1, stage vision kèm ảnh
// 1×1px) để người dùng biết NGAY là sai key hay sai model, thay vì phát hiện sau 3 phút
// chạy pipeline. Chi phí xấp xỉ 0.
//
// Body: { stage, provider, baseURL?, model, apiKey? } — cấu hình DRAFT chưa lưu.

export async function POST(req: Request) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: 'Từ chối request cross-site' }, { status: 403 });
  }
  let body: {
    stage?: unknown;
    provider?: unknown;
    baseURL?: unknown;
    model?: unknown;
    apiKey?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }

  // KHÔNG dùng getPreset ở đây: nó rơi về preset đầu (openai) với id lạ, tức là âm thầm
  // probe OpenAI bằng OPENAI_API_KEY trong khi người dùng hỏi về nhà cung cấp khác.
  const provider = PROVIDER_PRESETS.find((p) => p.id === body.provider)?.id as AiProviderId | undefined;
  if (!provider) {
    return NextResponse.json({ error: 'Nhà cung cấp không hợp lệ' }, { status: 400 });
  }
  const baseURL = resolveProbeBaseURL(provider, body.baseURL);
  if (!baseURL) {
    return NextResponse.json({ error: 'Thiếu baseURL cho nhà cung cấp tùy chỉnh' }, { status: 400 });
  }
  const stage = body.stage === 'script' ? 'script' : 'vision';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!model) {
    return NextResponse.json({ ok: false, message: 'Chưa chọn model để kiểm tra.' });
  }

  const result = await testProviderConnection({
    stage,
    provider,
    baseURL,
    model,
    apiKey: resolveProbeApiKey(provider, body.apiKey as string | null, stage, baseURL),
  });
  // Luôn 200: "kết nối hỏng" là KẾT QUẢ của phép thử, không phải lỗi của route. UI đọc
  // result.ok để hiện xanh/đỏ.
  return NextResponse.json(result);
}
