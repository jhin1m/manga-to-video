import { NextResponse } from 'next/server';
import { createJob } from '@/lib/jobs';
import {
  expandPdfs,
  extractImages,
  ingestBandItems,
  type BandItem,
  type RawImage,
} from '@/lib/pipeline';
import { stitchSlices } from '@/lib/stitch';
import {
  createStoryboard,
  getStoryboard,
  toStoryboardDTO,
  updateStoryboardProgress,
  type StoredBeat,
  type WorkingImage,
} from '@/lib/storyboard-store';
import {
  STORYBOARD_VERSION,
  estimateSeconds,
  type Beat,
  type BeatRegion,
  type SourceKind,
} from '@/lib/schema';

export const runtime = 'nodejs';

// Nạp lại storyboard từ manifest JSON + ảnh nguồn (store in-memory mất khi restart —
// export chính là bản lưu, đây là đường phục hồi). Với strip, canvas được stitch LẠI từ
// ảnh tải lên: cùng bộ ảnh + cùng MAX_EDGE như phiên export thì toạ độ region khớp.

interface ParsedManifest {
  sourceKind: SourceKind;
  beats: Beat[];
}

// Cùng chuẩn với PATCH beat: làm tròn về số nguyên, x/y ≥ 0, w/h ≥ 1 (chặn vùng suy biến).
function parseRegion(raw: unknown): BeatRegion | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const r = raw as Record<string, unknown>;
  if (![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return 'invalid';
  }
  const region = {
    x: Math.round(r.x as number),
    y: Math.round(r.y as number),
    w: Math.round(r.w as number),
    h: Math.round(r.h as number),
  };
  if (region.x < 0 || region.y < 0 || region.w < 1 || region.h < 1) return 'invalid';
  return region;
}

function parseManifest(raw: unknown): ParsedManifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('Manifest không phải JSON object');
  const m = raw as Record<string, unknown>;
  if (m.version !== STORYBOARD_VERSION) {
    throw new Error(`Manifest version không hỗ trợ (cần ${STORYBOARD_VERSION})`);
  }
  if (m.sourceKind !== 'pages' && m.sourceKind !== 'strip') {
    throw new Error("Manifest thiếu sourceKind hợp lệ ('pages' | 'strip')");
  }
  if (!Array.isArray(m.beats) || m.beats.length === 0) {
    throw new Error('Manifest không có beats');
  }
  const beats: Beat[] = m.beats.map((rawBeat, i) => {
    const b = (rawBeat ?? {}) as Record<string, unknown>;
    const region = parseRegion(b.region);
    if (
      typeof b.sourceIndex !== 'number' ||
      !Number.isInteger(b.sourceIndex) ||
      b.sourceIndex < 0 ||
      typeof b.narration !== 'string' ||
      region === 'invalid'
    ) {
      throw new Error(`Beat thứ ${i + 1} không hợp lệ (cần sourceIndex, narration, region đúng kiểu)`);
    }
    return {
      id: typeof b.id === 'string' && b.id ? b.id : crypto.randomUUID(),
      order: typeof b.order === 'number' && Number.isInteger(b.order) ? b.order : i,
      sourceIndex: b.sourceIndex,
      region,
      narration: b.narration,
      ...(Array.isArray(b.sourceDialogue) && b.sourceDialogue.every((d) => typeof d === 'string')
        ? { sourceDialogue: b.sourceDialogue as string[] }
        : {}),
      durationHint:
        typeof b.durationHint === 'number' && b.durationHint >= 0
          ? b.durationHint
          : estimateSeconds(b.narration),
      ...(typeof b.error === 'string' && b.error ? { error: b.error } : {}),
    };
  });
  if (new Set(beats.map((b) => b.id)).size !== beats.length) {
    throw new Error('Beats có id trùng nhau');
  }
  return { sourceKind: m.sourceKind, beats };
}

function readMaxEdge(): number {
  const v = Number.parseInt(process.env.MAX_EDGE ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 1568;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const manifestField = form.get('manifest');
  if (!(manifestField instanceof File)) {
    return NextResponse.json({ error: 'Thiếu file manifest JSON' }, { status: 400 });
  }
  let manifest: ParsedManifest;
  try {
    manifest = parseManifest(JSON.parse(await manifestField.text()));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Manifest không đọc được';
    return NextResponse.json({ error: `Manifest không hợp lệ: ${message}` }, { status: 400 });
  }

  let uploaded: RawImage[] = [];
  for (const f of form.getAll('images')) {
    if (f instanceof File) {
      uploaded.push({ filename: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
    }
  }
  const zipField = form.get('zip');
  const zipBuffer = zipField instanceof File ? Buffer.from(await zipField.arrayBuffer()) : undefined;
  let images: RawImage[];
  try {
    uploaded = await expandPdfs(uploaded);
    images = extractImages({ images: uploaded, zip: zipBuffer });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không đọc được ảnh tải lên';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (images.length === 0) {
    return NextResponse.json({ error: 'Không tìm thấy ảnh trong dữ liệu tải lên' }, { status: 400 });
  }

  // Ingest y hệt upload chapter (cùng MAX_EDGE + settings smart-split): gộp thành canvas
  // dọc rồi chia band — cùng bộ ảnh + cùng env thì band tái lập đúng phiên export.
  const maxEdge = readMaxEdge();
  let items: BandItem[];
  try {
    items = await ingestBandItems(images, maxEdge);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không xử lý được ảnh tải lên';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Dựng working images theo nguồn — validate ĐỦ trước khi tạo bất kỳ state nào
  // (không dựng storyboard nửa vời).
  let working: WorkingImage[];
  try {
    if (manifest.sourceKind === 'strip') {
      const bad = manifest.beats.find((b) => b.sourceIndex !== 0);
      if (bad) {
        throw new Error(
          `Beat trỏ sourceIndex ${bad.sourceIndex} nhưng nguồn strip chỉ có canvas 0 — manifest và ảnh không khớp`,
        );
      }
      const canvas = await stitchSlices(items.map((it) => it.buffer));
      working = [
        { sourceIndex: 0, buffer: canvas.buffer, width: canvas.width, height: canvas.height },
      ];
    } else {
      const outOfRange = manifest.beats.find((b) => b.sourceIndex >= items.length);
      if (outOfRange) {
        throw new Error(
          `Beat trỏ sourceIndex ${outOfRange.sourceIndex} nhưng ảnh tải lên chỉ chia được ${items.length} band — kiểm tra đúng bộ ảnh và env smart-split như phiên export`,
        );
      }
      working = items.map((it, i) => ({
        sourceIndex: i,
        buffer: it.buffer,
        width: it.width,
        height: it.height,
        content: null, // content Stage 1 không nằm trong storyboard manifest
      }));
    }
    for (const b of manifest.beats) {
      if (!b.region) continue;
      const w = working.find((x) => x.sourceIndex === b.sourceIndex)!;
      if (b.region.x < 0 || b.region.y < 0 || b.region.x + b.region.w > w.width || b.region.y + b.region.h > w.height) {
        throw new Error(
          `Region của beat #${b.order} vượt biên ảnh nguồn (${w.width}×${w.height}) — kiểm tra đúng bộ ảnh và MAX_EDGE như phiên export`,
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Không dựng được storyboard';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Job mới giữ ảnh nguồn (xem thumbnail / chạy lại Stage 1 nếu muốn) + storyboard từ manifest.
  const job = createJob(items);
  const beats: StoredBeat[] = manifest.beats
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((b, i) => ({
      ...b,
      order: i,
      status: b.narration ? 'done' : b.error ? 'error' : 'pending',
      rev: 0,
    }));
  createStoryboard({ jobId: job.id, sourceKind: manifest.sourceKind, working, beats });
  // Không có compose nào đang chạy — phase 'done'; beat pending chờ Thử lại / người điền.
  updateStoryboardProgress(job.id, {
    phase: 'done',
    done: beats.filter((b) => b.status !== 'pending').length,
    total: beats.length,
    currentIndex: null,
  });

  // Đọc lại state để DTO phản ánh progress vừa cập nhật.
  return NextResponse.json(toStoryboardDTO(getStoryboard(job.id)!));
}
