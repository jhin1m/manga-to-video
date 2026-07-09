'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageShell } from '@/components/page-shell';
import { useProject } from '@/components/project-context';
import { cn } from '@/lib/utils';
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
  const { publish, reset } = useProject();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [rowBusy, setRowBusy] = useState<Set<number>>(new Set());
  const [rpm, setRpm] = useState(30); // nhịp vision (req/phút) — chỉnh trước khi Chạy để tránh 429
  const [sbBusy, setSbBusy] = useState(false);
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
        toast.error('Mất kết nối với job (server có thể đã khởi động lại). Hãy chạy lại chapter.');
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
      toast.error(err instanceof Error ? err.message : 'Không tải được kết quả');
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
    const zips = toUpload.filter((f) => /\.zip$/i.test(f.name));
    if (zips.length > 1) {
      toast.error('Chỉ hỗ trợ 1 file zip mỗi lần chạy');
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
      publish({ jobId: dto.jobId, dirty: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tạo được job');
    } finally {
      setBusy(false);
    }
  }

  // Bước 2: kích hoạt vision cho toàn bộ trang (rate limit theo rpm) rồi theo dõi qua SSE.
  async function handleRun() {
    if (!jobId) return;
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
      toast.error(err instanceof Error ? err.message : 'Không chạy được job');
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
      toast.error(err instanceof Error ? err.message : 'Không lưu được nội dung');
    } finally {
      setRowBusyFlag(index, false);
    }
  }

  // Xoá 1 band ở lưới preview (hard-delete + re-index) — chỉ khả dụng lúc job 'ready'
  // (route tự chặn 409 nếu job đang chạy), dùng chung cờ busy với nút Chạy/Chọn file.
  async function removeItem(index: number) {
    if (!jobId) return;
    setBusy(true);
    try {
      const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${jobId}/items/${index}`, {
        method: 'DELETE',
      });
      setItems(dto.items);
      setProgress(dto.progress);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được ảnh');
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
      toast.error(err instanceof Error ? err.message : 'Thử lại thất bại');
    } finally {
      setRowBusyFlag(index, false);
    }
  }

  // Tạo storyboard (Stage 1.5) từ job hiện tại rồi chuyển sang trang biên tập nhịp.
  async function createStoryboard() {
    if (!jobId) return;
    setSbBusy(true);
    try {
      await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`, { method: 'POST' });
      publish({ hasStoryboard: true, dirty: true });
      router.push(`/storyboard/${jobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tạo được storyboard');
      setSbBusy(false);
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
    reset();
  }

  const running =
    progress !== null && (progress.phase === 'queued' || progress.phase === 'processing');
  const isReady = progress?.phase === 'ready';
  const showResults = progress?.phase === 'done' || progress?.phase === 'failed';
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <PageShell
      title="Trích xuất nội dung"
      subtitle="Tải ảnh chapter (hoặc zip/PDF) → gộp thành dải dọc rồi chia lại theo khoảng an toàn → trích xuất mô tả + thoại từng ảnh bằng vision LLM → sửa tay."
    >
      {/* Khu upload */}
      {!jobId && (
        <section>
          <Card
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
            className={cn(
              'border-2 border-dashed shadow-none transition-colors',
              dragging && 'border-primary bg-muted',
            )}
          >
            <CardContent className="py-10 text-center">
              <Upload className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground">
                {busy
                  ? 'Đang tải lên & xử lý ảnh…'
                  : 'Kéo thả ảnh (đánh số 1.jpg, 2.jpg, …), file .zip hoặc .pdf vào đây'}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <Button asChild>
                  <label className={cn('cursor-pointer', busy && 'pointer-events-none opacity-50')}>
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
                </Button>
                <Button asChild variant="outline">
                  <label className={cn('cursor-pointer', busy && 'pointer-events-none opacity-50')}>
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
                </Button>
              </div>
            </CardContent>
          </Card>

          <p className="mt-4 text-xs text-muted-foreground">
            Đã có phiên làm việc cũ? Dùng nút &quot;Mở project&quot; (.mtvproj) trên thanh công cụ.
          </p>
        </section>
      )}

      {/* Xem trước — chưa gọi vision, chờ bấm Chạy */}
      {jobId && isReady && (
        <section>
          <Card className="py-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
              <span className="text-sm font-medium">
                {items.length} ảnh — đã gộp thành dải dọc và chia lại theo khoảng an toàn
              </span>
              <div className="flex flex-wrap items-center gap-3">
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
                <Button onClick={handleRun} disabled={busy || items.length === 0}>
                  {busy ? 'Đang bắt đầu…' : `Chạy tất cả (${items.length} ảnh)`}
                </Button>
                <Button variant="ai" onClick={createStoryboard} disabled={sbBusy || items.length === 0}>
                  <Sparkles data-icon="inline-start" />
                  {sbBusy ? 'Đang tạo…' : 'Tạo storyboard'}
                </Button>
                <Button variant="outline" onClick={resetAll}>
                  Chapter mới
                </Button>
              </div>
            </CardContent>
          </Card>

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
                    className="aspect-[3/4] w-full rounded-lg border object-contain"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-xs"
                        onClick={() => removeItem(item.index)}
                        disabled={busy}
                        aria-label="Xoá ảnh này"
                        className="absolute right-1 top-1 rounded-full bg-black/60 text-white hover:bg-destructive hover:text-white"
                      >
                        <X />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Xoá ảnh này</TooltipContent>
                  </Tooltip>
                  <figcaption className="mt-1 truncate text-center text-xs text-muted-foreground">
                    {item.index + 1}. {item.filename}
                  </figcaption>
                </figure>
              ))}
          </div>
        </section>
      )}

      {/* Tiến độ */}
      {jobId && progress && !isReady && (
        <Card className="py-4">
          <CardContent className="px-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{phaseLabel(progress)}</span>
              <div className="flex items-center gap-2">
                {!running && (
                  <>
                    <Button variant="ai" onClick={createStoryboard} disabled={sbBusy}>
                      <Sparkles data-icon="inline-start" />
                      {sbBusy ? 'Đang tạo…' : 'Tạo storyboard'}
                    </Button>
                    <Button variant="success" asChild>
                      <a href={`/api/jobs/${jobId}/export`} download>
                        Export JSON
                      </a>
                    </Button>
                    <Button variant="outline" onClick={resetAll}>
                      Chapter mới
                    </Button>
                  </>
                )}
              </div>
            </div>
            <Progress
              value={pct}
              className={cn('mt-3', progress.phase === 'failed' && '[&>[data-slot=progress-indicator]]:bg-destructive')}
            />
          </CardContent>
        </Card>
      )}

      {/* Bảng kết quả */}
      {showResults && items.length > 0 && (
        <section className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 sm:w-36">Trang</TableHead>
                <TableHead>Nội dung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...items]
                .sort((a, b) => a.index - b.index)
                .map((item) => {
                  const draft = drafts[item.index];
                  const isBusy = rowBusy.has(item.index);
                  return (
                    <TableRow key={item.index} className="align-top hover:bg-transparent">
                      <TableCell className="py-3 pr-4">
                        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory, không dùng next/image */}
                        <img
                          src={item.imageUrl}
                          alt={item.filename}
                          className="w-24 rounded-lg border object-contain sm:w-32"
                        />
                        <p className="mt-1 break-all text-xs text-muted-foreground">{item.filename}</p>
                      </TableCell>
                      <TableCell className="whitespace-normal py-3">
                        {item.error && (
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge variant="destructive">Lỗi: {item.error}</Badge>
                            <Button
                              variant="destructive"
                              size="xs"
                              onClick={() => retryItem(item.index)}
                              disabled={isBusy}
                            >
                              {isBusy ? (
                                <Loader2 className="animate-spin" data-icon="inline-start" />
                              ) : (
                                <RotateCcw data-icon="inline-start" />
                              )}
                              {isBusy ? 'Đang thử…' : 'Thử lại'}
                            </Button>
                          </div>
                        )}

                        {draft ? (
                          <div className="space-y-2">
                            <label className="block text-xs font-medium text-muted-foreground">
                              Mô tả
                              <Textarea
                                value={draft.description}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.index]: { ...draft, description: e.target.value },
                                  }))
                                }
                                rows={3}
                                className="mt-1"
                              />
                            </label>
                            <label className="block text-xs font-medium text-muted-foreground">
                              Thoại (mỗi dòng một câu)
                              <Textarea
                                value={draft.dialogue}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.index]: { ...draft, dialogue: e.target.value },
                                  }))
                                }
                                rows={4}
                                className="mt-1"
                              />
                            </label>
                            <label className="block text-xs font-medium text-muted-foreground">
                              Ghi chú
                              <Textarea
                                value={draft.note}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [item.index]: { ...draft, note: e.target.value },
                                  }))
                                }
                                rows={2}
                                className="mt-1"
                              />
                            </label>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => saveEdit(item.index)} disabled={isBusy}>
                                {isBusy ? 'Đang lưu…' : 'Lưu'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => cancelEdit(item.index)}
                                disabled={isBusy}
                              >
                                Hủy
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {item.content ? (
                              <>
                                <p className="whitespace-pre-wrap">{item.content.description}</p>
                                {item.content.dialogue.length > 0 && (
                                  <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                                    {item.content.dialogue.map((line, k) => (
                                      <li key={k}>{line}</li>
                                    ))}
                                  </ul>
                                )}
                                {item.content.note && (
                                  <p className="text-xs italic text-muted-foreground">
                                    Ghi chú: {item.content.note}
                                  </p>
                                )}
                              </>
                            ) : (
                              !item.error && (
                                <p className="text-xs italic text-muted-foreground/70">
                                  Chưa có nội dung
                                </p>
                              )
                            )}
                            <Button size="sm" variant="outline" onClick={() => startEdit(item)}>
                              Sửa
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </section>
      )}
    </PageShell>
  );
}
