import { NextResponse } from 'next/server';
import { PROVIDER_PRESETS, type AiProviderId } from '@/lib/ai-providers';
import { fetchProviderModels } from '@/lib/ai-probe';
import { isCrossSiteRequest, resolveProbeApiKey, resolveProbeBaseURL } from '@/lib/settings';

// Danh sách model của nhà cung cấp cho datalist trong Settings dialog.
//
// POST (không phải GET) vì cần cấu hình DRAFT chưa lưu: người dùng vừa chọn provider và dán
// key, chưa bấm Lưu, mà đã muốn thấy danh sách model.
// Body: { provider, baseURL?, apiKey?, stage? } — baseURL chỉ có tác dụng với 'custom',
// apiKey null = dùng key đã lưu / ENV.

export async function POST(req: Request) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: 'Từ chối request cross-site' }, { status: 403 });
  }
  let body: { provider?: unknown; baseURL?: unknown; apiKey?: unknown; stage?: unknown };
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

  try {
    const models = await fetchProviderModels({
      provider,
      baseURL,
      apiKey: resolveProbeApiKey(provider, body.apiKey as string | null, stage, baseURL),
    });
    return NextResponse.json({ models });
  } catch (err) {
    // Offline/sai key/endpoint không có /models → UI KHÔNG bị chặn: ô model là input tự do,
    // datalist chỉ là gợi ý. Trả {error} để hiện dòng nhắc, không throw.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Không lấy được danh sách model' },
      { status: 502 },
    );
  }
}
