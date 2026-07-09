'use client';

import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { BeatRegion } from '@/lib/schema';

// Chọn vùng trực quan trên ảnh working: kéo để VẼ khung mới, kéo bên trong khung để DI
// CHUYỂN. Ảnh hiển thị co giãn — mọi toạ độ quy đổi qua tỉ lệ hiển thị/thật rồi trả về px
// working thật (khớp hợp đồng region của PATCH beat). Khối "Nâng cao" giữ numeric x/y/w/h
// đồng bộ 2 chiều — cũng là đường chỉnh bằng bàn phím (a11y).

interface DragState {
  mode: 'draw' | 'move';
  startX: number; // px working
  startY: number;
  // move: offset từ điểm bấm tới góc region lúc bắt đầu
  offsetX: number;
  offsetY: number;
}

function clampRegion(r: BeatRegion, width: number, height: number): BeatRegion {
  const w = Math.max(1, Math.min(Math.round(r.w), width));
  const h = Math.max(1, Math.min(Math.round(r.h), height));
  const x = Math.max(0, Math.min(Math.round(r.x), width - w));
  const y = Math.max(0, Math.min(Math.round(r.y), height - h));
  return { x, y, w, h };
}

export function RegionCropper({
  imageUrl,
  width,
  height,
  region,
  onChange,
  disabled = false,
  contextRegions = [],
  maxHeightClass = 'max-h-[60vh]',
}: {
  imageUrl: string;
  width: number; // kích thước working thật (px)
  height: number;
  region: BeatRegion | null; // null = cả trang
  onChange: (region: BeatRegion | null) => void;
  disabled?: boolean;
  // Vùng của các nhịp khác (ngữ cảnh, chỉ hiển thị) — dùng cho canvas strip.
  contextRegions?: Array<{ label: string; region: BeatRegion }>;
  maxHeightClass?: string;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<BeatRegion | null>(null);

  // Toạ độ chuột (client) → px working thật theo tỉ lệ ảnh đang hiển thị. Clamp vào biên
  // ảnh: kéo vẽ trượt ra ngoài mép thì khung bị CẮT tại mép chứ không bị tịnh tiến ngược.
  function toWorking(e: React.PointerEvent): { x: number; y: number } | null {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(width, ((e.clientX - rect.left) / rect.width) * width)),
      y: Math.max(0, Math.min(height, ((e.clientY - rect.top) / rect.height) * height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || e.button !== 0) return;
    const p = toWorking(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const inRegion =
      region &&
      p.x >= region.x &&
      p.x <= region.x + region.w &&
      p.y >= region.y &&
      p.y <= region.y + region.h;
    dragRef.current = inRegion
      ? { mode: 'move', startX: p.x, startY: p.y, offsetX: p.x - region.x, offsetY: p.y - region.y }
      : { mode: 'draw', startX: p.x, startY: p.y, offsetX: 0, offsetY: 0 };
  }

  // Khung tại thời điểm con trỏ ở p: move = tịnh tiến khung cũ; draw = khung từ điểm bắt
  // đầu tới p (kéo < 3px working coi là click thường, chưa thành khung).
  function computeRect(drag: DragState, p: { x: number; y: number }): BeatRegion | null {
    if (drag.mode === 'move' && region) {
      return clampRegion(
        { x: p.x - drag.offsetX, y: p.y - drag.offsetY, w: region.w, h: region.h },
        width,
        height,
      );
    }
    const w = Math.abs(p.x - drag.startX);
    const h = Math.abs(p.y - drag.startY);
    if (w < 3 || h < 3) return null;
    return clampRegion(
      { x: Math.min(drag.startX, p.x), y: Math.min(drag.startY, p.y), w, h },
      width,
      height,
    );
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toWorking(e);
    if (p) setDragPreview(computeRect(drag, p));
  }

  function onPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragPreview(null);
    if (!drag) return;
    const p = toWorking(e);
    if (!p) return;
    const rect = computeRect(drag, p);
    // Kéo quá ngắn = click chọn — giữ nguyên region hiện tại (không phá).
    if (rect) onChange(rect);
  }

  const shown = dragPreview ?? region;
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  function setField(key: keyof BeatRegion, raw: string) {
    const base = region ?? { x: 0, y: 0, w: width, h: height };
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(clampRegion({ ...base, [key]: n }, width, height));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Kéo trên ảnh để chọn vùng · kéo trong khung để di chuyển ({width}×{height}px)
        </p>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          Cả trang
          <Switch
            checked={region === null}
            disabled={disabled}
            onCheckedChange={(full) =>
              onChange(
                full
                  ? null
                  : clampRegion(
                      { x: 0, y: 0, w: width, h: Math.min(height, Math.round(width * 1.2)) },
                      width,
                      height,
                    ),
              )
            }
          />
        </label>
      </div>

      <div className={cn('overflow-y-auto rounded-lg border', maxHeightClass)}>
        <div
          className={cn('relative select-none', !disabled && 'cursor-crosshair touch-none')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragPreview(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory */}
          <img ref={imgRef} src={imageUrl} alt="Ảnh working" className="w-full" draggable={false} />
          {contextRegions.map(({ label, region: r }) => (
            <div
              key={label}
              className="pointer-events-none absolute border border-amber-400/70 text-[10px] font-bold text-amber-600"
              style={{
                left: pct(r.x, width),
                top: pct(r.y, height),
                width: pct(r.w, width),
                height: pct(r.h, height),
              }}
            >
              <span className="ml-1">{label}</span>
            </div>
          ))}
          {shown && (
            <div
              className="pointer-events-none absolute border-2 border-primary bg-primary/15"
              style={{
                left: pct(shown.x, width),
                top: pct(shown.y, height),
                width: pct(shown.w, width),
                height: pct(shown.h, height),
              }}
            />
          )}
        </div>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="flex cursor-pointer select-none items-center gap-1 font-medium">
          <ChevronDown className="size-3.5" aria-hidden />
          Nâng cao: toạ độ chính xác (px)
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              {k}
              <Input
                type="number"
                min={0}
                value={region ? region[k] : ''}
                placeholder={region ? undefined : 'cả trang'}
                disabled={disabled}
                onChange={(e) => setField(k, e.target.value)}
                className="h-7 w-20 px-1.5 text-xs"
              />
            </label>
          ))}
          <span className="text-muted-foreground/70">(biên {width}×{height})</span>
        </div>
      </details>
    </div>
  );
}
