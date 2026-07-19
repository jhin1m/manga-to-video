---
title: "Phase 5: render.py + parity shake"
status: done
phase: 5
priority: P1
effort: "8h"
dependencies: [2]
---

# Phase 5: render.py + parity shake

## Overview

Port tầng render: timeline + SRT (`lib/timeline.ts`) + Ken Burns chống shake (`lib/kenburns.ts`) + build/chạy ffmpeg (`lib/ffmpeg.ts`) → `out/video.mp4 + video.srt + timeline.json`. Gate nghiệm thu #2 (parity shake).

## Related Code Files

- Create: `~/.claude/skills/manga-to-video/scripts/render.py` (CLI)
- Create: `scripts/mtv/timeline.py` (port `lib/timeline.ts`), `scripts/mtv/kenburns.py` (port `lib/kenburns.ts`), `scripts/mtv/ffmpeg_cmd.py` (port `lib/ffmpeg.ts`)
- Create: `tools/parity-port/measure_shake.py` (phase-correlation, chạy bằng venv skill)
- Baseline so sánh: `content-extractor/output-16x9.mp4` (render TS SAU fix supersample+tmix)

## Hằng số + công thức BẮT BUỘC GIỮ NGUYÊN

**kenburns.py** (kenburns.ts — file:line theo scout):
| Hằng số | Giá trị |
|---|---|
| SUPERSAMPLE | 4 (mọi motion mode scale/crop ở 4× trước khi xuống final) |
| STRIP_SHAPE | 1.6 (h/w ≥ 1.6 → strip candidate) |
| PAN_MIN_COVER / PAN_MAX_COVER | 1.05 / 3.0 |
| MAX_PAN_FRAME_PER_SEC | 0.35 (cap tốc độ pan: `travel = min(travelFull, 0.35·H·dur)`) |
| Frame size | 9:16→1080×1920, 16:9→1920×1080, 1:1→1080×1080 |
| Aspect-mismatch → blur-fill | > 0.02; bg `force_original_aspect_ratio=increase` + `boxblur=20:1`, fg fit-inside + overlay |
| even() | mọi kích thước làm tròn về chẵn (yuv420p) |

- **zoom**: `frames = max(2, round(dur·fps))`; forward `z='1+{(zt-1):.4f}*on/{frames-1}'`, reverse `z='{zt:.4f}-{(zt-1):.4f}*on/{frames-1}'`; `zoompan=z=...:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s={W}x{H}` **theo sau BẮT BUỘC `tmix=frames=2`** (chống quantization jitter — kenburns.ts:240-243). Blur-fill: fg scale ở `W*4×H*4` rồi tmix.
- **pan-v**: `scale={W}:{scaledH*4},crop={W}:{H*4}:0:{y_expr}` với `y = base·4 + travel·4·(t/dur)` (reverse: `1-t/dur`), final scale về W×H. **KHÔNG tmix cho pan** (ghosting). pan-h đối xứng.
- **static**: scale thẳng (hoặc blur-fill nếu lệch aspect).
- Filter luôn kết thúc label `[v]`.

**timeline.py** (timeline.ts): audio là "nhạc trưởng" — `duration = max(audio_sec + 0.15 + 0.35, 2.0)`; không audio → `max(duration_hint, 2.0)`; override → `max(override, audio + pads)`. Shot allocation theo weight, sàn `shotFloorSec = 0.8`, deficit reallocation (timeline.ts:46-73). Mọi giá trị `round3 = round(n·1000)/1000`. SRT: tách câu regex `(?<=[.!?…])\s+` + `\n+`, phân bổ thời gian theo tỉ lệ số ký tự trong `[seg.start, seg.end]`, format `HH:MM:SS,mmm` (timeline.ts:125-179). timeline.json: `{segments: [{segId, start, end, shots: [...]}], totalSec}`.

**ffmpeg_cmd.py** (ffmpeg.ts) — port đúng từng lệnh:
1. renderShot: `-y -loop 1 -framerate FPS -i IMG -filter_complex F -map [v] -t DUR -r FPS -c:v libx264 -preset veryfast -pix_fmt yuv420p`
2. concat demuxer: list file `file 'path'` (escape `'` → `'\''`), `-f concat -safe 0 -c copy`
3. buildAudioTrack: mỗi seg `aresample=44100,aformat=channel_layouts=stereo,adelay=MS|MS`; `amix=inputs=N:normalize=0,apad=whole_dur=DUR`; không audio → `anullsrc=r=44100:cl=stereo:d=DUR`; output `pcm_s16le`
4. duckBgm: `atrim=0:DUR,aresample=44100,...,volume=VOL[bgm]; [bgm][0:a]sidechaincompress=threshold=0.02:ratio=R:attack=20:release=400[ducked]; [0:a][ducked]amix=inputs=2:normalize=0`, với `R = max(2, min(20, |duck_db|·2/3))`, BGM `-stream_loop -1`
5. burnSubs: `subtitles=filename=SRT:force_style=...` — PlayResY 288, `FontSize=(size_pct/100)·288`, `MarginV=(margin_pct/100)·288`, Alignment 8/5/2 (top/middle/bottom), màu `#RRGGBB → &H00BBGGRR`, `-an`, re-encode libx264
6. mux: `-map 0:v -map 1:a -c:v copy -c:a aac -shortest`

## Implementation Steps

1. Port 3 module trên, mỗi file header ghi nguồn + dặn đồng bộ 2 nơi khi fix bug.
2. `render.py` CLI: `render.py --workdir W --aspect 9:16|16:9|1:1 [--fps 30] [--zoom Z] [--bgm FILE] [--bgm-volume V] [--duck-db -12] [--subs srt|burn|both] [--dry-run]`
   - Đọc `script.json` + `audio-manifest.json` → shots (mỗi shot_index → slice full-frame, region null, motion auto theo heuristic kenburns) → timeline → render từng shot (temp trong `workdir/out/.shots/`) → concat → audio track → duck nếu `--bgm` → burn nếu cần → mux → dọn temp.
   - Default `--zoom 1.12` (đã verify = default TS RenderConfig, `lib/schema.ts:291`). <!-- Updated: Validation Session 1 - pin zoom default -->
   - `--subs srt` chỉ xuất file; `burn` chỉ đốt; `both` cả hai. `--dry-run`: in timeline + toàn bộ lệnh ffmpeg, không chạy.
   - Lỗi ffmpeg: in 6 dòng stderr cuối (như ffmpeg.ts:9-34), exit ≠ 0.
3. `tools/parity-port/measure_shake.py`: extract frames đoạn zoom (`ffmpeg -i X -vf select=...`), phase-correlation FFT (numpy) giữa frame liên tiếp → displacement sub-pixel; báo median/p95. Đo trên: (a) baseline `content-extractor/output-16x9.mp4`, (b) clip Python render cùng aspect với ảnh + timeline tương đương.
4. Chạy parity: render 3-5 segment có zoom + pan bằng render.py, đo và so.

## Success Criteria

- [ ] **Gate nghiệm thu #2**: p95 displacement của video Python ≤ p95 baseline TS × 1.1 (không tệ hơn có dung sai 10%); median tương đương.
- [ ] 3 aspect đều ra đúng kích thước; SRT mở được, timing khớp segment.
- [ ] `--dry-run` in đủ lệnh; render lại từ workdir đã có audio không gọi TTS.

## Risk Assessment

- Sai một biểu thức zoompan/tmix là shake quay lại — vì vậy trích NGUYÊN VĂN biểu thức từ kenburns.ts khi implement (không viết lại theo trí nhớ), diff chuỗi filter Python vs TS bằng harness in-filter-string trước khi render thật.
- Motion auto của skill (region null toàn slice) sẽ thiên về pan-v với slice cao — chấp nhận; hành vi giống TS khi beat không có region.
- Version ffmpeg khác app → filter thiếu (`sidechaincompress`). Mitigation: port cả `hasFilter()` check (ffmpeg.ts:44-49), báo lỗi rõ.
