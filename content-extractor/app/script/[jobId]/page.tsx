'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ArrowRight, Check, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageShell } from '@/components/page-shell';
import { useProject } from '@/components/project-context';
import type { ScriptDTO, StoryboardDTO } from '@/lib/schema';

// Trang duyệt kịch bản AI (Stage 2): hiện ScriptSegment[] đề xuất, cho gộp/tách/sửa/xoá/
// re-order, cảnh báo band bỏ sót, chốt "Xác nhận kịch bản" → mở "Dựng video".
// AI đề xuất — người quyết. Tách khỏi trang storyboard: tự fetch storyboard (cần working
// cho thumbnail shot + cảnh báo band sót) như trang video.

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message ?? `Lỗi HTTP ${res.status}`);
  }
  return data as T;
}

export default function ScriptPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const { publish } = useProject();
  const [storyboard, setStoryboard] = useState<StoryboardDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [script, setScript] = useState<ScriptDTO | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // segId → narration đang sửa

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = await fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`);
        if (cancelled) return;
        setStoryboard(sb);
        let confirmed = false;
        try {
          const sc = await fetchJSON<ScriptDTO>(`/api/jobs/${jobId}/storyboard/script`);
          if (cancelled) return;
          setScript(sc);
          confirmed = sc.confirmed;
        } catch {
          // 404 = chưa có kịch bản — trang chỉ hiện nút tạo
        }
        publish({
          jobId: sb.jobId,
          hasStoryboard: true,
          storyboardDone: sb.progress.phase === 'done' && sb.beats.length > 0,
          scriptConfirmed: confirmed,
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Không tải được storyboard');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, publish]);

  const storyboardReady =
    storyboard !== null &&
    storyboard.progress.phase === 'done' &&
    storyboard.beats.length > 0;

  async function generate() {
    setGenerating(true);
    try {
      setScript(
        await fetchJSON<ScriptDTO>(`/api/jobs/${jobId}/storyboard/script`, { method: 'POST' }),
      );
      setDrafts({});
      publish({ scriptConfirmed: false, dirty: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Tạo kịch bản thất bại');
    } finally {
      setGenerating(false);
    }
  }

  // Mọi mutator trả về ScriptDTO đầy đủ → thay state một phát. Trả về true/false để
  // caller (saveDraft) chỉ đóng draft khi lưu THÀNH CÔNG — lỗi thì giữ text người gõ.
  async function op(path: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    try {
      const next = await fetchJSON<ScriptDTO>(`/api/jobs/${jobId}/storyboard/script/${path}`, init);
      setScript(next);
      publish({ scriptConfirmed: next.confirmed, dirty: true });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Thao tác thất bại');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(segId: string) {
    const narration = drafts[segId];
    if (narration === undefined) return;
    const saved = await op(`segments/${segId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narration }),
    });
    if (!saved) return;
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[segId];
      return next;
    });
  }

  if (loadError) {
    return (
      <PageShell title="Kịch bản AI">
        <p className="text-sm text-destructive">{loadError}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Cần storyboard trước — hoặc dùng &quot;Mở project&quot; (.mtvproj) nếu server vừa khởi
          động lại.
        </p>
        <Button className="mt-4" onClick={() => router.push('/')}>
          Về trang chính
        </Button>
      </PageShell>
    );
  }

  if (!storyboard) {
    return (
      <PageShell title="Kịch bản AI">
        <p className="text-sm text-muted-foreground">Đang tải…</p>
      </PageShell>
    );
  }

  const segments = script ? [...script.segments].sort((a, b) => a.order - b.order) : [];

  // Cảnh báo count-mismatch: band nào chưa vào kịch bản.
  const covered = new Set(segments.flatMap((s) => s.shots.map((sh) => sh.sourceIndex)));
  const missing = storyboard.working.filter((w) => !covered.has(w.sourceIndex));

  return (
    <PageShell
      title="Kịch bản AI"
      subtitle="AI biên kịch gộp/tách band thành đoạn kể mạch lạc — duyệt/sửa tay rồi Xác nhận để dựng video."
      actions={
        <>
          <Button
            variant="ai"
            onClick={generate}
            disabled={generating || busy || !storyboardReady}
            title={storyboardReady ? undefined : 'Chờ storyboard compose xong'}
          >
            <Sparkles data-icon="inline-start" />
            {generating ? 'Đang biên kịch…' : script ? 'Tạo lại kịch bản' : 'Tạo kịch bản AI'}
          </Button>
          {script && !script.confirmed && (
            <Button
              variant="success"
              onClick={() => op('confirm', { method: 'POST' })}
              disabled={busy || generating || segments.length === 0}
            >
              <Check data-icon="inline-start" />
              Xác nhận kịch bản
            </Button>
          )}
          {script?.confirmed && (
            <Button onClick={() => router.push(`/video/${jobId}`)}>
              Dựng video
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </>
      }
    >
      {script && missing.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Band chưa vào kịch bản: {missing.map((w) => `#${w.sourceIndex + 1}`).join(', ')} — sửa
          tay hoặc Tạo lại trước khi dựng video.
        </div>
      )}

      {script?.confirmed && (
        <p className="mb-4 text-sm font-medium text-success">
          ✓ Kịch bản đã chốt — sửa bất kỳ đoạn nào sẽ cần xác nhận lại.
        </p>
      )}

      {!script && !generating && (
        <p className="text-sm italic text-muted-foreground">
          Chưa có kịch bản. Bấm &ldquo;Tạo kịch bản AI&rdquo; để model biên kịch đọc nội dung mọi
          band và đề xuất đoạn kể.
        </p>
      )}

      <ol className="space-y-4">
        {segments.map((seg, i) => {
          const draft = drafts[seg.id];
          return (
            <li key={seg.id}>
              <Card className="py-4">
                <CardContent className="px-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">Đoạn {seg.order + 1}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {seg.shots.length} shot
                      {seg.durationHint !== undefined && ` · ~${seg.durationHint}s`}
                    </span>
                    {seg.edited && <Badge variant="outline">Đã sửa</Badge>}
                  </div>

                  {/* Dải thumbnail shots — mỗi shot một band, nút tách tại biên shot */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {seg.shots.map((shot, si) => (
                      <div key={`${seg.id}-${si}`} className="flex items-center gap-2">
                        {si > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon-xs"
                                aria-label="Tách đoạn tại đây"
                                disabled={busy || generating}
                                onClick={() =>
                                  op('segments/split', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ segId: seg.id, atShotIndex: si }),
                                  })
                                }
                              >
                                <Scissors />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Tách đoạn tại đây</TooltipContent>
                          </Tooltip>
                        )}
                        <figure className="w-20">
                          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory */}
                          <img
                            src={`/api/jobs/${jobId}/storyboard/working/${shot.sourceIndex}/image`}
                            alt={`Band ${shot.sourceIndex + 1}`}
                            className="max-h-28 w-full rounded border object-contain"
                          />
                          <figcaption className="mt-0.5 text-center text-[10px] text-muted-foreground">
                            band #{shot.sourceIndex + 1}
                          </figcaption>
                        </figure>
                      </div>
                    ))}
                  </div>

                  {draft !== undefined ? (
                    <div className="mt-3 space-y-2">
                      <Textarea
                        value={draft}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [seg.id]: e.target.value }))
                        }
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveDraft(seg.id)} disabled={busy}>
                          Lưu
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[seg.id];
                              return next;
                            })
                          }
                        >
                          Hủy
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {seg.narration ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm">{seg.narration}</p>
                      ) : (
                        <p className="mt-3 text-xs italic text-muted-foreground">
                          Chưa có lời kể — sửa tay (đoạn vừa tách).
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || generating}
                          onClick={() =>
                            setDrafts((prev) => ({ ...prev, [seg.id]: seg.narration }))
                          }
                        >
                          Sửa
                        </Button>
                        {i < segments.length - 1 && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || generating}
                            onClick={() =>
                              op('segments/merge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ segIds: [seg.id, segments[i + 1].id] }),
                              })
                            }
                          >
                            Gộp với đoạn dưới
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Chuyển đoạn lên"
                          disabled={busy || generating || i === 0}
                          onClick={() =>
                            op('segments/reorder', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ segId: seg.id, to: seg.order - 1 }),
                            })
                          }
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Chuyển đoạn xuống"
                          disabled={busy || generating || i === segments.length - 1}
                          onClick={() =>
                            op('segments/reorder', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ segId: seg.id, to: seg.order + 1 }),
                            })
                          }
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy || generating}
                          onClick={() => op(`segments/${seg.id}`, { method: 'DELETE' })}
                        >
                          <Trash2 data-icon="inline-start" />
                          Xoá
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </PageShell>
  );
}
