'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ArrowRight, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { PageShell } from '@/components/page-shell';
import { useProject } from '@/components/project-context';
import { RegionCropper } from '@/components/region-cropper';
import { useReducedMotion } from '@/components/use-reduced-motion';
import { cn } from '@/lib/utils';
import type {
  BeatDTO,
  BeatRegion,
  JobProgress,
  MotionOverride,
  StoryboardDTO,
} from '@/lib/schema';

// Trang storyboard master–detail: trái = list nhịp gọn (thumbnail + reorder), phải = chi
// tiết nhịp đang chọn (chọn vùng kéo-thả + narration + Generate + xoá). Kịch bản AI ở
// route riêng /script/{jobId}.

interface BeatDraft {
  narration: string;
  region: BeatRegion | null;
  motion?: MotionOverride; // undefined = auto
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message ?? `Lỗi HTTP ${res.status}`);
  }
  return data as T;
}

function phaseLabel(p: JobProgress): string {
  switch (p.phase) {
    case 'ready':
      return 'Sẵn sàng';
    case 'queued':
      return 'Đang chuẩn bị nhịp…';
    case 'processing':
      return `Đang soạn nhịp ${p.done}/${p.total}…`;
    case 'done':
      return `Hoàn tất ${p.done}/${p.total} nhịp`;
    case 'failed':
      return 'Dựng storyboard thất bại';
  }
}

// ETA thô ước từ nhịp rpm — chỉ trấn an "còn bao lâu", KHÔNG cam kết chính xác
// (vision latency biến thiên). Nhãn luôn kèm "~" để người dùng hiểu là ước lượng.
function formatEta(remainingMs: number): string {
  const totalSec = Math.max(1, Math.round(remainingMs / 1000));
  if (totalSec < 60) return `~${totalSec} giây`;
  return `~${Math.round(totalSec / 60)} phút`;
}

export default function StoryboardPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const { publish } = useProject();
  const [dto, setDto] = useState<StoryboardDTO | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadErrorMsg, setLoadErrorMsg] = useState<string | null>(null);
  const [selectedBeat, setSelectedBeat] = useState<string | null>(null);
  const [draft, setDraft] = useState<BeatDraft | null>(null);
  const [draftBeatId, setDraftBeatId] = useState<string | null>(null); // draft đang thuộc nhịp nào
  const [draftTouched, setDraftTouched] = useState(false); // người dùng đã gõ/kéo lên draft này chưa
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [rpm, setRpm] = useState(30); // nhịp vision (req/phút) cho Generate all — tránh 429
  const [rev, setRev] = useState(0); // cache-buster cho crop preview sau khi region/beat đổi
  // Kịch bản chỉ copy beat MỘT CHIỀU lúc generate — sửa nhịp sau đó không tự lan sang script.
  // hasScript (probe lúc mount) + editedAfterScript (đã lưu thay đổi nào đó) → banner nhắc tạo lại.
  const [hasScript, setHasScript] = useState(false);
  const [editedAfterScript, setEditedAfterScript] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeBeatRef = useRef<HTMLLIElement | null>(null); // nhịp đang chạy ở cột trái → scroll theo
  const reducedMotion = useReducedMotion();

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function publishReadiness(next: StoryboardDTO) {
    publish({
      jobId: next.jobId,
      hasStoryboard: true,
      storyboardDone: next.progress.phase === 'done' && next.beats.length > 0,
    });
  }

  async function refresh(): Promise<StoryboardDTO | null> {
    try {
      const next = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`);
      setDto(next);
      setRev((r) => r + 1);
      publishReadiness(next);
      return next;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tải được storyboard');
      return null;
    }
  }

  // Poll dự phòng khi SSE đứt (mẫu Stage 1) — 2s/lần tới khi kết thúc.
  function pollUntilDone() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const next = await refresh();
      if (!next || next.progress.phase === 'done' || next.progress.phase === 'failed') {
        stopPolling();
      }
    }, 2000);
  }

  function attachStream() {
    esRef.current?.close();
    const es = new EventSource(`/api/jobs/${jobId}/storyboard/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      let p: JobProgress;
      try {
        p = JSON.parse(ev.data) as JobProgress;
      } catch {
        return;
      }
      setDto((prev) => (prev ? { ...prev, progress: p } : prev));
      if (p.phase === 'done' || p.phase === 'failed') {
        es.close();
        esRef.current = null;
        stopPolling();
        void refresh();
      }
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      void refresh();
      pollUntilDone();
    };
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const first = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`);
        if (cancelled) return;
        setDto(first);
        publishReadiness(first);
        if (first.progress.phase === 'queued' || first.progress.phase === 'processing') {
          attachStream();
        }
        // Probe kịch bản (404 = chưa có) — chỉ để bật banner, lỗi mạng thì bỏ qua.
        try {
          const res = await fetch(`/api/jobs/${jobId}/storyboard/script`);
          if (!cancelled) setHasScript(res.ok);
        } catch {}
      } catch (err) {
        if (cancelled) return;
        setNotFound(true);
        setLoadErrorMsg(err instanceof Error ? err.message : 'Không tải được storyboard');
      }
    })();
    return () => {
      cancelled = true;
      esRef.current?.close();
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy theo jobId
  }, [jobId]);

  // Nhịp đang chạy đổi (SSE) → cuốn item cột trái vào tầm nhìn. Chỉ chạm DOM (scroll),
  // không setState → khớp rule react-hooks/set-state-in-effect. Reduced-motion → nhảy tức thì.
  const currentIndex = dto?.progress.currentIndex ?? null;
  useEffect(() => {
    if (currentIndex === null) return;
    activeBeatRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [currentIndex, reducedMotion]);

  const beats = dto ? [...dto.beats].sort((a, b) => a.order - b.order) : [];
  const selected = beats.find((b) => b.id === selectedBeat) ?? beats[0] ?? null;

  // Draft thuộc về nhịp đang chọn: đổi nhịp → nạp lại draft từ dữ liệu server (pattern
  // "adjust state during render" — không cần effect). Sửa dở rồi chọn nhịp khác = bỏ bản
  // nháp, hành vi master-detail tiêu chuẩn.
  if (selected && draftBeatId !== selected.id) {
    setDraftBeatId(selected.id);
    setDraft({ narration: selected.narration, region: selected.region, motion: selected.motion });
    setDraftTouched(false);
  }
  // Server cập nhật nhịp đang chọn (vd compose xong đổ narration về) mà người dùng CHƯA
  // chạm vào draft → đồng bộ theo server, tránh "Lưu nhịp" đè narration mới bằng bản cũ/rỗng.
  if (
    selected &&
    draftBeatId === selected.id &&
    !draftTouched &&
    draft &&
    (draft.narration !== selected.narration ||
      JSON.stringify(draft.region) !== JSON.stringify(selected.region) ||
      JSON.stringify(draft.motion) !== JSON.stringify(selected.motion))
  ) {
    setDraft({ narration: selected.narration, region: selected.region, motion: selected.motion });
  }
  if (!selected && draftBeatId !== null) {
    setDraftBeatId(null);
    setDraft(null);
    setDraftTouched(false);
  }

  function setBeatBusy(beatId: string, on: boolean) {
    setRowBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(beatId);
      else next.delete(beatId);
      return next;
    });
  }

  function replaceBeat(updated: BeatDTO) {
    setDto((prev) =>
      prev ? { ...prev, beats: prev.beats.map((b) => (b.id === updated.id ? updated : b)) } : prev,
    );
    setRev((r) => r + 1);
  }

  async function saveEdit() {
    if (!selected || !draft) return;
    setBeatBusy(selected.id, true);
    try {
      const updated = await fetchJSON<BeatDTO>(
        `/api/jobs/${jobId}/storyboard/beats/${selected.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            narration: draft.narration,
            region: draft.region,
            motion: draft.motion ?? null, // null = auto (xoá ghi đè)
          }),
        },
      );
      replaceBeat(updated);
      setDraft({ narration: updated.narration, region: updated.region, motion: updated.motion });
      setDraftTouched(false);
      setEditedAfterScript(true);
      publish({ dirty: true });
      toast.success(`Đã lưu nhịp ${updated.order + 1}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được nhịp');
    } finally {
      setBeatBusy(selected.id, false);
    }
  }

  // Generate bằng AI vision: crop vùng nhịp → mô tả + thoại → narration.
  async function generateBeat(beatId: string) {
    setBeatBusy(beatId, true);
    try {
      const updated = await fetchJSON<BeatDTO>(
        `/api/jobs/${jobId}/storyboard/beats/${beatId}/generate`,
        { method: 'POST' },
      );
      replaceBeat(updated);
      if (draftBeatId === beatId) {
        setDraft({ narration: updated.narration, region: updated.region, motion: updated.motion });
        setDraftTouched(false);
      }
      setEditedAfterScript(true);
      publish({ dirty: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generate thất bại');
    } finally {
      setBeatBusy(beatId, false);
    }
  }

  // Xoá 1 nhịp (hard-delete + re-sequence order) — chặn khi storyboard đang dựng/compose
  // (route tự trả 409), disabled thêm khi đang running để khỏi race với compose đang bay.
  async function removeBeat(beatId: string) {
    setBeatBusy(beatId, true);
    try {
      const next = await fetchJSON<StoryboardDTO>(
        `/api/jobs/${jobId}/storyboard/beats/${beatId}`,
        { method: 'DELETE' },
      );
      setDto(next);
      setRev((r) => r + 1);
      setSelectedBeat(null); // về nhịp đầu danh sách mới
      setEditedAfterScript(true);
      publishReadiness(next);
      publish({ dirty: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được nhịp');
    } finally {
      setBeatBusy(beatId, false);
    }
  }

  // reorder trả về DTO đầy đủ (thao tác đổi nhiều nhịp).
  async function beatOp(path: string, body: Record<string, unknown>, beatId: string) {
    setBeatBusy(beatId, true);
    try {
      const next = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard/beats/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setDto(next);
      setRev((r) => r + 1);
      setEditedAfterScript(true);
      publish({ dirty: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setBeatBusy(beatId, false);
    }
  }

  // Batch vision cho mọi nhịp pending/error ("Generate all") — nhịp đã có narration/sửa tay
  // không bị đụng tới (server filter + rev-guard). Tiến độ theo dõi qua SSE như compose.
  async function generateAll() {
    setBusy(true);
    try {
      const next = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpm }),
      });
      setDto(next);
      setEditedAfterScript(true);
      publish({ dirty: true });
      attachStream();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generate all thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function recreate() {
    setBusy(true);
    try {
      const next = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`, {
        method: 'POST',
      });
      setDto(next);
      setSelectedBeat(null);
      setDraftBeatId(null);
      setDraft(null);
      setDraftTouched(false);
      publish({ dirty: true });
      attachStream();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tạo lại được storyboard');
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <PageShell title="Storyboard">
        <p className="text-sm text-destructive">{loadErrorMsg ?? 'Chưa có storyboard cho job này.'}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Store nằm trong RAM — nếu server vừa khởi động lại, dùng nút &quot;Mở project&quot;
          (.mtvproj) trên thanh công cụ để nạp lại phiên đã lưu.
        </p>
        <Button className="mt-4" onClick={() => router.push('/')}>
          Về trang chính
        </Button>
      </PageShell>
    );
  }

  if (!dto) {
    return (
      <PageShell title="Storyboard">
        <p className="text-sm text-muted-foreground">Đang tải storyboard…</p>
      </PageShell>
    );
  }

  const { progress } = dto;
  const running = progress.phase === 'queued' || progress.phase === 'processing';
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  // Nhãn giàu khi processing: số nhịp + % + ETA (ẩn ETA khi rpm≤0 / done≥total để tránh chia 0).
  const remaining = progress.total - progress.done;
  const etaVisible = progress.phase === 'processing' && rpm > 0 && remaining > 0;
  const progressLabel =
    progress.phase === 'processing'
      ? `Đang soạn nhịp ${progress.done}/${progress.total} · ${pct}%${
          etaVisible ? ` · còn ${formatEta((remaining * 60000) / rpm)}` : ''
        }`
      : phaseLabel(progress);
  // Nhịp đang chạy (SSE currentIndex = beat.order). Narration thường rỗng khi đang soạn →
  // fallback trỏ ảnh nguồn để người dùng vẫn định vị được.
  const currentBeat =
    progress.phase === 'processing' && progress.currentIndex !== null
      ? beats.find((b) => b.order === progress.currentIndex)
      : undefined;
  const ready = progress.phase === 'done' && beats.length > 0;
  const selectedWorking = selected
    ? dto.working.find((w) => w.sourceIndex === selected.sourceIndex)
    : undefined;
  const selectedBusy = selected ? rowBusy.has(selected.id) : false;
  // Nhịp cần Generate all nhắm tới: chưa có lời đọc hoặc đang lỗi (bản sửa tay không bị đè).
  const pendingCount = beats.filter((b) => !b.narration.trim() || b.error).length;
  const dirtyDraft =
    draftTouched &&
    selected !== null &&
    draft !== null &&
    (draft.narration !== selected.narration ||
      JSON.stringify(draft.region) !== JSON.stringify(selected.region) ||
      JSON.stringify(draft.motion) !== JSON.stringify(selected.motion));

  return (
    <PageShell
      title="Storyboard"
      subtitle={`${beats.length} nhịp — chọn nhịp bên trái, chỉnh vùng hình + lời đọc bên phải. Lưu cả phiên bằng "Lưu project".`}
      wide
      actions={
        <>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Nhịp
            <Input
              type="number"
              min={1}
              max={600}
              value={rpm}
              onChange={(e) =>
                setRpm(Math.min(600, Math.max(1, Math.round(Number(e.target.value) || 1))))
              }
              className="w-20"
            />
            req/phút
          </label>
          <Button
            variant="ai"
            onClick={generateAll}
            disabled={busy || running || pendingCount === 0}
            title="Generate lời đọc bằng AI vision cho mọi nhịp chưa có nội dung hoặc đang lỗi"
          >
            <Sparkles data-icon="inline-start" />
            {running ? 'Đang generate…' : `Generate all (${pendingCount})`}
          </Button>
          <Button variant="outline" onClick={recreate} disabled={busy || running}>
            {busy ? 'Đang tạo…' : 'Tạo lại storyboard'}
          </Button>
          <Button onClick={() => router.push(`/script/${jobId}`)} disabled={!ready}>
            Kịch bản
            <ArrowRight data-icon="inline-end" />
          </Button>
        </>
      }
    >
      {/* Tiến độ compose */}
      <Card className="py-4">
        <CardContent className="px-4">
          <span className="text-sm font-medium">{progressLabel}</span>
          {currentBeat && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Nhịp {currentBeat.order + 1}:{' '}
              {currentBeat.narration.trim()
                ? `“${currentBeat.narration.trim().slice(0, 60)}${
                    currentBeat.narration.trim().length > 60 ? '…' : ''
                  }”`
                : `band #${currentBeat.sourceIndex + 1}`}
            </p>
          )}
          <Progress
            value={pct}
            className={cn(
              'mt-3',
              progress.phase === 'failed' && '[&>[data-slot=progress-indicator]]:bg-destructive',
            )}
          />
        </CardContent>
      </Card>

      {/* Kịch bản copy beat 1 chiều lúc generate — sửa nhịp xong phải tạo lại mới có hiệu lực */}
      {hasScript && editedAfterScript && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Kịch bản hiện tại chưa ăn các thay đổi vừa lưu — mở trang{' '}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => router.push(`/script/${jobId}`)}
          >
            Kịch bản
          </button>{' '}
          và bấm Tạo kịch bản lại để vùng hình / lời đọc mới đi vào video.
        </div>
      )}

      {beats.length === 0 ? (
        <p className="mt-6 text-sm italic text-muted-foreground">
          {running ? 'Đang chia band…' : 'Chưa có nhịp nào.'}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6 lg:flex-row">
          {/* Cột trái: list nhịp gọn */}
          <aside className="w-full shrink-0 lg:w-72">
            <ol className="flex gap-2 overflow-x-auto lg:block lg:max-h-[75vh] lg:space-y-2 lg:overflow-y-auto lg:pr-1">
              {beats.map((beat, i) => {
                const isSelected = selected?.id === beat.id;
                const isBusy = rowBusy.has(beat.id);
                const isActive =
                  progress.phase === 'processing' && beat.order === progress.currentIndex;
                return (
                  <li
                    key={beat.id}
                    ref={isActive ? activeBeatRef : undefined}
                    className="w-40 shrink-0 lg:w-auto"
                  >
                    <Card
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedBeat(beat.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedBeat(beat.id);
                        }
                      }}
                      className={cn(
                        'cursor-pointer gap-0 py-2 shadow-none transition-colors hover:bg-muted/60',
                        isSelected && 'border-primary bg-muted/40',
                        isActive && 'ring-2 ring-primary/60',
                      )}
                    >
                      <CardContent className="flex items-center gap-2.5 px-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory */}
                        <img
                          src={`${beat.cropUrl}?v=${rev}`}
                          alt={`Nhịp ${beat.order + 1}`}
                          className="h-14 w-12 shrink-0 rounded border object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-xs font-semibold">
                            Nhịp {beat.order + 1}
                            {beat.error && <span className="size-1.5 rounded-full bg-destructive" title={beat.error} />}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {beat.narration || (beat.error ? 'Lỗi — cần xử lý' : 'Chưa có lời đọc')}
                          </p>
                        </div>
                        <div
                          className="flex flex-col"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Chuyển nhịp lên"
                            disabled={isBusy || running || i === 0}
                            onClick={() => beatOp('reorder', { beatId: beat.id, to: beat.order - 1 }, beat.id)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Chuyển nhịp xuống"
                            disabled={isBusy || running || i === beats.length - 1}
                            onClick={() => beatOp('reorder', { beatId: beat.id, to: beat.order + 1 }, beat.id)}
                          >
                            <ArrowDown />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ol>
          </aside>

          {/* Cột phải: chi tiết nhịp đang chọn */}
          {selected && draft && (
            <section className="min-w-0 flex-1">
              <Card className="py-4">
                <CardContent className="space-y-4 px-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Nhịp {selected.order + 1}</Badge>
                    <span className="text-xs text-muted-foreground">
                      ảnh nguồn #{selected.sourceIndex}
                      {selected.durationHint !== undefined && ` · ~${selected.durationHint}s`}
                    </span>
                    {selected.error && <Badge variant="destructive">Lỗi: {selected.error}</Badge>}
                  </div>

                  {selectedWorking ? (
                    <RegionCropper
                      imageUrl={selectedWorking.imageUrl}
                      width={selectedWorking.width}
                      height={selectedWorking.height}
                      region={draft.region}
                      motion={draft.motion}
                      disabled={selectedBusy}
                      onChange={(region) => {
                        setDraftTouched(true);
                        setDraft((d) => (d ? { ...d, region } : d));
                      }}
                      onMotionChange={(motion) => {
                        setDraftTouched(true);
                        setDraft((d) => (d ? { ...d, motion: motion ?? undefined } : d));
                      }}
                      maxHeightClass={dto.sourceKind === 'strip' ? 'max-h-[55vh]' : 'max-h-[60vh]'}
                      contextRegions={beats
                        .filter(
                          (b) =>
                            b.id !== selected.id &&
                            b.sourceIndex === selected.sourceIndex &&
                            b.region !== null,
                        )
                        .map((b) => ({ label: String(b.order + 1), region: b.region! }))}
                    />
                  ) : (
                    <p className="text-sm text-destructive">
                      Không tìm thấy ảnh working cho nhịp này.
                    </p>
                  )}

                  <label className="block text-xs font-medium text-muted-foreground">
                    Lời đọc (narration)
                    <Textarea
                      value={draft.narration}
                      rows={4}
                      className="mt-1"
                      placeholder={
                        running ? 'Đang soạn…' : 'Chưa có lời đọc — bấm Generate hoặc điền tay.'
                      }
                      onChange={(e) => {
                        setDraftTouched(true);
                        setDraft((d) => (d ? { ...d, narration: e.target.value } : d));
                      }}
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={saveEdit} disabled={selectedBusy || !dirtyDraft}>
                      {selectedBusy ? 'Đang lưu…' : 'Lưu nhịp'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={selectedBusy || !dirtyDraft}
                      onClick={() => {
                        setDraft({
                          narration: selected.narration,
                          region: selected.region,
                          motion: selected.motion,
                        });
                        setDraftTouched(false);
                      }}
                    >
                      Hoàn tác
                    </Button>
                    <Button
                      variant="ai"
                      disabled={selectedBusy || running}
                      title="Generate lời đọc từ ảnh bằng AI vision"
                      onClick={() => generateBeat(selected.id)}
                    >
                      <Sparkles data-icon="inline-start" />
                      {selectedBusy ? 'Đang generate…' : 'Generate'}
                    </Button>
                    <Button
                      variant="destructive"
                      className="ml-auto"
                      disabled={selectedBusy || running}
                      onClick={() => removeBeat(selected.id)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Xoá nhịp
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      )}
    </PageShell>
  );
}
