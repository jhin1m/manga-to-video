import { NextResponse } from 'next/server';

// Proxy danh sách model OpenRouter cho datalist trong Settings dialog (endpoint public,
// không cần key). Trả bản rút gọn {id, name, vision} — vision = model nhận input ảnh,
// dùng lọc gợi ý cho ô Vision model. Cache in-memory 10 phút: danh sách ~300 model, đổi chậm.

interface SlimModel {
  id: string;
  name: string;
  vision: boolean;
}

let cache: { at: number; models: SlimModel[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ models: cache.models });
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`OpenRouter trả HTTP ${res.status}`);
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        architecture?: { input_modalities?: string[] };
      }>;
    };
    const models: SlimModel[] = (data.data ?? [])
      .filter((m): m is { id: string; name?: string; architecture?: { input_modalities?: string[] } } =>
        Boolean(m.id),
      )
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        vision: m.architecture?.input_modalities?.includes('image') ?? false,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    cache = { at: Date.now(), models };
    return NextResponse.json({ models });
  } catch (err) {
    // Offline/lỗi mạng → UI vẫn dùng được (ô model là input tự do, datalist chỉ là gợi ý).
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Không lấy được danh sách model' },
      { status: 502 },
    );
  }
}
