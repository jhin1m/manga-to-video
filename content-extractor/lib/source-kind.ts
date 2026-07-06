import type { SourceKind } from './schema';

// Phân loại nguồn: dải dọc (webtoon/manhua strip, PDF cắt dải) vs trang rời (manga).
// Heuristic tỉ lệ cao/rộng per-image; đa số ảnh vượt ngưỡng → cả job là strip.
// Người vận hành override được ở UI (Phase 4) — heuristic chỉ là đề xuất mặc định.

export function readStripRatio(): number {
  const v = Number.parseFloat(process.env.STRIP_RATIO ?? '');
  return Number.isFinite(v) && v > 0 ? v : 2.5;
}

export function classifySource(
  metas: Array<{ width: number; height: number }>,
  stripRatio: number = readStripRatio(),
): SourceKind {
  if (metas.length === 0) return 'pages';
  const stripCount = metas.filter((m) => m.width > 0 && m.height / m.width >= stripRatio).length;
  return stripCount * 2 > metas.length ? 'strip' : 'pages';
}
