import { NextResponse } from 'next/server';
import { getStoryboard, mergeSegments, toScriptDTO } from '@/lib/storyboard-store';

export const runtime = 'nodejs';

// Gộp 2 đoạn liền kề. Body: { segIds: [a, b] }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state || !state.script) {
    return NextResponse.json(
      { error: state ? 'Chưa có kịch bản cho job này' : 'Chưa có storyboard cho job này' },
      { status: 404 },
    );
  }
  if (state.scriptGenerating) {
    return NextResponse.json({ error: 'Đang tạo kịch bản, chờ xong đã' }, { status: 409 });
  }

  let segIds: unknown;
  try {
    segIds = ((await req.json()) as { segIds?: unknown })?.segIds;
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }
  if (
    !Array.isArray(segIds) ||
    segIds.length !== 2 ||
    !segIds.every((s) => typeof s === 'string')
  ) {
    return NextResponse.json({ error: 'Cần segIds là mảng đúng 2 id đoạn' }, { status: 400 });
  }

  try {
    mergeSegments(id, segIds[0], segIds[1]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không gộp được';
    const status = message.includes('Không tìm thấy') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(toScriptDTO(getStoryboard(id)!));
}
