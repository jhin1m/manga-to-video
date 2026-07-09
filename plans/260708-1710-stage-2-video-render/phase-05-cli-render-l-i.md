---
phase: 5
title: "CLI render lõi"
status: completed
priority: P1
dependencies: [3]
effort: ""
---

# Phase 5: CLI render lõi

## Overview

CLI `scripts/render-video.mts` đọc bundle → per-segment TTS (cache P3) → dựng **timeline** (audio thật → duration → phân bổ shots) → **Ken Burns per shot** bằng ffmpeg → xuất từng segment video + `timeline.json` + `subtitles.srt`. (Ghép cuối ở P6.)

## Requirements

- **Functional:** parse flag; đọc bundle; TTS per segment (cache/`--dry-run`); tính timeline; sinh filter Ken Burns theo region+aspect; render shot→segment video; xuất timeline.json + srt.
- **Non-functional:** deterministic; kiểm tra ffmpeg/ffprobe; lỗi rõ ràng; không phụ thuộc server đang chạy.

## Architecture

**`lib/ffmpeg.ts`** — wrapper `child_process.spawn` (không thêm dep):
- `assertFfmpeg()` — kiểm tra `ffmpeg`/`ffprobe` tồn tại (báo `brew install ffmpeg` nếu thiếu).
- `probeDurationSec(path)`, `renderShot({ image, filter, durationSec, fps, out })`, (concat/mux/duck/burn ở P6).

**`lib/timeline.ts`** (thuần, dễ test):
- `buildTimeline(segments, segDurations, config)`:
  - `dur_seg[i] = max(audioLen[i] + padHead + padTail, floorSec)` (text rỗng → `floorSec`).
  - `start_seg` tích luỹ; trong segment chia `dur_seg` cho `shots[]` theo `weight` (chuẩn hoá), mỗi shot ≥ `shotFloorSec`.
  - Trả `{ segments:[{start,end,shots:[{sourceIndex,region,start,end}]}], totalSec }`.
- `toSrt(timeline, segments)` → **tách narration segment thành caption theo câu** (Validation S1): split câu (dấu `. ! ? …` + xuống dòng), canh giờ trong khoảng `[start_seg, end_seg]` **tỉ lệ theo số ký tự** mỗi câu (naive, không thêm API). Tuỳ chọn chính xác: dùng ElevenLabs `with-timestamps` (P3) căn theo ký tự. `HH:MM:SS,mmm`.
- `toTimelineJson(timeline, segments)` → bảng review (`seg#|narration|shots|start|end|move`).

**`lib/kenburns.ts`** (thuần, trả chuỗi filter):
- `kenburns({ imgW, imgH, region, aspect, durationSec, fps, zoom })`:
  - Khung đích `(W,H)` theo aspect (vd 1080×1920 cho 9:16).
  - `region ?? cả band` → tâm/hướng: cao/hẹp→pan dọc (`y` chạy), rộng→pan ngang, gần vuông→zoom-in `1→zoom` vào tâm region.
  - Aspect ≠ band-ratio → **blur-fill**: nền = ảnh scale-cover + `boxblur`, lớp trên = ảnh `fit inside` + zoompan.
  - Kẹp vận tốc pan: band quá cao + shot ngắn → giảm biên pan hoặc chuyển zoom (chống pan giật).
  - Trả filtergraph cho `renderShot` (dùng `zoompan`/`scale`/`crop`/`overlay`).

**`scripts/render-video.mts`:**
- Flags: `<bundle.zip>` `--aspect` `--fps` `--out` `--bgm` `--dry-run` `--subs=srt|burn|both`.
- `--dry-run`: bỏ TTS, dùng `durationHint` → chỉ xuất timeline.json + srt (xem layout/timing free).
- Ngược lại: `readBundle` → per-segment `synthSegment` (cache) → `probeDurationSec` → `buildTimeline` → mỗi shot `kenburns`+`renderShot` → thư mục làm việc `.render/<jobId>/` (shots + audio + timeline + srt).

## Related Code Files

- Create: `content-extractor/lib/ffmpeg.ts`, `content-extractor/lib/timeline.ts`, `content-extractor/lib/kenburns.ts`
- Create: `content-extractor/scripts/render-video.mts`
- Modify: `content-extractor/lib/tts.ts` (hợp nhất `probeDurationSec` từ `ffmpeg.ts`, bỏ shim P3)
- Modify: `content-extractor/package.json` (script `render`)

## Implementation Steps

1. `lib/ffmpeg.ts`: assert + probe + renderShot (spawn, promisify).
2. `lib/timeline.ts`: buildTimeline (phân bổ shots theo weight, sàn), toSrt, toTimelineJson.
3. `lib/kenburns.ts`: filtergraph theo region+aspect + blur-fill + kẹp pan.
4. `scripts/render-video.mts`: parse flag, readBundle, TTS→timeline→render shots, xuất timeline.json/srt; nhánh `--dry-run`.
5. Hợp nhất probe vào `tts.ts`; thêm `package.json` script `render`.

## Success Criteria

- [x] `buildTimeline`: Σ dur_seg = totalSec; phân bổ shots theo weight đúng; sàn áp cho segment/shot rỗng.
- [x] `toSrt`: caption **tách theo câu** trong từng segment, canh giờ tỉ lệ ký tự, không tràn ngoài `[start_seg,end_seg]`. <!-- Updated: Validation Session 1 - caption tách câu -->

- [x] `kenburns`: region cao→pan dọc, rộng→pan ngang, vuông→zoom; aspect lệch → có blur-fill.
- [x] `--dry-run` xuất timeline.json + srt **không gọi ElevenLabs/ffmpeg render**.
- [x] Render thật (mock TTS) → mỗi segment ra file video đúng thời lượng.
- [x] Thiếu ffmpeg → báo lỗi hướng dẫn cài, không stack trace khó hiểu.

## Risk Assessment

- **zoompan jitter** → supersample/scale trước; verify sample (P7); cho `zoom` chỉnh.
- **Band cao + narration ngắn → pan quá nhanh** → kẹp vận tốc/đổi zoom.
- **16:9 từ band dọc mất nội dung** → blur-fill + căn giữa; mặc định khuyến nghị 9:16.
- **Dup probe (P3/P5)** → nguồn duy nhất ở `ffmpeg.ts`.
