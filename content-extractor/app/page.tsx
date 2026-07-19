'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, FolderInput, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageShell } from '@/components/page-shell';
import { useProject } from '@/components/project-context';
import { cn } from '@/lib/utils';
import type { ItemDTO, JobStatusDTO, StoryboardDTO } from '@/lib/schema';

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

export default function Home() {
  const router = useRouter();
  const { publish, reset } = useProject();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [context, setContext] = useState(''); // ngữ cảnh chương — tiêm vào vision + biên kịch
  const savedContext = useRef(''); // bản đã PATCH lên server — chỉ gửi lại khi có thay đổi
  const [sbBusy, setSbBusy] = useState(false);
  const seriesInput = useRef<HTMLInputElement>(null); // file picker bible/summaries (series-memory)
  const [recapBusy, setRecapBusy] = useState(false);

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

  // Upload + downscale → job ở phase 'ready' và đứng yên đó; hiện lưới xem trước.
  // Vision không chạy ở trang này — "Generate all" nằm bên trang Storyboard.
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
    try {
      const dto = await fetchJSON<JobStatusDTO>('/api/jobs', { method: 'POST', body: fd });
      setJobId(dto.jobId);
      setItems(dto.items); // thumbnail xem trước, đúng thứ tự đọc
      setContext(dto.context);
      savedContext.current = dto.context;
      publish({ jobId: dto.jobId, dirty: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tạo được job');
    } finally {
      setBusy(false);
    }
  }

  // Lưu ngữ cảnh chương lên job (chỉ khi thay đổi). Gọi ở onBlur + ngay trước Tạo
  // storyboard. Trả false khi lưu hỏng để caller CHẶN hành động — không được chạy vision
  // với context cũ/rỗng trong khi người dùng tưởng bản vừa nhập đã ăn.
  async function saveContext(id: string): Promise<boolean> {
    if (context === savedContext.current) return true;
    try {
      const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      savedContext.current = dto.context;
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được ngữ cảnh chương');
      return false;
    }
  }

  // Nạp bible.md + summaries từ series folder (.mtv/) vào ngữ cảnh chương. App không biết
  // path trên đĩa (ingest qua upload) nên user tự chọn file; bible lên đầu, còn lại
  // natural-sort theo tên — khớp thứ tự chương. PATCH ngay với giá trị vừa ghép (không chờ
  // onBlur — file picker không làm textarea blur, reload trước khi lưu là mất).
  async function importSeriesContext(files: FileList | null) {
    if (!files || files.length === 0 || !jobId) return;
    const list = Array.from(files).sort((a, b) => {
      const bibleFirst = Number(!/bible/i.test(a.name)) - Number(!/bible/i.test(b.name));
      return (
        bibleFirst || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );
    });
    const texts = await Promise.all(list.map((f) => f.text()));
    let joined = texts
      .map((t) => t.trim())
      .filter(Boolean)
      .join('\n\n');
    if (joined.length > 16000) {
      // Trần khớp MAX_CONTEXT_LENGTH của PATCH route. Phần đuôi bị cắt là recap MỚI NHẤT
      // (bible đứng đầu, recap sort tăng dần) — vượt trần nghĩa là bible đã phình quá cap
      // 2000 từ của skill, phải gọt bible chứ đừng dựa vào cắt ở đây.
      joined = joined.slice(0, 16000);
      toast.warning('Ngữ cảnh vượt 16000 ký tự — đã cắt phần cuối (recap mới nhất), hãy gọt bible');
    }
    setContext(joined);
    try {
      const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: joined }),
      });
      savedContext.current = dto.context;
      toast.success(`Đã nạp ${list.length} file vào ngữ cảnh chương`);
    } catch (err) {
      // Giữ nguyên state local để user không mất nội dung — lưu lại qua onBlur/Tạo storyboard.
      toast.error(err instanceof Error ? err.message : 'Nạp xong nhưng chưa lưu được lên server');
    }
  }

  // Xuất recap chương (series-memory): server tóm script đã có → tải về .md để user tự
  // đặt vào <series>/.mtv/summaries/. Chưa có script → route trả lỗi rõ, chỉ toast.
  async function exportRecap() {
    if (!jobId) return;
    setRecapBusy(true);
    try {
      const { recap } = await fetchJSON<{ recap: string }>(
        `/api/jobs/${jobId}/storyboard/recap`,
        { method: 'POST' },
      );
      const url = URL.createObjectURL(new Blob([recap], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chapter-recap.md';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xuất được recap');
    } finally {
      setRecapBusy(false);
    }
  }

  // Xoá 1 band ở lưới preview (hard-delete + re-index) — route tự chặn 409 nếu job
  // đang chạy, dùng chung cờ busy với upload.
  async function removeItem(index: number) {
    if (!jobId) return;
    setBusy(true);
    try {
      const dto = await fetchJSON<JobStatusDTO>(`/api/jobs/${jobId}/items/${index}`, {
        method: 'DELETE',
      });
      setItems(dto.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không xoá được ảnh');
    } finally {
      setBusy(false);
    }
  }

  // Tạo storyboard từ job hiện tại rồi chuyển sang trang biên tập nhịp.
  async function createStoryboard() {
    if (!jobId) return;
    setSbBusy(true);
    try {
      // Generate/kịch bản phía sau đều đọc context từ job — lưu hỏng thì dừng tại đây.
      if (!(await saveContext(jobId))) {
        setSbBusy(false);
        return;
      }
      await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`, { method: 'POST' });
      publish({ hasStoryboard: true, dirty: true });
      router.push(`/storyboard/${jobId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tạo được storyboard');
      setSbBusy(false);
    }
  }

  function resetAll() {
    setJobId(null);
    setItems([]);
    setContext('');
    savedContext.current = '';
    reset();
  }

  return (
    <PageShell
      title="Nhận chapter"
      subtitle="Tải ảnh chapter (hoặc zip/PDF) → gộp thành dải dọc rồi chia lại theo khoảng an toàn → xoá band thừa, nhập ngữ cảnh → tạo storyboard."
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

      {/* Xem trước band + ngữ cảnh chương — job đứng ở 'ready', vision chạy bên Storyboard.
          Gate theo jobId (không theo items.length): xoá hết band vẫn còn "Chapter mới" để thoát. */}
      {jobId && (
        <section>
          <Card className="py-4">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
              <span className="text-sm font-medium">
                {items.length} ảnh — đã gộp thành dải dọc và chia lại theo khoảng an toàn
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ai" onClick={createStoryboard} disabled={sbBusy || items.length === 0}>
                  <Sparkles data-icon="inline-start" />
                  {sbBusy ? 'Đang tạo…' : 'Tạo storyboard'}
                </Button>
                <Button variant="outline" onClick={resetAll}>
                  Chapter mới
                </Button>
              </div>
            </CardContent>
            <CardContent className="px-4">
              <label className="block text-xs font-medium text-muted-foreground">
                Nhân vật &amp; bối cảnh chương (tuỳ chọn — giúp gọi đúng tên nhân vật và xưng hô
                khi dịch thoại, dùng cho cả Generate lẫn kịch bản)
                <Textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  onBlur={() => void saveContext(jobId)}
                  rows={3}
                  maxLength={16000}
                  placeholder="Ví dụ: Lâm Phong — nam chính, đệ tử ngoại môn. Tô Nhược — nữ, sư tỷ của Lâm Phong. Bối cảnh: tông môn tu tiên."
                  className="mt-1"
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  ref={seriesInput}
                  type="file"
                  accept=".md,.txt"
                  multiple
                  hidden
                  onChange={(e) => {
                    void importSeriesContext(e.target.files);
                    e.target.value = ''; // cho phép chọn lại cùng bộ file
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => seriesInput.current?.click()}>
                  <FolderInput data-icon="inline-start" />
                  Nạp series context
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={exportRecap} disabled={recapBusy}>
                      <Download data-icon="inline-start" />
                      {recapBusy ? 'Đang tóm…' : 'Xuất recap chương'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Tóm kịch bản đã tạo thành recap ≤250 từ — tải về đặt vào
                    &lt;series&gt;/.mtv/summaries/
                  </TooltipContent>
                </Tooltip>
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
    </PageShell>
  );
}
