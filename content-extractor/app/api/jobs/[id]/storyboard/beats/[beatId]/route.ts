import { NextResponse } from 'next/server';
import type { BeatRegion } from '@/lib/schema';
import {
  getBeat,
  getStoryboard,
  reorderBeat,
  toBeatDTO,
  updateBeat,
} from '@/lib/storyboard-store';

export const runtime = 'nodejs';

interface PatchBody {
  narration?: string;
  region?: BeatRegion | null;
  order?: number;
}

function parseRegion(raw: unknown): BeatRegion | null | 'invalid' {
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const r = raw as Record<string, unknown>;
  const nums = [r.x, r.y, r.w, r.h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return 'invalid';
  const region = {
    x: Math.round(r.x as number),
    y: Math.round(r.y as number),
    w: Math.round(r.w as number),
    h: Math.round(r.h as number),
  };
  if (region.x < 0 || region.y < 0 || region.w < 1 || region.h < 1) return 'invalid';
  return region;
}

function parsePatchBody(raw: unknown): PatchBody | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const out: PatchBody = {};
  if (body.narration !== undefined) {
    if (typeof body.narration !== 'string') return null;
    out.narration = body.narration;
  }
  if (body.region !== undefined) {
    const region = parseRegion(body.region);
    if (region === 'invalid') return null;
    out.region = region;
  }
  if (body.order !== undefined) {
    if (typeof body.order !== 'number' || !Number.isInteger(body.order) || body.order < 0) {
      return null;
    }
    out.order = body.order;
  }
  return out;
}

// Sửa tay một nhịp: narration (durationHint tính lại), region (validate trong biên
// ảnh nguồn), order (di chuyển vị trí, giữ dãy liền mạch).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; beatId: string }> },
) {
  const { id, beatId } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
  }
  const beat = getBeat(id, beatId);
  if (!beat) {
    return NextResponse.json({ error: 'Không tìm thấy nhịp trong storyboard' }, { status: 404 });
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
      {
        error:
          'Dữ liệu không hợp lệ: narration là chuỗi, region là null hoặc {x,y,w,h} số không âm, order là số nguyên ≥ 0',
      },
      { status: 400 },
    );
  }

  // Region phải nằm trong biên working image của beat.
  if (patch.region) {
    const working = state.working.find((w) => w.sourceIndex === beat.sourceIndex);
    if (!working) {
      return NextResponse.json(
        { error: `Không tìm thấy ảnh nguồn cho sourceIndex ${beat.sourceIndex}` },
        { status: 400 },
      );
    }
    const r = patch.region;
    if (r.x + r.w > working.width || r.y + r.h > working.height) {
      return NextResponse.json(
        { error: `Region vượt biên ảnh nguồn (${working.width}×${working.height})` },
        { status: 400 },
      );
    }
  }

  updateBeat(id, beatId, { narration: patch.narration, region: patch.region });
  if (patch.order !== undefined) {
    try {
      reorderBeat(id, beatId, patch.order);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không đổi được thứ tự';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json(toBeatDTO(id, getBeat(id, beatId)!));
}
