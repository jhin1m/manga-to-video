---
phase: 1
title: "Shared render engine + CLI refactor"
status: completed
priority: P1
effort: "0.5-1d"
dependencies: []
---

# Phase 1: Shared render engine + CLI refactor

## Overview

Tách orchestration render (đang inline trong `scripts/render-video.mts::main()`) thành module dùng chung `lib/render.ts::renderVideo(input, opts)` source-agnostic, thêm hook `onProgress` + `AbortSignal`. Refactor `render-video.mts` thành client mỏng. Gate regression: `test:render` + `test:e2e-video` vẫn xanh — bằng chứng engine KHÔNG đổi hành vi.

## Requirements

- Functional: `renderVideo(input, opts)` chạy đúng luồng hiện tại (TTS cache → buildTimeline → renderShot×N → concat → buildAudioTrack → duckBgm → burnSubs → mux → MP4 + .srt + .timeline.json). CLI cho ra output byte-tương đương trước refactor.
- Functional: `onProgress(ev)` phát event ở mỗi mốc (tts i/N, timeline, shot i/N toàn cục, concat, audio, bgm, subs, mux, done).
- Functional: `signal?: AbortSignal` — giữa các bước và khi spawn ffmpeg, abort → kill child ffmpeg đang chạy + throw `AbortError`.
- Non-functional: DRY — không còn logic render trùng giữa CLI và (P2) route. Không thêm dependency. Comment tiếng Việt theo style repo.

## Architecture

**`lib/render.ts` (mới):**

```ts
export interface RenderInput {
  jobId: string;
  segments: ScriptManifest['segments']; // = scriptManifest.segments (id, order, narration, shots[])
  config: RenderConfig;
  images: Map<number, Buffer>;          // sourceIndex → band bytes
  bundledAudio?: Map<string, Buffer>;   // segId → mp3 đã synth (bundle hoặc store)
  bgm?: { filename: string; data: Buffer };
}

export interface RenderOptions {
  outPath: string;
  subsMode?: 'srt' | 'burn' | 'both';   // default: config.subtitles.burnIn ? 'both' : 'srt'
  dryRun?: boolean;
  keep?: boolean;
  workRoot?: string;                    // default '.render'
  onProgress?: (ev: RenderEvent) => void;
  signal?: AbortSignal;
}

export type RenderEvent =
  | { phase: 'tts'; i: number; n: number; segOrder: number; cached?: boolean; durationSec: number }
  | { phase: 'timeline'; totalSec: number }
  | { phase: 'shot'; i: number; n: number; segIndex: number }
  | { phase: 'concat' | 'audio' | 'bgm' | 'subs' | 'mux' }
  | { done: true; totalSec: number; outPath: string; srtPath: string; timelinePath: string };

export interface RenderResult { outPath: string; srtPath: string; timelinePath: string; totalSec: number; }

export async function renderVideo(input: RenderInput, opts: RenderOptions): Promise<RenderResult>;
```

- Nội dung `renderVideo` = bê nguyên `main()` của render-video.mts NHƯNG: (a) nhận `RenderInput` thay vì đọc bundle; (b) `console.log(...)` → `opts.onProgress?.(...)`; (c) truyền `opts.signal` xuống mọi lời gọi ffmpeg; (d) `workDir = path.join(opts.workRoot ?? '.render', ...)`.
- Đếm shot toàn cục (`i/n` across all segments) để progress bar mượt — tính `totalShots = Σ tseg.shots.length` trước vòng render.

**`lib/ffmpeg.ts` (sửa):**
- `runCommand(bin, args, signal?: AbortSignal): Promise<string>` — nếu `signal.aborted` → reject ngay; đăng ký `signal.addEventListener('abort', () => child.kill('SIGKILL'))`; gỡ listener ở `close`. Child bị kill → close code≠0 → reject (bọc thành `AbortError` nếu do abort).
- Thread `signal?` (optional, mặc định undefined) qua: `renderShot`, `concatVideo`, `buildAudioTrack`, `duckBgm`, `burnSubs`, `mux`, `probeDurationSec`. **Chữ ký cũ giữ tương thích** (param cuối optional) — CLI không truyền signal vẫn chạy như cũ.

**`scripts/render-video.mts` (thu gọn):**
- Giữ `parseArgs`/`usage`. `main()`: `readBundle` → dựng `RenderInput` (`segments = scriptManifest.segments`, `images = bundle.images`, `bundledAudio = bundle.audio`, `bgm = bundle.bgm`, `config` merge CLI flags) → `renderVideo(input, { outPath, subsMode, dryRun, keep, onProgress: ev => console.log(fmt(ev)) })`.
- `fmt(ev)` in log tương đương định dạng `[render] ...` cũ (giữ E2E `test:render` nếu nó grep stdout — kiểm ở bước 1).

## Related Code Files

- Create: `content-extractor/lib/render.ts`
- Modify: `content-extractor/lib/ffmpeg.ts` (thêm AbortSignal, giữ chữ ký cũ tương thích)
- Modify: `content-extractor/scripts/render-video.mts` (thu gọn → gọi renderVideo)
- Reference (không sửa): `content-extractor/lib/bundle.ts` (readBundle shape), `lib/timeline.ts`, `lib/kenburns.ts`, `lib/tts.ts`, `lib/schema.ts`

## Implementation Steps

1. **Chốt baseline:** chạy `npm run test:render` + `npm run test:e2e-video` HIỆN TẠI, ghi lại pass + độ dài output mẫu để so sau. Đọc 2 script E2E (`scripts/verify-render.mts`, `scripts/e2e-script-video.mts`) xem có grep stdout `[render]` không (quyết định `fmt` phải giữ format nào).
2. Thêm `AbortSignal` vào `lib/ffmpeg.ts::runCommand` + thread optional qua các hàm export. Giữ mọi chữ ký cũ hoạt động (param cuối optional).
3. Tạo `lib/render.ts`: định nghĩa types + `renderVideo` bê từ `main()` (đọc RenderInput, onProgress, signal, workRoot).
4. Thu gọn `scripts/render-video.mts` gọi `renderVideo`; viết `fmt(ev)` khớp log cũ.
5. Chạy lại `npm run test:render` + `test:e2e-video` + `npm run lint`. So output mẫu với baseline (độ dài timeline, tồn tại .srt/.timeline.json).

## Success Criteria

- [ ] `npm run test:render` xanh; output MP4/.srt/.timeline khớp baseline (độ dài timeline bằng nhau).
- [ ] `npm run test:e2e-video` xanh.
- [ ] `npm run lint` sạch; không dependency mới.
- [ ] `render-video.mts` không còn logic render trùng (chỉ parse args + dựng input + gọi renderVideo).
- [ ] `renderVideo` phát đủ event onProgress ở mọi mốc (kiểm bằng CLI log tương đương cũ).

## Risk Assessment

- **Rủi ro chính:** refactor engine đổi hành vi ngầm (thứ tự filter, workDir path, tên file). *Mitigation:* baseline trước/sau + `test:render` là gate cứng; bê nguyên logic, chỉ thay I/O nguồn + log→onProgress + signal.
- **E2E grep stdout:** nếu `test:render` phụ thuộc chuỗi `[render] ...`, `fmt(ev)` phải tái tạo đúng. *Mitigation:* đọc script E2E ở bước 1 trước khi đổi log.
- **AbortSignal phá chữ ký:** thêm param bắt buộc sẽ vỡ CLI. *Mitigation:* param `signal` optional cuối cùng, mặc định undefined.
