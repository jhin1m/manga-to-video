---
title: "Phase 1: Môi trường + baseline TS"
status: done
phase: 1
priority: P1
effort: "2h"
dependencies: []
---

# Phase 1: Môi trường + baseline TS

## Overview

Chuẩn bị venv + dump baseline điểm cắt từ engine TS trên corpus thật, làm mốc so sánh cho parity banding (Phase 3). Không sửa file nào trong `content-extractor/`.

## Requirements

- Functional: venv đủ deps; baseline-cuts.json sinh từ chính `lib/smart-split.ts`.
- Non-functional: harness tái chạy được (ghi rõ settings đã dùng vào output).

## Related Code Files

- Create: `tools/parity-port/dump-cuts.ts` (repo root — ngoài content-extractor)
- Create: `tools/parity-port/baseline/baseline-cuts.json`
- Đọc: `content-extractor/lib/smart-split.ts`, `lib/stitch.ts` (import trực tiếp — cả hai chạy server-side với sharp, không cần browser)

## Implementation Steps

1. Cài dep thiếu vào venv skill: `~/.claude/skills/.venv/bin/python3 -m pip install pymupdf cryptography` (PIL/numpy/jsonschema/requests đã có — đã verify; `cryptography` cần cho RSA sign CapCut ở Phase 4). Smoke test `import fitz; import cryptography`.
2. Verify ffmpeg/ffprobe hệ thống (`/opt/homebrew/bin/` — đã có).
3. `nvm use 24` (bắt buộc — shell mặc định Node 22). Viết `tools/parity-port/dump-cuts.ts`:
   - Import `stitchSlices` + hàm split từ `content-extractor/lib/` (đường dẫn tương đối), chạy bằng `npx tsx` với deps của content-extractor (sharp đã cài sẵn trong node_modules của app).
   - Input: folder corpus 38 slice `~/Downloads/Vừa Gả Đã Làm Mẹ Kế Của Ba Nhóc Con Chap 1.1 Next Chap 2.1 - NetTruyen/`.
   - Pipeline giống production: **import hàm pipeline-level từ `content-extractor/lib/pipeline.ts`** (KHÔNG tự chain stitch+split tay) — pipeline.ts có bước downscale TRƯỚC stitch (`pipeline.ts:72,116`) và natural sort tên file (`pipeline.ts:67`); tự chain sẽ lệch baseline. <!-- Updated: Validation Session 1 - pipeline-level import -->
   - QUAN TRỌNG: pin settings TƯỜNG MINH (không dựa env ngầm): `LINE_TOLERANCE=25, IGNORABLE_BORDER=5, MIN_GUTTER_HEIGHT=24, SPLIT_HEIGHT=1600, MIN_BAND_HEIGHT=960 (0.6×), MAX_BAND_HEIGHT=2240 (1.4×), MIN_INK_DENSITY=0.02, STRIP_RATIO=2.5`. Kiểm tra `.settings.json` của app KHÔNG rò vào harness (settings dialog override — commit f072d8c).
4. Output `baseline-cuts.json`: `{settings: {...}, stitched: {width, height}, cuts: [y...], regions: [{x,y,w,h}...], inkDensityPerBand: [...]}`.
5. Ghi chú số band + chiều cao stitched vào report phase để đối chiếu nhanh ở Phase 3.

## Success Criteria

- [ ] `import fitz` OK trong venv skill.
- [ ] `baseline-cuts.json` tồn tại, có settings snapshot + danh sách cuts/regions từ TS engine trên corpus 38 slice.
- [ ] Chạy lại harness 2 lần cho kết quả giống hệt (deterministic).

## Risk Assessment

- `pdf-to-img`/tsx cần Node 24 NAPI — quên `nvm use 24` sẽ fail khó hiểu. Mitigation: harness in version check `process.version` fail sớm nếu < 24.
- Env vars của shell có thể override settings mặc định → pin tường minh trong harness (bước 3).
