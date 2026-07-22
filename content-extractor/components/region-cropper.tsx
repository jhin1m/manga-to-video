'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight, ChevronDown, Crop } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useReducedMotion } from '@/components/use-reduced-motion';
import { cn } from '@/lib/utils';
import {
  defaultRenderConfig,
  type Aspect,
  type BeatRegion,
  type MotionMode,
  type MotionOverride,
} from '@/lib/schema';
import { availableModes, planKenburns } from '@/lib/kenburns';
import { ASPECT_CSS, kenburnsFrameStyle, kenburnsModeLabel } from '@/lib/kenburns-css';
import { AUTO_REGION_DEFAULTS, autoRegion } from '@/lib/auto-region';
import { INK_BBOX_DEFAULTS, inkBBox } from '@/lib/ink-bbox';

// Chọn vùng trực quan trên ảnh working: kéo để VẼ khung mới, kéo bên trong khung để DI
// CHUYỂN, kéo tay cầm trên viền để CHỈNH KÍCH THƯỚC (neo cạnh/góc đối diện). Ảnh hiển thị
// co giãn — mọi toạ độ quy đổi qua tỉ lệ hiển thị/thật rồi trả về px working thật (khớp
// hợp đồng region của PATCH beat). Khối "Nâng cao" giữ numeric x/y/w/h đồng bộ 2 chiều —
// cũng là đường chỉnh bằng bàn phím (a11y).

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

// Vị trí trên viền + con trỏ cho từng tay cầm; hitbox 20px bao quanh ô 10px nhìn thấy.
const HANDLES: Array<{ handle: Handle; pos: string; cursor: string }> = [
  { handle: 'nw', pos: 'left-0 top-0', cursor: 'cursor-nwse-resize' },
  { handle: 'n', pos: 'left-1/2 top-0', cursor: 'cursor-ns-resize' },
  { handle: 'ne', pos: 'left-full top-0', cursor: 'cursor-nesw-resize' },
  { handle: 'e', pos: 'left-full top-1/2', cursor: 'cursor-ew-resize' },
  { handle: 'se', pos: 'left-full top-full', cursor: 'cursor-nwse-resize' },
  { handle: 's', pos: 'left-1/2 top-full', cursor: 'cursor-ns-resize' },
  { handle: 'sw', pos: 'left-0 top-full', cursor: 'cursor-nesw-resize' },
  { handle: 'w', pos: 'left-0 top-1/2', cursor: 'cursor-ew-resize' },
];

interface DragState {
  mode: 'draw' | 'move' | 'resize';
  startX: number; // px working
  startY: number;
  // move: offset từ điểm bấm tới góc region lúc bắt đầu
  offsetX: number;
  offsetY: number;
  // resize: tay cầm đang kéo + khung lúc bấm (suy cạnh/góc đối diện làm neo)
  handle?: Handle;
  base?: BeatRegion;
}

function clampRegion(r: BeatRegion, width: number, height: number): BeatRegion {
  const w = Math.max(1, Math.min(Math.round(r.w), width));
  const h = Math.max(1, Math.min(Math.round(r.h), height));
  const x = Math.max(0, Math.min(Math.round(r.x), width - w));
  const y = Math.max(0, Math.min(Math.round(r.y), height - h));
  return { x, y, w, h };
}

// Preview dùng duration danh nghĩa (planKenburns kẹp quãng pan theo duration — shot thật có
// thể chạy khác) và zoom/aspect mặc định của RenderConfig; đây là xem trước XẤP XỈ.
const PREVIEW_DURATION_SEC = 4;
const PREVIEW_FPS = 30;
// Crop vẽ vào canvas hạ cỡ (ô preview nhỏ) — đỡ tốn bộ nhớ khi region là cả band cao.
const PREVIEW_MAX_EDGE = 800;
const PREVIEW_DEFAULTS = defaultRenderConfig();

// Nhãn mode trong dropdown (không kèm mũi tên hướng — hướng do nút đảo quyết định).
const MODE_OPTIONS: Array<{ mode: MotionMode; label: string }> = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'pan-v', label: 'Lia dọc' },
  { mode: 'pan-h', label: 'Lia ngang' },
  { mode: 'zoom', label: 'Zoom' },
  { mode: 'static', label: 'Tĩnh' },
];

// Chiếu vùng đang chọn vào khung đúng tỉ lệ, chạy lặp đúng pan/zoom mà planKenburns sinh
// cho hộp hiện tại — cùng cấu trúc player với trang video (nền blur-cover + fg transform).
// Chip mode trên preview là DROPDOWN: chỗ đang báo hệ thống định làm gì cũng là chỗ bảo
// nó làm khác (ghi đè per-nhịp); kèm nút đảo hướng khi mode hiện hành có hướng.
function ShotPreview({
  imageUrl,
  width,
  height,
  region,
  aspect,
  motion,
  onMotionChange,
  disabled = false,
}: {
  imageUrl: string;
  width: number; // kích thước working thật (px)
  height: number;
  region: BeatRegion | null; // null = cả band
  aspect: Aspect;
  motion?: MotionOverride; // undefined = auto
  onMotionChange?: (motion: MotionOverride | null) => void; // null = trở về auto
  disabled?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [p, setP] = useState(0);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const fgRef = useRef<HTMLCanvasElement | null>(null);

  // Nạp + decode ảnh band theo URL (trùng URL ảnh cropper nên thường cache hit).
  // decode() có thể reject với ảnh strip rất lớn (Safari) dù ảnh nạp OK → fallback onload;
  // drawImage tự decode đồng bộ được. setImgEl gọi lặp cùng img là no-op với React.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    const ready = () => {
      if (!cancelled) setImgEl(img);
    };
    img.onload = ready;
    img.src = imageUrl;
    img.decode().then(ready).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const r = region ?? { x: 0, y: 0, w: width, h: height };

  // Vẽ phần trong region vào 2 canvas (fg + nền blur) mỗi khi hộp đổi — kể cả đang kéo.
  // Canvas là replaced element có intrinsic size = crop → fgStyle/object-fit áp y như <img>.
  useEffect(() => {
    if (!imgEl) return;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(r.w, r.h));
    const cw = Math.max(1, Math.round(r.w * scale));
    const ch = Math.max(1, Math.round(r.h * scale));
    for (const canvas of [fgRef.current, bgRef.current]) {
      if (!canvas) continue;
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext('2d')?.drawImage(imgEl, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
    }
  }, [imgEl, r.x, r.y, r.w, r.h]);

  // Tiến độ p chạy 0→1 rồi lặp; reducedMotion → đóng băng khung đầu (không chạy RAF).
  useEffect(() => {
    if (reducedMotion) return;
    let raf: number;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      setP((((ts - start) / 1000) % PREVIEW_DURATION_SEC) / PREVIEW_DURATION_SEC);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  const plan = planKenburns({
    imgW: width,
    imgH: height,
    region,
    aspect,
    durationSec: PREVIEW_DURATION_SEC,
    fps: PREVIEW_FPS,
    zoom: PREVIEW_DEFAULTS.kenburns.zoom,
    motion,
  });
  const { fgStyle, imgTransformStyle } = kenburnsFrameStyle(
    plan,
    reducedMotion ? 0 : p,
    PREVIEW_DEFAULTS.kenburns.zoom,
  );

  const isAuto = motion === undefined || motion.mode === 'auto';
  const modes = availableModes(region, width, height, aspect);
  const chipLabel = isAuto
    ? `Auto · ${kenburnsModeLabel(plan.mode)}`
    : kenburnsModeLabel(plan.mode, plan.reverse === true);
  // Nút đảo hướng: chỉ khi mode hiện hành có hướng. Bấm khi đang auto = "đóng băng" mode
  // suy ra thành ghi đè tường minh kèm reverse (auto + reverse là no-op theo hợp đồng).
  const canReverse = plan.mode !== 'static' && onMotionChange !== undefined;

  return (
    <div
      className="relative overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: ASPECT_CSS[aspect], containerType: 'size' }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <canvas
          ref={bgRef}
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl"
        />
        <canvas
          ref={fgRef}
          className="relative"
          style={{ ...fgStyle, ...imgTransformStyle, margin: '0 auto' }}
        />
      </div>
      <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
        {onMotionChange ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white disabled:cursor-default"
                title="Chọn hiệu ứng cho nhịp này"
              >
                {chipLabel}
                <ChevronDown className="size-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {MODE_OPTIONS.map(({ mode, label }) => {
                const feasible = modes.includes(mode);
                return (
                  <DropdownMenuItem
                    key={mode}
                    // Không dùng prop disabled (pointer-events:none nuốt mất tooltip title)
                    // — tự chặn onSelect + style mờ, title giải thích vì sao không chọn được.
                    aria-disabled={!feasible}
                    className={cn(!feasible && 'cursor-not-allowed opacity-50')}
                    title={
                      feasible
                        ? undefined
                        : mode === 'pan-h'
                          ? 'Vùng đang chọn không đủ phần dư ngang để lia'
                          : 'Vùng đang chọn không đủ phần dư dọc để lia'
                    }
                    onSelect={(e) => {
                      if (!feasible) {
                        e.preventDefault();
                        return;
                      }
                      onMotionChange(mode === 'auto' ? null : { mode });
                    }}
                  >
                    {(motion?.mode ?? 'auto') === mode ? '✓ ' : ''}
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge className="bg-black/60 text-white">{chipLabel}</Badge>
        )}
        {canReverse && (
          <button
            type="button"
            disabled={disabled}
            title="Đảo hướng chuyển động"
            aria-label="Đảo hướng chuyển động"
            className="inline-flex cursor-pointer items-center rounded-md bg-black/60 p-1 text-white disabled:cursor-default"
            onClick={() =>
              onMotionChange({
                mode: plan.mode,
                ...(plan.reverse === true ? {} : { reverse: true }),
              })
            }
          >
            <ArrowLeftRight className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

export function RegionCropper({
  imageUrl,
  width,
  height,
  region,
  onChange,
  motion,
  onMotionChange,
  disabled = false,
  contextRegions = [],
  maxHeightClass = 'max-h-[60vh]',
  aspect = PREVIEW_DEFAULTS.aspect,
}: {
  imageUrl: string;
  width: number; // kích thước working thật (px)
  height: number;
  region: BeatRegion | null; // null = cả trang
  onChange: (region: BeatRegion | null) => void;
  // Ghi đè hiệu ứng per-nhịp — undefined = auto; onMotionChange(null) = trở về auto.
  // Không truyền onMotionChange → chip chỉ hiển thị (read-only) như trước.
  motion?: MotionOverride;
  onMotionChange?: (motion: MotionOverride | null) => void;
  disabled?: boolean;
  // Vùng của các nhịp khác (ngữ cảnh, chỉ hiển thị) — dùng cho canvas strip.
  contextRegions?: Array<{ label: string; region: BeatRegion }>;
  maxHeightClass?: string;
  // Tỉ lệ khung khởi tạo cho ô preview (chỉ để xem — không lưu vào beat).
  aspect?: Aspect;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<BeatRegion | null>(null);
  const [previewAspect, setPreviewAspect] = useState<Aspect>(aspect);

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
    // Ưu tiên cao nhất: bấm trúng tay cầm (DOM target) → resize, neo cạnh/góc đối diện.
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset
      .handle as Handle | undefined;
    if (handle && region) {
      dragRef.current = {
        mode: 'resize',
        startX: p.x,
        startY: p.y,
        offsetX: 0,
        offsetY: 0,
        handle,
        base: region,
      };
      return;
    }
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

  // Khung tại thời điểm con trỏ ở p: move = tịnh tiến khung cũ; resize = cạnh mà tay cầm
  // điều khiển dời theo ĐỘ DỜI con trỏ từ lúc bấm (không nhảy tới vị trí con trỏ — click
  // suông giữ nguyên khung, kéo thật không giật nhát đầu), cạnh đối diện đứng yên (min/max
  // chuẩn hoá khi kéo lố qua neo); draw = khung từ điểm bắt đầu tới p (kéo < 3px working
  // coi là click thường, chưa thành khung).
  function computeRect(drag: DragState, p: { x: number; y: number }): BeatRegion | null {
    if (drag.mode === 'move' && region) {
      return clampRegion(
        { x: p.x - drag.offsetX, y: p.y - drag.offsetY, w: region.w, h: region.h },
        width,
        height,
      );
    }
    if (drag.mode === 'resize' && drag.handle && drag.base) {
      const b = drag.base;
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      let { x, y, w, h } = b;
      if (drag.handle.includes('w')) {
        const anchor = b.x + b.w;
        const edge = b.x + dx;
        x = Math.min(edge, anchor);
        w = Math.abs(anchor - edge);
      } else if (drag.handle.includes('e')) {
        const edge = b.x + b.w + dx;
        x = Math.min(edge, b.x);
        w = Math.abs(edge - b.x);
      }
      if (drag.handle.includes('n')) {
        const anchor = b.y + b.h;
        const edge = b.y + dy;
        y = Math.min(edge, anchor);
        h = Math.abs(anchor - edge);
      } else if (drag.handle.includes('s')) {
        const edge = b.y + b.h + dy;
        y = Math.min(edge, b.y);
        h = Math.abs(edge - b.y);
      }
      return clampRegion({ x, y, w, h }, width, height);
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

  // Đọc pixel từ <img> qua canvas hạ cỡ — dùng chung fitToContent + né bubble.
  function sampleCanvas(): { data: ImageData; scale: number } | null {
    const img = imgRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
    const cw = Math.max(1, Math.round(width * scale));
    const ch = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    try {
      return { data: ctx.getImageData(0, 0, cw, ch), scale };
    } catch {
      toast.error('Không đọc được pixel ảnh để tính vùng.');
      return null;
    }
  }

  // "Vừa khít nội dung": co region bám vùng có mực của CẢ ảnh, bỏ lề trắng. Chỉ thủ công —
  // auto-trim đã bị spike bác bỏ (tiết kiệm TB 7.3%, 2/27 band đạt ngưỡng). Tính bbox trên
  // canvas hạ cỡ rồi SCALE NGƯỢC về px working — quên bước này là region sai toàn bộ;
  // padding của inkBBox hấp thụ sai số vài px nên không cần canvas full-res.
  function fitToContent() {
    const sample = sampleCanvas();
    if (!sample) return;
    const { data: rgba, scale } = sample;
    const bbox = inkBBox(
      { data: rgba.data, width: rgba.width, height: rgba.height, channels: 4 },
      // Sàn padding tính theo px CANVAS HẠ CỠ rồi mới scale ngược — co sàn theo scale để
      // padding hiệu dụng trên ảnh working đúng ~padMinPx, không bị thổi phồng 1/scale lần.
      { padMinPx: Math.max(2, Math.round(INK_BBOX_DEFAULTS.padMinPx * scale)) },
    );
    if (!bbox) {
      toast.info('Ảnh full-bleed — không có lề trắng để cắt.');
      return;
    }
    const inv = 1 / scale;
    onChange(
      clampRegion(
        { x: bbox.x * inv, y: bbox.y * inv, w: bbox.w * inv, h: bbox.h * inv },
        width,
        height,
      ),
    );
  }

  // "Né bubble": heuristic auto-region — ưu tiên art, phạt blob trắng+chữ (speech bubble).
  function avoidBubbles() {
    const sample = sampleCanvas();
    if (!sample) return;
    const { data: rgba, scale } = sample;
    const region = autoRegion(
      { data: rgba.data, width: rgba.width, height: rgba.height, channels: 4 },
      {
        padMinPx: Math.max(2, Math.round(AUTO_REGION_DEFAULTS.padMinPx * scale)),
      },
    );
    if (!region) {
      toast.info('Không tìm thấy khung né bubble tốt hơn full frame.');
      return;
    }
    const inv = 1 / scale;
    onChange(
      clampRegion(
        { x: region.x * inv, y: region.y * inv, w: region.w * inv, h: region.h * inv },
        width,
        height,
      ),
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Kéo trên ảnh để chọn vùng · kéo trong khung để di chuyển · kéo tay cầm để chỉnh cỡ (
          {width}×{height}px)
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            title="Co vùng bám sát nội dung, bỏ lề trắng"
            onClick={fitToContent}
          >
            <Crop data-icon="inline-start" />
            Vừa khít
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            title="Tự chọn khung giảm bong bóng thoại trong video"
            onClick={avoidBubbles}
          >
            Né bubble
          </Button>
        </div>
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

      <div className="flex flex-col items-start gap-3 sm:flex-row">
        {/* overflow-x-hidden: tay cầm ở mép ảnh tràn nửa ô ra ngoài — cắt thay vì sinh scrollbar ngang */}
        <div
          className={cn(
            'w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border',
            maxHeightClass,
          )}
        >
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
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Ảnh working"
              className="w-full"
              draggable={false}
            />
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
                className={cn(
                  'absolute border-2 border-primary bg-primary/15',
                  disabled ? 'pointer-events-none' : 'cursor-move touch-none',
                )}
                style={{
                  left: pct(shown.x, width),
                  top: pct(shown.y, height),
                  width: pct(shown.w, width),
                  height: pct(shown.h, height),
                }}
              >
                {!disabled &&
                  HANDLES.map(({ handle, pos, cursor }) => (
                    <div
                      key={handle}
                      data-handle={handle}
                      className={cn(
                        'absolute flex size-5 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center',
                        pos,
                        cursor,
                      )}
                    >
                      <div className="size-2.5 rounded-[2px] border border-background bg-primary shadow-sm" />
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Cột preview: chiếu hộp đang chọn (kể cả đang kéo) vào khung đúng tỉ lệ video */}
        <div className="w-44 shrink-0 space-y-1.5 md:w-52">
          <div className="flex items-center gap-1">
            {(['9:16', '16:9', '1:1'] as const).map((a) => (
              <Button
                key={a}
                size="xs"
                variant={previewAspect === a ? 'default' : 'outline'}
                onClick={() => setPreviewAspect(a)}
              >
                {a}
              </Button>
            ))}
          </div>
          <ShotPreview
            imageUrl={imageUrl}
            width={width}
            height={height}
            region={shown}
            aspect={previewAspect}
            motion={motion}
            onMotionChange={onMotionChange}
            disabled={disabled}
          />
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Xem trước xấp xỉ chuyển động — bản chuẩn do CLI render.
          </p>
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
