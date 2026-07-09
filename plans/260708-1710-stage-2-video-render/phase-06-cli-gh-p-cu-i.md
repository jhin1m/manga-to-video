---
phase: 6
title: "CLI ghép cuối"
status: completed
priority: P1
dependencies: [5]
effort: ""
---

# Phase 6: CLI ghép cuối

## Overview

Ghép sản phẩm P5 thành 1 file MP4: concat shots theo thứ tự → track audio đặt đúng `start` từng segment → trộn BGM ducking → burn-in phụ đề nếu bật → xuất `output-<aspect>.mp4`. Đây là bước tạo file cuối cùng.

## Requirements

- **Functional:** concat video shots; dựng audio track (seg audio tại đúng mốc + im lặng chèn); sidechain ducking BGM; burn-in `.ass`/`subtitles` theo config; mux → MP4.
- **Non-functional:** audio/video khớp (tổng shots của segment = dur_seg); font tiếng Việt đủ dấu; deterministic.

## Architecture

Thêm vào `lib/ffmpeg.ts`:
- `concatVideo(shotFiles[], out)` — concat demuxer (mọi shot cùng fps/size/pix_fmt từ P5).
- `buildAudioTrack(segAudio[], starts[], totalSec, out)` — đặt mỗi `seg-*.mp3` tại `start_seg` (adelay/apad), segment rỗng = im lặng; nối thành 1 track dài `totalSec`.
- `duckBgm(narrationTrack, bgmPath, { volume, duckDb }, out)` — sidechain compress: BGM hạ `duckDb` khi có narration (`sidechaincompress`), volume nền = `volume`; BGM ngắn → loop, dài → cắt theo `totalSec`.
- `burnSubs(video, srtOrAss, style, out)` — `subtitles`/`ass` filter với font/size/màu/vị trí; **nhúng font file** (dấu tiếng Việt) qua `fontsdir`.
- `mux(video, audio, out)` — `-c:v copy -c:a aac -shortest`.

`scripts/render-video.mts` (nối tiếp P5):
- Sau khi có shots + timeline: `concatVideo` → silent.mp4; `buildAudioTrack` → narration.wav; nếu `--bgm` → `duckBgm`; nếu `subs∈{burn,both}` → `burnSubs`; `mux` → `output-<aspect>.mp4`.
- Luôn xuất `subtitles.srt`; `both` = vừa burn vừa để .srt rời.
- Dọn thư mục `.render/<jobId>/` tuỳ chọn (`--keep` để debug).

## Related Code Files

- Modify: `content-extractor/lib/ffmpeg.ts` (concat/audio-track/duck/burn/mux)
- Modify: `content-extractor/scripts/render-video.mts` (chuỗi ghép cuối)
- Modify: `content-extractor/package.json` (nếu cần thêm alias)

## Implementation Steps

1. `concatVideo` — concat demuxer các shot.
2. `buildAudioTrack` — đặt seg audio đúng mốc + im lặng, dài `totalSec`.
3. `duckBgm` — sidechain ducking, loop/cắt BGM theo tổng.
4. `burnSubs` — burn-in theo style config + nhúng font.
5. `mux` + chuỗi hoá trong `render-video.mts`; giữ `.srt` rời.

## Success Criteria

- [x] `output-<aspect>.mp4` phát được; `ffprobe` có cả video+audio; tổng thời lượng ≈ `totalSec`.
- [x] Narration khớp hình từng segment; BGM nghe rõ nền và **duck** khi có lời.
- [x] `burnIn=true` → chữ cháy đúng font/size/màu/vị trí, đủ dấu tiếng Việt.
- [x] `subs=srt` → không burn, chỉ file `.srt`; `both` → cả hai.
- [x] Đổi `--aspect` từ cùng bundle → ra 2 MP4 hợp lệ.

## Risk Assessment

- **Concat lỗi do shot khác thông số** → chuẩn hoá fps/size/pix_fmt ở P5 renderShot.
- **Ducking quá tay/không đủ** → `duckDb`/`volume` cấu hình; mặc định an toàn (`-12dB`, `0.3`).
- **Font burn thiếu dấu** → nhúng font Việt (Be Vietnam Pro…) qua `fontsdir`, không dựa font hệ thống.
