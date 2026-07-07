import { NextResponse } from 'next/server';
import { getJob, setItemResult, toItemDTO } from '@/lib/jobs';
import { emptyContent, type SceneContent } from '@/lib/schema';

export const runtime = 'nodejs';

interface PatchBody {
  description?: string;
  dialogue?: string[];
  note?: string;
}

function parsePatchBody(raw: unknown): PatchBody | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const out: PatchBody = {};
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') return null;
    out.description = body.description;
  }
  if (body.dialogue !== undefined) {
    if (!Array.isArray(body.dialogue) || !body.dialogue.every((d) => typeof d === 'string')) {
      return null;
    }
    out.dialogue = body.dialogue;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== 'string') return null;
    out.note = body.note;
  }
  return out;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; i: string }> },
) {
  const { id, i } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }
  const index = Number.parseInt(i, 10);
  const item = Number.isInteger(index) ? job.items[index] : undefined;
  if (!item) {
    return NextResponse.json({ error: 'Không tìm thấy ảnh trong job' }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body không phải JSON hợp lệ' }, { status: 400 });
  }
  const patch = parsePatchBody(raw);
  if (patch === null) {
    return NextResponse.json(
      { error: 'Dữ liệu không hợp lệ: description/note phải là chuỗi, dialogue phải là mảng chuỗi' },
      { status: 400 },
    );
  }

  // Merge vào content hiện có (khởi tạo rỗng nếu chưa có), xóa lỗi, đánh dấu done.
  const merged: SceneContent = { ...(item.content ?? emptyContent()), ...patch };
  setItemResult(id, index, merged);

  return NextResponse.json(toItemDTO(id, item));
}
