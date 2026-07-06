'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { BeatDTO, JobProgress, SourceKind, StoryboardDTO } from '@/lib/schema';

// Draft sửa nhịp: region giữ dạng chuỗi khi gõ, parse lúc Lưu.
interface BeatDraft {
  narration: string;
  fullPage: boolean;
  x: string;
  y: string;
  w: string;
  h: string;
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
      return 'Đang chuẩn bị (stitch + chia band)…';
    case 'processing':
      return `Đang soạn nhịp ${p.done}/${p.total}…`;
    case 'done':
      return `Hoàn tất ${p.done}/${p.total} nhịp`;
    case 'failed':
      return 'Dựng storyboard thất bại';
  }
}

const kindLabel: Record<SourceKind, string> = {
  pages: 'Trang rời (manga)',
  strip: 'Dải dọc (webtoon/PDF)',
};

export default function StoryboardPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const [dto, setDto] = useState<StoryboardDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, BeatDraft>>({});
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [selectedBeat, setSelectedBeat] = useState<string | null>(null);
  const [recreateKind, setRecreateKind] = useState<'auto' | SourceKind>('auto');
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

  async function refresh(): Promise<StoryboardDTO | null> {
    try {
      const next = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`);
      setDto(next);
      setRev((r) => r + 1);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được storyboard');
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
        if (first.progress.phase === 'queued' || first.progress.phase === 'processing') {
          attachStream();
        }
      } catch (err) {
        if (cancelled) return;
        setNotFound(true);
        setError(err instanceof Error ? err.message : 'Không tải được storyboard');
      }
    })();
    return () => {
      cancelled = true;
      esRef.current?.close();
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy theo jobId
  }, [jobId]);

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

  function startEdit(beat: BeatDTO) {
    const working = dto?.working.find((w) => w.sourceIndex === beat.sourceIndex);
    const base = beat.region ?? { x: 0, y: 0, w: working?.width ?? 0, h: working?.height ?? 0 };
    setDrafts((prev) => ({
      ...prev,
      [beat.id]: {
        narration: beat.narration,
        fullPage: beat.region === null,
        x: String(base.x),
        y: String(base.y),
        w: String(base.w),
        h: String(base.h),
      },
    }));
  }

  function cancelEdit(beatId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[beatId];
      return next;
    });
  }

  async function saveEdit(beatId: string) {
    const draft = drafts[beatId];
    if (!draft) return;
    const region = draft.fullPage
      ? null
      : {
          x: Number(draft.x),
          y: Number(draft.y),
          w: Number(draft.w),
          h: Number(draft.h),
        };
    setBeatBusy(beatId, true);
    setError(null);
    try {
      const updated = await fetchJSON<BeatDTO>(`/api/jobs/${jobId}/storyboard/beats/${beatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narration: draft.narration, region }),
      });
      replaceBeat(updated);
      cancelEdit(beatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được nhịp');
    } finally {
      setBeatBusy(beatId, false);
    }
  }

  async function retryBeat(beatId: string) {
    setBeatBusy(beatId, true);
    setError(null);
    try {
      const updated = await fetchJSON<BeatDTO>(
        `/api/jobs/${jobId}/storyboard/beats/${beatId}/retry`,
        { method: 'POST' },
      );
      replaceBeat(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thử lại thất bại');
    } finally {
      setBeatBusy(beatId, false);
    }
  }

  // split/merge/reorder trả về DTO đầy đủ (thao tác đổi nhiều nhịp).
  async function beatOp(path: string, body: Record<string, unknown>, beatId: string) {
    setBeatBusy(beatId, true);
    setError(null);
    try {
      const next = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard/beats/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setDto(next);
      setRev((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setBeatBusy(beatId, false);
    }
  }

  async function recreate() {
    setBusy(true);
    setError(null);
    try {
      const body = recreateKind === 'auto' ? {} : { sourceKind: recreateKind };
      const next = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setDto(next);
      setDrafts({});
      attachStream();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo lại được storyboard');
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">Storyboard</h1>
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error ?? 'Chưa có storyboard cho job này.'}
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          Store nằm trong RAM — nếu server vừa khởi động lại, hãy nạp lại từ manifest + ảnh ở trang
          chính.
        </p>
        <button
          onClick={() => router.push('/')}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
        >
          Về trang chính
        </button>
      </main>
    );
  }

  if (!dto) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <p className="text-sm text-neutral-500">Đang tải storyboard…</p>
      </main>
    );
  }

  const { progress } = dto;
  const running = progress.phase === 'queued' || progress.phase === 'processing';
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const stripWorking = dto.sourceKind === 'strip' ? dto.working[0] : undefined;
  const beats = [...dto.beats].sort((a, b) => a.order - b.order);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Storyboard</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Nguồn: <span className="font-medium">{kindLabel[dto.sourceKind]}</span> — {beats.length}{' '}
            nhịp. Sửa lời đọc + vùng hình rồi Export cho Stage 2 (TTS/video).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={recreateKind}
            onChange={(e) => setRecreateKind(e.target.value as 'auto' | SourceKind)}
            className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="auto">Tự phân loại nguồn</option>
            <option value="pages">Trang rời (manga)</option>
            <option value="strip">Dải dọc (webtoon/PDF)</option>
          </select>
          <button
            onClick={recreate}
            disabled={busy || running}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {busy ? 'Đang tạo…' : 'Tạo lại storyboard'}
          </button>
          <a
            href={`/api/jobs/${jobId}/storyboard/export`}
            download
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Export storyboard
          </a>
          <button
            onClick={() => router.push('/')}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Trang chính
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-medium underline">
            Đóng
          </button>
        </div>
      )}

      {/* Tiến độ compose */}
      <section className="mt-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <span className="text-sm font-medium">{phaseLabel(progress)}</span>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={`h-full rounded-full transition-all ${
              progress.phase === 'failed' ? 'bg-red-500' : 'bg-blue-600'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        {/* Canvas dải dọc + overlay band (chỉ strip) */}
        {stripWorking && (
          <aside className="lg:w-1/4">
            <p className="mb-2 text-xs font-medium text-neutral-500">
              Canvas {stripWorking.width}×{stripWorking.height}px — vạch màu = band
            </p>
            <div className="max-h-[75vh] overflow-y-auto rounded border border-neutral-200 dark:border-neutral-800">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory */}
                <img src={`${stripWorking.imageUrl}?v=${rev}`} alt="Canvas dải dọc" className="w-full" />
                {beats.map(
                  (b) =>
                    b.region && (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBeat(b.id)}
                        title={`Nhịp ${b.order + 1}`}
                        className={`absolute left-0 w-full border-2 text-left text-[10px] font-bold ${
                          selectedBeat === b.id
                            ? 'border-blue-500 bg-blue-500/20 text-blue-700'
                            : 'border-amber-400/70 bg-transparent text-amber-600'
                        }`}
                        style={{
                          top: `${(b.region.y / stripWorking.height) * 100}%`,
                          height: `${(b.region.h / stripWorking.height) * 100}%`,
                        }}
                      >
                        <span className="ml-1">{b.order + 1}</span>
                      </button>
                    ),
                )}
              </div>
            </div>
          </aside>
        )}

        {/* Danh sách nhịp */}
        <section className="min-w-0 flex-1">
          {beats.length === 0 && (
            <p className="text-sm italic text-neutral-400">
              {running ? 'Đang chia band…' : 'Chưa có nhịp nào.'}
            </p>
          )}
          <ol className="space-y-4">
            {beats.map((beat, i) => {
              const draft = drafts[beat.id];
              const isBusy = rowBusy.has(beat.id);
              const working = dto.working.find((w) => w.sourceIndex === beat.sourceIndex);
              return (
                <li
                  key={beat.id}
                  className={`flex gap-4 rounded-lg border p-4 ${
                    selectedBeat === beat.id
                      ? 'border-blue-400 dark:border-blue-600'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                  onClick={() => setSelectedBeat(beat.id)}
                >
                  <div className="w-32 shrink-0 sm:w-40">
                    {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory */}
                    <img
                      src={`${beat.cropUrl}?v=${rev}`}
                      alt={`Nhịp ${beat.order + 1}`}
                      className="w-full rounded border border-neutral-200 object-contain dark:border-neutral-800"
                    />
                    <p className="mt-1 text-center text-xs text-neutral-500">
                      {beat.region
                        ? `y ${beat.region.y}–${beat.region.y + beat.region.h}`
                        : 'Cả trang'}
                    </p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-bold dark:bg-neutral-800">
                        Nhịp {beat.order + 1}
                      </span>
                      <span className="text-xs text-neutral-500">
                        ảnh nguồn #{beat.sourceIndex}
                        {beat.durationHint !== undefined && ` · ~${beat.durationHint}s`}
                      </span>
                      {beat.error && (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                          Lỗi: {beat.error}
                        </span>
                      )}
                    </div>

                    {draft ? (
                      <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <label className="block text-xs font-medium text-neutral-500">
                          Lời đọc (narration)
                          <textarea
                            value={draft.narration}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [beat.id]: { ...draft, narration: e.target.value },
                              }))
                            }
                            rows={4}
                            className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
                          />
                        </label>
                        <div className="flex flex-wrap items-end gap-2 text-xs font-medium text-neutral-500">
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={draft.fullPage}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [beat.id]: { ...draft, fullPage: e.target.checked },
                                }))
                              }
                            />
                            Cả trang
                          </label>
                          {!draft.fullPage &&
                            (['x', 'y', 'w', 'h'] as const).map((k) => (
                              <label key={k} className="flex items-center gap-1">
                                {k}
                                <input
                                  type="number"
                                  min={0}
                                  value={draft[k]}
                                  onChange={(e) =>
                                    setDrafts((prev) => ({
                                      ...prev,
                                      [beat.id]: { ...draft, [k]: e.target.value },
                                    }))
                                  }
                                  className="w-20 rounded border border-neutral-300 bg-transparent px-1.5 py-1 dark:border-neutral-700"
                                />
                              </label>
                            ))}
                          {working && (
                            <span className="text-neutral-400">
                              (biên {working.width}×{working.height})
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(beat.id)}
                            disabled={isBusy}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                          >
                            {isBusy ? 'Đang lưu…' : 'Lưu'}
                          </button>
                          <button
                            onClick={() => cancelEdit(beat.id)}
                            disabled={isBusy}
                            className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        {beat.narration ? (
                          <p className="whitespace-pre-wrap text-sm">{beat.narration}</p>
                        ) : (
                          <p className="text-xs italic text-neutral-400">
                            {beat.error ? 'Chưa có lời đọc — sửa tay hoặc thử lại.' : running ? 'Đang soạn…' : 'Chưa có lời đọc'}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => startEdit(beat)}
                            className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => retryBeat(beat.id)}
                            disabled={isBusy || running}
                            className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            {isBusy ? 'Đang chạy…' : 'Thử lại'}
                          </button>
                          <button
                            onClick={() => beatOp('split', { beatId: beat.id }, beat.id)}
                            disabled={isBusy || running}
                            className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            Tách đôi
                          </button>
                          {i < beats.length - 1 && (
                            <button
                              onClick={() => beatOp('merge', { beatId: beat.id }, beat.id)}
                              disabled={isBusy || running}
                              className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                            >
                              Gộp nhịp dưới
                            </button>
                          )}
                          <button
                            onClick={() => beatOp('reorder', { beatId: beat.id, to: beat.order - 1 }, beat.id)}
                            disabled={isBusy || running || i === 0}
                            className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => beatOp('reorder', { beatId: beat.id, to: beat.order + 1 }, beat.id)}
                            disabled={isBusy || running || i === beats.length - 1}
                            className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </main>
  );
}
