'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ArrowRight, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { PageShell } from '@/components/page-shell';
import { useProject } from '@/components/project-context';
import { RegionCropper } from '@/components/region-cropper';
import { cn } from '@/lib/utils';
import type { BeatDTO, BeatRegion, JobProgress, StoryboardDTO } from '@/lib/schema';

// Trang storyboard master–detail: trái = list nhịp gọn (thumbnail + reorder), phải = chi
// tiết nhịp đang chọn (chọn vùng kéo-thả + narration + Generate + xoá). Kịch bản AI ở
// route riêng /script/{jobId}.

interface BeatDraft {
  narration: string;
  region: BeatRegion | null;
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
  const [rev, setRev] = useState(0); // cache-buster cho crop preview sau khi region/beat đổi
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const beats = dto ? [...dto.beats].sort((a, b) => a.order - b.order) : [];
  const selected = beats.find((b) => b.id === selectedBeat) ?? beats[0] ?? null;

  // Draft thuộc về nhịp đang chọn: đổi nhịp → nạp lại draft từ dữ liệu server (pattern
  // "adjust state during render" — không cần effect). Sửa dở rồi chọn nhịp khác = bỏ bản
  // nháp, hành vi master-detail tiêu chuẩn.
  if (selected && draftBeatId !== selected.id) {
    setDraftBeatId(selected.id);
    setDraft({ narration: selected.narration, region: selected.region });
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
      JSON.stringify(draft.region) !== JSON.stringify(selected.region))
  ) {
    setDraft({ narration: selected.narration, region: selected.region });
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
          body: JSON.stringify({ narration: draft.narration, region: draft.region }),
        },
      );
      replaceBeat(updated);
      setDraft({ narration: updated.narration, region: updated.region });
      setDraftTouched(false);
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
        setDraft({ narration: updated.narration, region: updated.region });
        setDraftTouched(false);
      }
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
      publish({ dirty: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setBeatBusy(beatId, false);
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
  const ready = progress.phase === 'done' && beats.length > 0;
  const selectedWorking = selected
    ? dto.working.find((w) => w.sourceIndex === selected.sourceIndex)
    : undefined;
  const selectedBusy = selected ? rowBusy.has(selected.id) : false;
  const dirtyDraft =
    draftTouched &&
    selected !== null &&
    draft !== null &&
    (draft.narration !== selected.narration ||
      JSON.stringify(draft.region) !== JSON.stringify(selected.region));

  return (
    <PageShell
      title="Storyboard"
      subtitle={`${beats.length} nhịp — chọn nhịp bên trái, chỉnh vùng hình + lời đọc bên phải. Lưu cả phiên bằng "Lưu project".`}
      wide
      actions={
        <>
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
          <span className="text-sm font-medium">{phaseLabel(progress)}</span>
          <Progress
            value={pct}
            className={cn(
              'mt-3',
              progress.phase === 'failed' && '[&>[data-slot=progress-indicator]]:bg-destructive',
            )}
          />
        </CardContent>
      </Card>

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
                return (
                  <li key={beat.id} className="w-40 shrink-0 lg:w-auto">
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
                      disabled={selectedBusy}
                      onChange={(region) => {
                        setDraftTouched(true);
                        setDraft((d) => (d ? { ...d, region } : d));
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
                        setDraft({ narration: selected.narration, region: selected.region });
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
