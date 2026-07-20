'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Package, Pause, Play, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { PageShell } from '@/components/page-shell';
import { useProject } from '@/components/project-context';
import { useReducedMotion } from '@/components/use-reduced-motion';
import type { RenderConfig, ScriptDTO, StoryboardDTO } from '@/lib/schema';
import { defaultRenderConfig } from '@/lib/schema';
import { planKenburns } from '@/lib/kenburns';
import { ASPECT_CSS, kenburnsFrameStyle } from '@/lib/kenburns-css';
import { allocateCaptions, buildTimeline, splitSentences, TIMELINE_DEFAULTS } from '@/lib/timeline';
import { TTS_PROVIDER_OPTIONS } from '@/lib/tts-providers/catalog';

// Sentinel dropdown provider: Radix Select cấm value="" — dùng 'env' đại diện "Theo ENV",
// map về '' khi lưu (rỗng = lấy TTS_PROVIDER lúc synth).
const TTS_PROVIDER_ENV = 'env';

// Preview UI video (Stage 2): phát duyệt kịch bản dạng video — Ken Burns XẤP XỈ bằng CSS,
// phụ đề chỉnh live, BGM + khung hình. Hai chế độ: im lặng (durationHint, free) và có audio
// (synth TTS → timing thật). MP4 từ CLI render mới là chân lý.

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
  const [config, setConfig] = useState<RenderConfig>(defaultRenderConfig);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [audioMode, setAudioMode] = useState(false);
  const [synthBusy, setSynthBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
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
      motion: currentShot.motion,
      aspect: config.aspect,
      durationSec: shotDur,
      fps: config.fps,
      zoom: config.kenburns.zoom,
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
  // Provider có catalog giọng (CapCut) → render dropdown giọng + ẩn model; provider khác/rỗng
  // → 2 ô text voiceId/model như cũ.
  const capcutVoices = TTS_PROVIDER_OPTIONS.find((p) => p.id === config.tts.provider)?.voices;

  const set = <K extends keyof RenderConfig>(key: K, value: RenderConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  return (
    <PageShell
      title="Dựng video"
      subtitle="Preview XẤP XỈ (CSS) để duyệt bố cục/timing/style — file MP4 do CLI render mới là bản chuẩn."
      actions={
        <>
          <Button variant="ai" onClick={synthAudio} disabled={synthBusy}>
            <Sparkles data-icon="inline-start" />
            {synthBusy ? 'Đang synth…' : audioMode ? 'Synth lại audio' : 'Synth audio (timing thật)'}
          </Button>
          <Button variant="success" onClick={exportBundle} disabled={exportBusy}>
            <Package data-icon="inline-start" />
            {exportBusy ? 'Đang đóng gói…' : 'Export để render'}
          </Button>
          <Button variant="outline" onClick={() => router.push(`/script/${jobId}`)}>
            Kịch bản
          </Button>
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
              <div
                className="pointer-events-none absolute inset-x-0 flex px-[4cqw]"
                style={{
                  ...(sub.position === 'top'
                    ? { top: `${sub.marginPct}cqh` }
                    : sub.position === 'middle'
                      ? { top: '50%', transform: 'translateY(-50%)' }
                      : { bottom: `${sub.marginPct}cqh` }),
                  justifyContent: 'center',
                }}
              >
                <span
                  className="text-center font-semibold leading-tight"
                  style={{
                    color: sub.color,
                    fontFamily: `'${sub.font}', sans-serif`,
                    fontSize: `${sub.sizePct}cqh`,
                    textShadow: sub.outline
                      ? '0 0 4px #000, 0 0 4px #000, 2px 2px 2px #000'
                      : undefined,
                  }}
                >
                  {caption}
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
                Zoom Ken Burns: {config.kenburns.zoom.toFixed(2)}×
                <Slider
                  min={1}
                  max={1.4}
                  step={0.01}
                  value={[config.kenburns.zoom]}
                  onValueChange={([v]) => set('kenburns', { zoom: v })}
                  className="w-32"
                />
              </label>
            </CardContent>
          </Card>

          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Phụ đề</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 text-xs text-muted-foreground">
              <label className="flex items-center justify-between gap-2">
                Font
                <Input
                  type="text"
                  value={sub.font}
                  onChange={(e) => set('subtitles', { ...sub, font: e.target.value })}
                  className="h-7 w-40 px-1.5 text-xs"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Cỡ chữ: {sub.sizePct.toFixed(1)}%
                <Slider
                  min={2}
                  max={10}
                  step={0.1}
                  value={[sub.sizePct]}
                  onValueChange={([v]) => set('subtitles', { ...sub, sizePct: v })}
                  className="w-32"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Màu
                <input
                  type="color"
                  value={sub.color}
                  onChange={(e) => set('subtitles', { ...sub, color: e.target.value })}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Vị trí
                <Select
                  value={sub.position}
                  onValueChange={(v) =>
                    set('subtitles', { ...sub, position: v as typeof sub.position })
                  }
                >
                  <SelectTrigger size="sm" className="w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom">Dưới</SelectItem>
                    <SelectItem value="middle">Giữa</SelectItem>
                    <SelectItem value="top">Trên</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex items-center justify-between gap-2">
                Lề: {sub.marginPct}%
                <Slider
                  min={0}
                  max={25}
                  step={1}
                  value={[sub.marginPct]}
                  onValueChange={([v]) => set('subtitles', { ...sub, marginPct: v })}
                  className="w-32"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Viền chữ (outline)
                <Switch
                  checked={sub.outline}
                  onCheckedChange={(v) => set('subtitles', { ...sub, outline: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Burn-in vào video (luôn kèm .srt rời)
                <Switch
                  checked={sub.burnIn}
                  onCheckedChange={(v) => set('subtitles', { ...sub, burnIn: v })}
                />
              </label>
            </CardContent>
          </Card>

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
              {capcutVoices ? (
                <label className="flex items-center justify-between gap-2">
                  Giọng
                  <Select
                    value={config.tts.voiceId || TTS_PROVIDER_ENV}
                    onValueChange={(v) =>
                      set('tts', { ...config.tts, voiceId: v === TTS_PROVIDER_ENV ? '' : v })
                    }
                  >
                    <SelectTrigger size="sm" className="w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TTS_PROVIDER_ENV}>Giọng mặc định</SelectItem>
                      {capcutVoices.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
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
                Synth 1 lần là vào cache đĩa — CLI render tái dùng, không gọi API lại.
                {capcutVoices ? ' CapCut là API miễn phí không chính thức — có thể ngừng chạy.' : ''}
              </p>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground/70">
            Sau khi Export: chạy{' '}
            <code className="rounded bg-muted px-1">
              npm run render -- bundle-{jobId}.zip --aspect {config.aspect}
            </code>
          </p>
        </aside>
      </div>
    </PageShell>
  );
}
