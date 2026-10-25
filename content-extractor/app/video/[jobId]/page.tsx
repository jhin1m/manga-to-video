'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, Download, Film, Package, Pause, Play, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { PageShell } from '@/components/page-shell';
import { SubtitlePanel } from '@/components/video/subtitle-panel';
import { useProject } from '@/components/project-context';
import { useReducedMotion } from '@/components/use-reduced-motion';
import { readNdjsonBody } from '@/lib/ndjson-client';
import type {
  DefaultMotion,
  FillMode,
  JobStatusDTO,
  RenderConfig,
  ScriptDTO,
  StoryboardDTO,
} from '@/lib/schema';
import { defaultRenderConfig } from '@/lib/schema';
import { defaultFill, planKenburns, resolveShotMotion } from '@/lib/kenburns';
import { ASPECT_CSS, kenburnsFrameStyle } from '@/lib/kenburns-css';
import {
  allocateCaptions,
  buildTimeline,
  formatCaption,
  splitSentences,
  TIMELINE_DEFAULTS,
} from '@/lib/timeline';
import { toPreviewCss } from '@/lib/subtitle-style';
import {
  getOutputLanguage,
  normalizeOutputLanguage,
  type OutputLanguage,
} from '@/lib/output-language';
import { TTS_PROVIDER_OPTIONS, voicesForLang } from '@/lib/tts-providers/catalog';

// Dòng NDJSON từ route render — khai type ở client (không import runtime Node của lib/render.ts
// vào bundle trình duyệt). Progress phase + dòng done (kèm URL results.zip) + dòng error.
type RenderLine =
  | { phase: 'tts' | 'timeline' | 'shot' | 'concat' | 'audio' | 'bgm' | 'subs' | 'mux'; i?: number; n?: number }
  | { done: true; totalSec: number; downloads: { zip: string } }
  | { error: string };

// Nhãn tiếng Việt cho từng pha render (shot ghép thêm i/n động).
const RENDER_PHASE_LABEL: Record<string, string> = {
  tts: 'Tổng hợp giọng',
  timeline: 'Dựng timeline',
  concat: 'Ghép cảnh',
  audio: 'Trộn tiếng',
  bgm: 'Trộn nhạc nền',
  subs: 'Khắc phụ đề',
  mux: 'Đóng gói MP4',
};

// Sentinel dropdown provider: Radix Select cấm value="" — dùng 'env' đại diện "Theo ENV",
// map về '' khi lưu (rỗng = lấy TTS_PROVIDER lúc synth).
const TTS_PROVIDER_ENV = 'env';

// Preview UI video (Stage 2): phát duyệt kịch bản dạng video — Ken Burns XẤP XỈ bằng CSS,
// phụ đề chỉnh live, BGM + khung hình. Hai chế độ: im lặng (durationHint, free) và có audio
// (synth TTS → timing thật). MP4 do engine render (in-app "Render MP4" hoặc CLI, chung
// lib/render.ts) mới là chân lý — preview CSS chỉ xấp xỉ.

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message ?? `Lỗi HTTP ${res.status}`);
  }
  return data as T;
}

interface TtsResult {
  segId: string;
  durationSec: number;
  audioUrl: string | null;
  error?: string;
}

export default function VideoPreviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const { publish } = useProject();
  const [storyboard, setStoryboard] = useState<StoryboardDTO | null>(null);
  const [script, setScript] = useState<ScriptDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Ngôn ngữ lời kể của job → lọc giọng CapCut. Server tự đổi giọng sai ngôn ngữ khi synth;
  // UI lọc để người dùng thấy đúng giọng sẽ được dùng.
  const [jobLang, setJobLang] = useState<OutputLanguage>('vi');
  const [config, setConfig] = useState<RenderConfig>(defaultRenderConfig);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [audioMode, setAudioMode] = useState(false);
  const [synthBusy, setSynthBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderPhase, setRenderPhase] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<{ i: number; n: number } | null>(null);
  const [renderZipUrl, setRenderZipUrl] = useState<string | null>(null);
  const renderAcRef = useRef<AbortController | null>(null);
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [bgmUrl, setBgmUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeSec, setTimeSec] = useState(0);
  const reducedMotion = useReducedMotion();
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeSegRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sb, sc] = await Promise.all([
          fetchJSON<StoryboardDTO>(`/api/jobs/${jobId}/storyboard`),
          fetchJSON<ScriptDTO>(`/api/jobs/${jobId}/storyboard/script`),
        ]);
        if (cancelled) return;
        setStoryboard(sb);
        setScript(sc);
        // Lấy riêng, KHÔNG chặn trang: lỗi chỉ làm dropdown giọng không lọc ('vi' như cũ).
        fetchJSON<JobStatusDTO>(`/api/jobs/${jobId}`)
          .then((job) => {
            if (!cancelled) setJobLang(normalizeOutputLanguage(job.outputLanguage));
          })
          .catch(() => {});
        // Stepper: vào thẳng trang này (vd sau khi Mở project) vẫn biết các bước trước đã xong.
        publish({
          jobId: sb.jobId,
          hasStoryboard: true,
          storyboardDone: sb.progress.phase === 'done',
          scriptConfirmed: sc.confirmed,
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Không tải được dữ liệu');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, publish]);

  const segments = useMemo(
    () => (script ? [...script.segments].sort((a, b) => a.order - b.order) : []),
    [script],
  );

  // Timeline: im lặng dùng durationHint; audio mode dùng giây TTS thật (đã synth).
  const timeline = useMemo(
    () => buildTimeline(segments, audioMode ? durations : {}, config),
    [segments, audioMode, durations, config],
  );

  // Playback clock bằng rAF.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      const last = lastTsRef.current ?? ts;
      lastTsRef.current = ts;
      setTimeSec((t) => {
        const next = t + (ts - last) / 1000;
        if (next >= timeline.totalSec) {
          setPlaying(false);
          return timeline.totalSec;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [playing, timeline.totalSec]);

  const currentSeg = timeline.segments.find((s) => timeSec >= s.start && timeSec < s.end) ??
    timeline.segments[timeline.segments.length - 1];
  const currentShot =
    currentSeg?.shots.find((sh) => timeSec >= sh.start && timeSec < sh.end) ??
    currentSeg?.shots[currentSeg.shots.length - 1];
  const currentScriptSeg = segments.find((s) => s.id === currentSeg?.segId);

  // Audio segment: đổi src khi sang đoạn mới; volume BGM duck khi có narration đang phát.
  useEffect(() => {
    const audio = narrationAudioRef.current;
    if (!audio) return;
    if (!playing || !audioMode || !currentSeg) {
      audio.pause();
      activeSegRef.current = null;
      return;
    }
    const url = audioUrls[currentSeg.segId];
    if (!url) {
      audio.pause();
      activeSegRef.current = null;
      return;
    }
    if (activeSegRef.current !== currentSeg.segId) {
      activeSegRef.current = currentSeg.segId;
      audio.src = url;
      audio.currentTime = Math.max(0, timeSec - currentSeg.start - TIMELINE_DEFAULTS.padHeadSec);
      void audio.play().catch(() => {});
    } else if (audio.paused) {
      void audio.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- đồng bộ theo đoạn/chế độ, không theo từng tick
  }, [playing, audioMode, currentSeg?.segId, audioUrls]);

  // BGM: phát khi playing; duck đơn giản bằng hạ volume khi narration active (duck chuẩn do CLI).
  useEffect(() => {
    const bgm = bgmAudioRef.current;
    if (!bgm) return;
    if (!playing || !bgmUrl) {
      bgm.pause();
      return;
    }
    const narrationActive =
      audioMode && currentSeg !== undefined && audioUrls[currentSeg.segId] !== undefined;
    const duckFactor = narrationActive ? Math.pow(10, config.bgm.duckDb / 20) : 1;
    bgm.volume = Math.max(0, Math.min(1, config.bgm.volume * duckFactor));
    if (bgm.paused) void bgm.play().catch(() => {});
  }, [playing, bgmUrl, audioMode, currentSeg, audioUrls, config.bgm]);

  async function synthAudio() {
    setSynthBusy(true);
    try {
      const { results } = await fetchJSON<{ results: TtsResult[] }>(
        `/api/jobs/${jobId}/storyboard/tts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(config.tts.provider ? { provider: config.tts.provider } : {}),
            ...(config.tts.voiceId ? { voiceId: config.tts.voiceId } : {}),
            ...(config.tts.model ? { model: config.tts.model } : {}),
          }),
        },
      );
      const nextDurations: Record<string, number> = {};
      const nextUrls: Record<string, string> = {};
      const failed: string[] = [];
      for (const r of results) {
        nextDurations[r.segId] = r.durationSec;
        if (r.audioUrl) nextUrls[r.segId] = r.audioUrl;
        if (r.error) failed.push(r.error);
      }
      setDurations(nextDurations);
      setAudioUrls(nextUrls);
      setAudioMode(true);
      setTimeSec(0);
      publish({ dirty: true }); // audio mới synth chưa nằm trong file .mtvproj đã lưu
      if (failed.length > 0) {
        toast.error(`${failed.length} đoạn synth lỗi (giữ durationHint): ${failed[0]}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Synth audio thất bại');
    } finally {
      setSynthBusy(false);
    }
  }

  async function exportBundle() {
    setExportBusy(true);
    try {
      const fd = new FormData();
      fd.append('config', JSON.stringify(config));
      if (bgmFile) fd.append('bgm', bgmFile);
      const res = await fetch(`/api/jobs/${jobId}/storyboard/export-bundle`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Lỗi HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bundle-${jobId}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export bundle thất bại');
    } finally {
      setExportBusy(false);
    }
  }

  // Tải file qua thẻ <a download> (results.zip là attachment từ output route). 1 file → không lo
  // trình duyệt chặn multi-download.
  function triggerDownload(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Render MP4 server-side: POST multipart (config + bgm) → đọc NDJSON progress → khi done tự tải
  // results.zip. Hủy giữa chừng bằng renderAcRef (abort fetch → server kill ffmpeg).
  async function renderVideo() {
    const ac = new AbortController();
    renderAcRef.current = ac;
    setRenderBusy(true);
    setRenderPhase(null);
    setRenderProgress(null);
    setRenderZipUrl(null);
    let hadError: string | null = null;
    try {
      const fd = new FormData();
      fd.append('config', JSON.stringify(config));
      if (bgmFile) fd.append('bgm', bgmFile);
      const res = await fetch(`/api/jobs/${jobId}/storyboard/render`, {
        method: 'POST',
        body: fd,
        signal: ac.signal,
      });
      if (res.status === 409) {
        toast.error('Đang render job này — đợi lượt hiện tại xong.');
        return;
      }
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Lỗi HTTP ${res.status}`);
      }
      await readNdjsonBody(res.body, (line) => {
        const ev = line as RenderLine;
        if ('error' in ev) {
          hadError = ev.error;
          return;
        }
        if ('done' in ev) {
          setRenderZipUrl(ev.downloads.zip);
          triggerDownload(ev.downloads.zip);
          return;
        }
        setRenderPhase(ev.phase);
        // tts + shot mang i/n → thanh tiến trình; các pha còn lại giữ mức cũ.
        if ((ev.phase === 'shot' || ev.phase === 'tts') && typeof ev.i === 'number' && typeof ev.n === 'number') {
          setRenderProgress({ i: ev.i, n: ev.n });
        }
      });
      if (hadError) toast.error(hadError);
      else toast.success('Render xong — results.zip (MP4 + .srt + .timeline) đang tải về.');
    } catch (err) {
      // Người dùng bấm Hủy → fetch abort ném AbortError: nuốt, không toast lỗi giả.
      if (!(err instanceof Error && err.name === 'AbortError')) {
        toast.error(err instanceof Error ? err.message : 'Render thất bại');
      }
    } finally {
      setRenderBusy(false);
      setRenderPhase(null);
      setRenderProgress(null);
      renderAcRef.current = null;
    }
  }

  function cancelRender() {
    renderAcRef.current?.abort();
  }

  if (loadError) {
    return (
      <PageShell title="Dựng video">
        <p className="text-sm text-destructive">{loadError}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Cần storyboard + kịch bản đã tạo ở trang storyboard trước.
        </p>
        <Button className="mt-4" onClick={() => router.push(`/storyboard/${jobId}`)}>
          Về trang storyboard
        </Button>
      </PageShell>
    );
  }

  if (!storyboard || !script) {
    return (
      <PageShell title="Dựng video">
        <p className="text-sm text-muted-foreground">Đang tải…</p>
      </PageShell>
    );
  }

  if (!script.confirmed) {
    return (
      <PageShell title="Dựng video">
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Kịch bản chưa được xác nhận — duyệt và bấm &ldquo;Xác nhận kịch bản&rdquo; trước.
        </p>
        <Button className="mt-4" onClick={() => router.push(`/storyboard/${jobId}`)}>
          Về trang storyboard
        </Button>
      </PageShell>
    );
  }

  // ==== Khung hình + Ken Burns CSS (xấp xỉ) ====
  // Chưa chọn cách lấp khung → theo aspect (9:16 lấp kín, khung khác nền blur), khớp lib/render.ts.
  const fillMode = config.kenburns.fill ?? defaultFill(config.aspect);
  const working = currentShot
    ? storyboard.working.find((w) => w.sourceIndex === currentShot.sourceIndex)
    : undefined;
  let imgTransformStyle: React.CSSProperties = {};
  let fgStyle: React.CSSProperties = {};
  if (currentShot && working && currentSeg) {
    const shotDur = Math.max(0.001, currentShot.end - currentShot.start);
    const p = reducedMotion
      ? 0
      : Math.max(0, Math.min(1, (timeSec - currentShot.start) / shotDur));
    const plan = planKenburns({
      imgW: working.width,
      imgH: working.height,
      region: currentShot.region,
      motion: resolveShotMotion(currentShot.motion, config.kenburns.motion),
      aspect: config.aspect,
      durationSec: shotDur,
      fps: config.fps,
      zoom: config.kenburns.zoom,
      fill: fillMode,
    });
    ({ fgStyle, imgTransformStyle } = kenburnsFrameStyle(plan, p, config.kenburns.zoom));
  }
  // Shot có region → xin route ảnh cắt sẵn, để <img> có intrinsic size ĐÚNG BẰNG region.
  // Nếu phát ảnh nguyên band rồi để CSS lo thì preview vẽ cả band trong khi render chỉ vẽ
  // mảnh — lệch hệt kiểu preview pan trước đây, chỉ khác là lệch cả nội dung.
  const r = currentShot?.region;
  const shotImageUrl = working
    ? r
      ? `${working.imageUrl}?x=${r.x}&y=${r.y}&w=${r.w}&h=${r.h}`
      : working.imageUrl
    : '';

  // Caption hiện theo CÂU (dùng chung logic tách câu + canh giờ với toSrt của CLI).
  let caption: string | null = null;
  if (currentSeg && currentScriptSeg?.narration.trim()) {
    const caps = allocateCaptions(
      splitSentences(currentScriptSeg.narration),
      currentSeg.start,
      currentSeg.end,
    );
    caption = caps.find((c) => timeSec >= c.start && timeSec < c.end)?.text ?? null;
  }
  const sub = config.subtitles;
  // Provider có catalog giọng (CapCut) → render dropdown giọng (chỉ giọng đúng ngôn ngữ job) +
  // ẩn model; provider khác/rỗng → 2 ô text voiceId/model như cũ.
  const capcutVoices = voicesForLang(config.tts.provider, jobLang);
  const langLabel = getOutputLanguage(jobLang).label;
  // Giọng đã lưu trong config nhưng không đọc được ngôn ngữ job (vd project cũ chọn giọng Việt
  // rồi job là en) — server (pickVoiceForLang) thay bằng giọng ĐẦU của ngôn ngữ đó, UI báo trước.
  const voiceMismatch =
    !!capcutVoices && !!config.tts.voiceId && !capcutVoices.some((v) => v.id === config.tts.voiceId);

  const set = <K extends keyof RenderConfig>(key: K, value: RenderConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  return (
    <PageShell
      title="Dựng video"
      subtitle="Preview XẤP XỈ (CSS) để duyệt bố cục/timing/style — bấm Render MP4 để dựng bản chuẩn (engine ffmpeg, chung với CLI)."
      actions={
        <>
          <Button variant="ai" onClick={synthAudio} disabled={synthBusy || renderBusy}>
            <Sparkles data-icon="inline-start" />
            {synthBusy ? 'Đang synth…' : audioMode ? 'Synth lại audio' : 'Synth audio (timing thật)'}
          </Button>
          <Button onClick={renderVideo} disabled={renderBusy}>
            <Film data-icon="inline-start" />
            {renderBusy ? 'Đang render…' : 'Render MP4'}
          </Button>
          <Button variant="outline" onClick={() => router.push(`/script/${jobId}`)}>
            Kịch bản
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                Nâng cao
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onSelect={() => void exportBundle()} disabled={exportBusy}>
                <Package />
                {exportBusy ? 'Đang đóng gói…' : 'Export bundle zip (render máy khác / batch)'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="font-normal">Hoặc render bằng CLI:</DropdownMenuLabel>
              <div className="px-1.5 pb-1">
                <code className="block rounded bg-muted px-1 py-0.5 text-[11px] break-all">
                  npm run render -- bundle-{jobId}.zip --aspect {config.aspect}
                </code>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Player — giữ nguyên khung containerType/cqw/cqh (Ken Burns phụ thuộc) */}
        <section className="flex-1">
          <div
            className="relative mx-auto max-h-[70vh] overflow-hidden rounded-lg bg-black"
            style={{
              aspectRatio: ASPECT_CSS[config.aspect],
              containerType: 'size',
            }}
          >
            {working && (
              <div className="absolute inset-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory */}
                <img
                  src={shotImageUrl}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl"
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- ảnh từ store in-memory */}
                <img
                  src={shotImageUrl}
                  alt={`Band ${currentShot?.sourceIndex}`}
                  className="relative"
                  style={{ ...fgStyle, ...imgTransformStyle, margin: '0 auto' }}
                />
              </div>
            )}
            {caption && (
              // Lề ngang lấy từ sideMarginPct (đi thẳng vào MarginL/R của ASS lúc render), chữ
              // và mọi hiệu ứng lấy từ toPreviewCss — cùng nguồn với force_style của burn-in.
              <div
                className="pointer-events-none absolute inset-x-0 flex"
                style={{
                  ...(sub.position === 'top'
                    ? { top: `${sub.marginPct}cqh` }
                    : sub.position === 'middle'
                      ? { top: '50%', transform: 'translateY(-50%)' }
                      : { bottom: `${sub.marginPct}cqh` }),
                  justifyContent: 'center',
                  paddingInline: `${sub.sideMarginPct}cqw`,
                }}
              >
                <span className="text-center leading-tight" style={toPreviewCss(sub)}>
                  {formatCaption(caption, sub)}
                </span>
              </div>
            )}
            <Badge className="absolute left-2 top-2 bg-black/60 text-white">
              Preview xấp xỉ · {audioMode ? 'audio thật' : 'im lặng (ước lượng)'}
            </Badge>
          </div>

          {/* Transport */}
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={() => {
                if (timeSec >= timeline.totalSec) setTimeSec(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
              {playing ? 'Dừng' : 'Phát'}
            </Button>
            <Slider
              min={0}
              max={timeline.totalSec}
              step={0.05}
              value={[Math.min(timeSec, timeline.totalSec)]}
              onValueChange={([v]) => {
                setTimeSec(v);
                activeSegRef.current = null; // seek → nạp lại audio đoạn hiện tại
              }}
              className="flex-1"
            />
            <span className="w-28 text-right text-xs tabular-nums text-muted-foreground">
              {timeSec.toFixed(1)}s / {timeline.totalSec.toFixed(1)}s
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Đoạn {currentScriptSeg ? currentScriptSeg.order + 1 : '–'}/{segments.length}
            {currentShot && ` · band #${currentShot.sourceIndex + 1}`}
            {reducedMotion && ' · (giảm chuyển động theo cài đặt hệ thống)'}
          </p>

          {/* Tiến trình render server-side (theo shot) + nút Hủy */}
          {renderBusy && (
            <div className="mt-3 space-y-2 rounded-lg border border-border bg-card/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">
                  {renderPhase === 'shot' && renderProgress
                    ? `Render cảnh ${renderProgress.i}/${renderProgress.n}`
                    : renderPhase
                      ? (RENDER_PHASE_LABEL[renderPhase] ?? renderPhase)
                      : 'Chuẩn bị…'}
                </span>
                <Button size="xs" variant="outline" onClick={cancelRender}>
                  <X data-icon="inline-start" />
                  Hủy
                </Button>
              </div>
              <Progress
                value={renderProgress ? Math.round((renderProgress.i / renderProgress.n) * 100) : 0}
              />
            </div>
          )}
          {!renderBusy && renderZipUrl && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Đã render xong.</span>
              <Button size="xs" variant="outline" onClick={() => triggerDownload(renderZipUrl)}>
                <Download data-icon="inline-start" />
                Tải lại results.zip
              </Button>
            </div>
          )}

          <audio ref={narrationAudioRef} hidden />
          {bgmUrl && <audio ref={bgmAudioRef} src={bgmUrl} loop hidden />}
        </section>

        {/* Panel điều khiển */}
        <aside className="w-full space-y-4 lg:w-80">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Khung hình</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <div className="flex items-center gap-2">
                {(['9:16', '16:9', '1:1'] as const).map((a) => (
                  <Button
                    key={a}
                    size="xs"
                    variant={config.aspect === a ? 'default' : 'outline'}
                    onClick={() => set('aspect', a)}
                  >
                    {a}
                  </Button>
                ))}
                <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  fps
                  <Input
                    type="number"
                    min={12}
                    max={60}
                    value={config.fps}
                    onChange={(e) => set('fps', Math.max(1, Number(e.target.value) || 30))}
                    className="h-7 w-14 px-1.5 text-xs"
                  />
                </label>
              </div>
              <label className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                Lấp khung
                <Select
                  value={fillMode}
                  onValueChange={(v) => set('kenburns', { ...config.kenburns, fill: v as FillMode })}
                >
                  <SelectTrigger size="sm" className="w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Full màn hình</SelectItem>
                    <SelectItem value="blur">Vừa khung + nền blur</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                Hiệu ứng
                <Select
                  value={config.kenburns.motion}
                  onValueChange={(v) =>
                    set('kenburns', { ...config.kenburns, motion: v as DefaultMotion })
                  }
                >
                  <SelectTrigger size="sm" className="w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">Tĩnh</SelectItem>
                    <SelectItem value="auto">Tự động (lia/zoom)</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Beat đã chọn hiệu ứng riêng ở Storyboard giữ nguyên lựa chọn đó.
              </p>
              <label className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                Zoom Ken Burns: {config.kenburns.zoom.toFixed(2)}×
                <Slider
                  min={1}
                  max={1.4}
                  step={0.01}
                  value={[config.kenburns.zoom]}
                  onValueChange={([v]) => set('kenburns', { ...config.kenburns, zoom: v })}
                  className="w-32"
                />
              </label>
            </CardContent>
          </Card>

          <SubtitlePanel value={sub} onChange={(s) => set('subtitles', s)} />

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Nhạc nền (BGM)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 text-xs text-muted-foreground">
              <Input
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setBgmFile(f);
                  if (bgmUrl) URL.revokeObjectURL(bgmUrl);
                  setBgmUrl(f ? URL.createObjectURL(f) : null);
                }}
                className="h-8 text-xs"
              />
              <label className="flex items-center justify-between gap-2">
                Âm lượng: {Math.round(config.bgm.volume * 100)}%
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[config.bgm.volume]}
                  onValueChange={([v]) => set('bgm', { ...config.bgm, volume: v })}
                  className="w-32"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Duck khi có lời: {config.bgm.duckDb}dB
                <Slider
                  min={-24}
                  max={0}
                  step={1}
                  value={[config.bgm.duckDb]}
                  onValueChange={([v]) => set('bgm', { ...config.bgm, duckDb: v })}
                  className="w-32"
                />
              </label>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Giọng đọc (TTS)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 text-xs text-muted-foreground">
              <label className="flex items-center justify-between gap-2">
                Provider
                <Select
                  value={config.tts.provider || TTS_PROVIDER_ENV}
                  onValueChange={(v) =>
                    // Đổi provider → reset voiceId/model: giọng của provider này không hợp lệ
                    // với provider kia (vd BV074 gửi sang ElevenLabs sẽ lỗi). Rỗng = mặc định.
                    set('tts', { provider: v === TTS_PROVIDER_ENV ? '' : v, voiceId: '', model: '' })
                  }
                >
                  <SelectTrigger size="sm" className="w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TTS_PROVIDER_ENV}>Theo ENV</SelectItem>
                    {TTS_PROVIDER_OPTIONS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <p>
                Ngôn ngữ lời kể: <span className="font-medium text-foreground">{langLabel}</span>
                {' '}(chọn lúc nhận chapter)
              </p>
              {capcutVoices && capcutVoices.length === 0 ? (
                <p className="text-destructive">
                  CapCut chưa có giọng {langLabel} — chọn ElevenLabs để synth.
                </p>
              ) : capcutVoices ? (
                <>
                  {voiceMismatch && (
                    <p className="text-amber-600 dark:text-amber-400">
                      Giọng đã chọn không đọc được {langLabel} — synth sẽ dùng {capcutVoices[0]?.label}.
                    </p>
                  )}
                  <label className="flex items-center justify-between gap-2">
                    Giọng
                    <Select
                      value={(!voiceMismatch && config.tts.voiceId) || TTS_PROVIDER_ENV}
                      onValueChange={(v) =>
                        set('tts', { ...config.tts, voiceId: v === TTS_PROVIDER_ENV ? '' : v })
                      }
                    >
                      <SelectTrigger size="sm" className="w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TTS_PROVIDER_ENV}>
                          {jobLang === 'vi' ? 'Giọng mặc định' : `Giọng mặc định (${langLabel})`}
                        </SelectItem>
                        {capcutVoices.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </>
              ) : (
                <>
                  <label className="flex items-center justify-between gap-2">
                    Voice ID
                    <Input
                      type="text"
                      placeholder="(ENV mặc định)"
                      value={config.tts.voiceId}
                      onChange={(e) => set('tts', { ...config.tts, voiceId: e.target.value })}
                      className="h-7 w-40 px-1.5 text-xs"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    Model
                    <Input
                      type="text"
                      placeholder="(ENV mặc định)"
                      value={config.tts.model}
                      onChange={(e) => set('tts', { ...config.tts, model: e.target.value })}
                      className="h-7 w-40 px-1.5 text-xs"
                    />
                  </label>
                </>
              )}
              <p>
                Để &ldquo;Theo ENV&rdquo; = dùng giọng mặc định đặt ở Settings ⚙️ (tab Giọng
                đọc); các ô ở đây chỉ ghi đè cho riêng video này.
              </p>
              <p>
                Synth 1 lần là vào cache đĩa — CLI render tái dùng, không gọi API lại.
                {capcutVoices ? ' CapCut là API miễn phí không chính thức — có thể ngừng chạy.' : ''}
              </p>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground/70">
            Bấm <span className="font-medium text-foreground">Render MP4</span> để dựng video ngay
            tại đây — xong tự tải <code className="rounded bg-muted px-1">results.zip</code> (MP4 +
            .srt + .timeline.json). Export bundle zip / CLI nằm ở menu &ldquo;Nâng cao&rdquo; (render
            máy khác hoặc batch).
          </p>
        </aside>
      </div>
    </PageShell>
  );
}
