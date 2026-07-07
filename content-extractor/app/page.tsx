'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItemDTO, JobProgress, JobStatusDTO, StoryboardDTO } from '@/lib/schema';

interface Draft {
  description: string;
  dialogue: string; // mỗi dòng một câu thoại
  note: string;
}

const ACCEPTED = /\.(jpe?g|png|webp|gif|zip|pdf)$/i;

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
      return 'Sẵn sàng chạy';
    case 'queued':
      return 'Đang chờ xử lý…';
    case 'processing':
      return `Đang xử lý ${p.done}/${p.total}…`;
    case 'done':
      return `Hoàn tất ${p.done}/${p.total}`;
    case 'failed':
      return 'Job thất bại';
  }
}

export default function Home() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [rowBusy, setRowBusy] = useState<Set<number>>(new Set());
  const [rpm, setRpm] = useState(30); // nhịp vision (req/phút) — chỉnh trước khi Chạy để tránh 429
  const [sbBusy, setSbBusy] = useState(false);
  const [importManifest, setImportManifest] = useState<File | null>(null);
  const [importImages, setImportImages] = useState<File[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      esRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Dự phòng khi SSE đứt giữa chừng (vd dev-server recompile): poll GET đến khi job kết thúc.
  function pollUntilDone(id: string) {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${id}`);
        setProgress(dto.progress);
        if (dto.progress.phase === 'done' || dto.progress.phase === 'failed') {
          setItems(dto.items);
          stopPolling();
        }
      } catch {
        stopPolling();
        setError('Mất kết nối với job (server có thể đã khởi động lại). Hãy chạy lại chapter.');
      }
    }, 2000);
  }

  // Chọn/thả file là đi thẳng vào xem trước: upload ngay, không có bước bấm nút trung gian.
  // Server tự natural-sort theo tên file nên client khỏi gom/sắp trước. Dedupe theo tên để
  // một lượt chọn lỡ trùng file không gửi hai lần.
  function handleSelection(incoming: FileList | File[]) {
    if (busy) return;
    const byName = new Map<string, File>();
    for (const f of Array.from(incoming)) {
      if (ACCEPTED.test(f.name)) byName.set(f.name, f);
    }
    const usable = Array.from(byName.values());
    if (usable.length === 0) return;
    void handleUpload(usable);
  }

  function setRowBusyFlag(index: number, on: boolean) {
    setRowBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function replaceItem(updated: ItemDTO) {
    setItems((prev) => prev.map((it) => (it.index === updated.index ? updated : it)));
  }

  async function refreshItems(id: string) {
    try {
      const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${id}`);
      setItems(dto.items);
      setProgress(dto.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được kết quả');
    }
  }

  // Mở SSE theo dõi tiến độ vision (dùng lại cho lượt Chạy; poll dự phòng khi stream đứt).
  function attachStream(id: string) {
    const es = new EventSource(`/api/jobs/${id}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      let p: JobProgress;
      try {
        p = JSON.parse(ev.data) as JobProgress;
      } catch {
        return;
      }
      setProgress(p);
      if (p.phase === 'done' || p.phase === 'failed') {
        es.close();
        esRef.current = null;
        stopPolling();
        void refreshItems(id);
      }
    };
    es.onerror = () => {
      // Server đóng stream khi job xong cũng rơi vào đây — tải trạng thái mới nhất,
      // và nếu job còn chạy thì chuyển sang poll để tiến độ không đóng băng.
      es.close();
      esRef.current = null;
      void refreshItems(id);
      pollUntilDone(id);
    };
  }

  // Bước 1: upload + downscale → job ở phase 'ready'. CHƯA gọi vision; hiện lưới xem trước.
  async function handleUpload(toUpload: File[]) {
    setError(null);
    const zips = toUpload.filter((f) => /\.zip$/i.test(f.name));
    if (zips.length > 1) {
      setError('Chỉ hỗ trợ 1 file zip mỗi lần chạy');
      return;
    }
    const fd = new FormData();
    if (zips[0]) fd.append('zip', zips[0]);
    for (const f of toUpload) {
      if (!/\.zip$/i.test(f.name)) fd.append('images', f);
    }
    setBusy(true);
    setItems([]);
    setDrafts({});
    try {
      const dto = await fetchJSON<JobStatusDTO>('/api/jobs', { method: 'POST', body: fd });
      setJobId(dto.jobId);
      setItems(dto.items); // thumbnail xem trước, đúng thứ tự đọc
      setProgress(dto.progress); // phase 'ready'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được job');
    } finally {
      setBusy(false);
    }
  }

  // Bước 2: kích hoạt vision cho toàn bộ trang (rate limit theo rpm) rồi theo dõi qua SSE.
  async function handleRun() {
    if (!jobId) return;
    setError(null);
    setBusy(true);
    try {
      const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${jobId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpm }),
      });
      setProgress(dto.progress);
      attachStream(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không chạy được job');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: ItemDTO) {
    setDrafts((prev) => ({
      ...prev,
      [item.index]: {
        description: item.content?.description ?? '',
        dialogue: (item.content?.dialogue ?? []).join('\n'),
        note: item.content?.note ?? '',
      },
    }));
  }

  function cancelEdit(index: number) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  async function saveEdit(index: number) {
    if (!jobId) return;
    const draft = drafts[index];
    if (!draft) return;
    setRowBusyFlag(index, true);
    try {
      const updated = await fetchJSON<ItemDTO>(`/api/jobs/${jobId}/items/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: draft.description,
          dialogue: draft.dialogue
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          note: draft.note,
        }),
      });
      replaceItem(updated);
      cancelEdit(index);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được nội dung');
    } finally {
      setRowBusyFlag(index, false);
    }
  }

  // Xoá 1 band ở lưới preview (hard-delete + re-index) — chỉ khả dụng lúc job 'ready'
  // (route tự chặn 409 nếu job đang chạy), dùng chung cờ busy với nút Chạy/Chọn file.
  async function removeItem(index: number) {
    if (!jobId) return;
    setError(null);
    setBusy(true);
    try {
      const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${jobId}/items/${index}`, {
        method: 'DELETE',
      });
      setItems(dto.items);
      setProgress(dto.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xoá được ảnh');
    } finally {
      setBusy(false);
    }
  }

  async function retryItem(index: number) {
    if (!jobId) return;
    setRowBusyFlag(index, true);
    try {
      const updated = await fetchJSON<ItemDTO>(`/api/jobs/${jobId}/items/${index}/retry`, {
        method: 'POST',
      });
      replaceItem(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thử lại thất bại');
    } finally {
      setRowBusyFlag(index, false);
    }
  }

  // Tạo storyboard (Stage 1.5) từ job hiện tại rồi chuyển sang trang biên tập nhịp.
  async function createStoryboard() {
    if (!jobId) return;
    setError(null);
    setSbBusy(true);
    try {
      await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`, { method: 'POST' });
      router.push(`/storyboard/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được storyboard');
      setSbBusy(false);
    }
  }

  // Nạp lại storyboard từ manifest JSON + ảnh nguồn (đường phục hồi sau restart).
  async function importStoryboard() {
    if (!importManifest || importImages.length === 0) {
      setError('Cần chọn manifest JSON và ảnh nguồn (hoặc PDF/zip) để nạp lại');
      return;
    }
    setError(null);
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append('manifest', importManifest);
      for (const f of importImages) {
        if (/\.zip$/i.test(f.name)) fd.append('zip', f);
        else fd.append('images', f);
      }
      const dto = await fetchJSON<StoryboardDTO>('/api/storyboard/import', {
        method: 'POST',
        body: fd,
      });
      router.push(`/storyboard/${dto.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không nạp lại được storyboard');
      setImportBusy(false);
    }
  }

  function resetAll() {
    esRef.current?.close();
    esRef.current = null;
    stopPolling();
    setJobId(null);
    setProgress(null);
    setItems([]);
    setDrafts({});
    setError(null);
  }

  const running =
    progress !== null && (progress.phase === 'queued' || progress.phase === 'processing');
  const isReady = progress?.phase === 'ready';
  const showResults = progress?.phase === 'done' || progress?.phase === 'failed';
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold">Manga Content Extractor</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Tải ảnh chapter (hoặc zip/PDF) → gộp thành một dải dọc rồi tự chia lại theo khoảng an toàn →
        trích xuất mô tả + thoại từng ảnh bằng vision LLM → sửa tay → xuất JSON.
      </p>

      {error && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 font-medium underline">
            Đóng
          </button>
        </div>
      )}

      {/* Khu upload */}
      {!jobId && (
        <section className="mt-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleSelection(e.dataTransfer.files);
            }}
            className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                : 'border-neutral-300 dark:border-neutral-700'
            }`}
          >
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {busy
                ? 'Đang tải lên & xử lý ảnh…'
                : 'Kéo thả ảnh (đánh số 1.jpg, 2.jpg, …), file .zip hoặc .pdf vào đây'}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <label className="cursor-pointer rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300">
                Chọn file
                <input
                  type="file"
                  multiple
                  accept="image/*,.zip,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleSelection(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="cursor-pointer rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                Chọn thư mục
                <input
                  type="file"
                  className="hidden"
                  // @ts-expect-error -- webkitdirectory: thuộc tính không chuẩn nhưng các trình duyệt đều hỗ trợ
                  webkitdirectory=""
                  onChange={(e) => {
                    if (e.target.files) handleSelection(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>

          {/* Nạp lại storyboard đã export (store in-memory mất khi restart) */}
          <details className="mt-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <summary className="cursor-pointer text-sm font-medium">
              Nạp lại storyboard từ manifest + ảnh
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              <label className="block text-xs font-medium text-neutral-500">
                Manifest storyboard (.json)
                <input
                  type="file"
                  accept=".json,application/json"
                  className="mt-1 block w-full text-sm"
                  onChange={(e) => setImportManifest(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="block text-xs font-medium text-neutral-500">
                Ảnh nguồn (đúng bộ ảnh phiên export — ảnh rời, .zip hoặc .pdf)
                <input
                  type="file"
                  multiple
                  accept="image/*,.zip,.pdf"
                  className="mt-1 block w-full text-sm"
                  onChange={(e) => setImportImages(e.target.files ? Array.from(e.target.files) : [])}
                />
              </label>
              <button
                onClick={importStoryboard}
                disabled={importBusy || !importManifest || importImages.length === 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {importBusy ? 'Đang nạp…' : 'Nạp lại storyboard'}
              </button>
            </div>
          </details>
        </section>
      )}

      {/* Xem trước — chưa gọi vision, chờ bấm Chạy */}
      {jobId && isReady && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <span className="text-sm font-medium">
              {items.length} ảnh — đã gộp thành dải dọc và chia lại theo khoảng an toàn
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                Nhịp
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={rpm}
                  onChange={(e) => setRpm(Math.min(600, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                  className="w-20 rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
                />
                req/phút
              </label>
              <button
                onClick={handleRun}
                disabled={busy || items.length === 0}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? 'Đang bắt đầu…' : `Chạy tất cả (${items.length} ảnh)`}
              </button>
              <button
                onClick={createStoryboard}
                disabled={sbBusy || items.length === 0}
                className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-950"
              >
                {sbBusy ? 'Đang tạo…' : 'Tạo storyboard'}
              </button>
              <button
                onClick={resetAll}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Chapter mới
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {[...items]
              .sort((a, b) => a.index - b.index)
              .map((item) => (
                // Key theo filename (band-N.jpg, ổn định khi xoá) chứ KHÔNG theo index: sau khi
                // deleteItem re-index, ô sống sót đổi src (/items/{idx}/image cũ→mới) nên trình
                // duyệt refetch đúng ảnh — key theo index sẽ giữ nguyên src string → hiện ảnh cũ.
                <figure key={item.filename} className="relative min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory, không dùng next/image */}
                  <img
                    src={item.imageUrl}
                    alt={item.filename}
                    className="aspect-[3/4] w-full rounded border border-neutral-200 object-contain dark:border-neutral-800"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.index)}
                    disabled={busy}
                    title="Xoá ảnh này"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs font-bold leading-none text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    ✕
                  </button>
                  <figcaption className="mt-1 truncate text-center text-xs text-neutral-500">
                    {item.index + 1}. {item.filename}
                  </figcaption>
                </figure>
              ))}
          </div>
        </section>
      )}

      {/* Tiến độ */}
      {jobId && progress && !isReady && (
        <section className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{phaseLabel(progress)}</span>
            <div className="flex items-center gap-3">
              {!running && (
                <>
                  <button
                    onClick={createStoryboard}
                    disabled={sbBusy}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {sbBusy ? 'Đang tạo…' : 'Tạo storyboard'}
                  </button>
                  <a
                    href={`/api/jobs/${jobId}/export`}
                    download
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                  >
                    Export JSON
                  </a>
                  <button
                    onClick={resetAll}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    Chapter mới
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className={`h-full rounded-full transition-all ${
                progress.phase === 'failed' ? 'bg-red-500' : 'bg-blue-600'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </section>
      )}

      {/* Bảng kết quả */}
      {showResults && items.length > 0 && (
        <section className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left dark:border-neutral-700">
                <th className="w-28 py-2 pr-4 font-semibold sm:w-36">Trang</th>
                <th className="py-2 font-semibold">Nội dung</th>
              </tr>
            </thead>
            <tbody>
              {[...items]
                .sort((a, b) => a.index - b.index)
                .map((item) => {
                  const draft = drafts[item.index];
                  const isBusy = rowBusy.has(item.index);
                  return (
                    <tr
                      key={item.index}
                      className="border-b border-neutral-200 align-top dark:border-neutral-800"
                    >
                      <td className="py-3 pr-4">
                        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory, không dùng next/image */}
                        <img
                          src={item.imageUrl}
                          alt={item.filename}
                          className="w-24 rounded border border-neutral-200 object-contain dark:border-neutral-800 sm:w-32"
                        />
                        <p className="mt-1 break-all text-xs text-neutral-500">{item.filename}</p>
                      </td>
                      <td className="py-3">
                        {item.error && (
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                              Lỗi: {item.error}
                            </span>
                            <button
                              onClick={() => retryItem(item.index)}
                              disabled={isBusy}
                              className="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                            >
                              {isBusy ? 'Đang thử…' : 'Thử lại'}
                            </button>
                          </div>
                        )}

                        {draft ? (
                          <div className="space-y-2">
                            <label className="block text-xs font-medium text-neutral-500">
                              Mô tả
                              <textarea
                                value={draft.description}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.index]: { ...draft, description: e.target.value },
                                  }))
                                }
                                rows={3}
                                className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
                              />
                            </label>
                            <label className="block text-xs font-medium text-neutral-500">
                              Thoại (mỗi dòng một câu)
                              <textarea
                                value={draft.dialogue}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.index]: { ...draft, dialogue: e.target.value },
                                  }))
                                }
                                rows={4}
                                className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
                              />
                            </label>
                            <label className="block text-xs font-medium text-neutral-500">
                              Ghi chú
                              <textarea
                                value={draft.note}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.index]: { ...draft, note: e.target.value },
                                  }))
                                }
                                rows={2}
                                className="mt-1 w-full rounded border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveEdit(item.index)}
                                disabled={isBusy}
                                className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                              >
                                {isBusy ? 'Đang lưu…' : 'Lưu'}
                              </button>
                              <button
                                onClick={() => cancelEdit(item.index)}
                                disabled={isBusy}
                                className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                              >
                                Hủy
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {item.content ? (
                              <>
                                <p className="whitespace-pre-wrap">{item.content.description}</p>
                                {item.content.dialogue.length > 0 && (
                                  <ul className="list-inside list-disc space-y-0.5 text-neutral-700 dark:text-neutral-300">
                                    {item.content.dialogue.map((line, k) => (
                                      <li key={k}>{line}</li>
                                    ))}
                                  </ul>
                                )}
                                {item.content.note && (
                                  <p className="text-xs italic text-neutral-500">
                                    Ghi chú: {item.content.note}
                                  </p>
                                )}
                              </>
                            ) : (
                              !item.error && (
                                <p className="text-xs italic text-neutral-400">Chưa có nội dung</p>
                              )
                            )}
                            <button
                              onClick={() => startEdit(item)}
                              className="rounded border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                            >
                              Sửa
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
