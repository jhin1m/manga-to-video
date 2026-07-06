---
phase: 2
title: "Ingest & Banding"
status: completed
priority: P1
dependencies: [1]
---

# Phase 2: Ingest, Stitch & Smart-Split

## Overview

Tiền xử lý pixel deterministic: (a) **PDF → ảnh trang** (ingest mới), (b) **phân loại nguồn** pages vs strip,
(c) với strip: **stitch** slices → 1 canvas dọc → **smart-split** (port SmartStitch, né bubble/SFX) → bands.
Manga trang rời: giữ trang, cả-trang = 1 region. Không gọi model ở phase này.

## Requirements

- Functional: render PDF ra buffer ảnh; phân loại `sourceKind`; stitch strip → canvas; smart-split canvas → `BeatRegion[]` an toàn (không cắt ngang nội dung); fallback 1 band khi không tìm được safe-line.
- Non-functional: Node 24; port thuật toán chuẩn xác từ repo user; ngưỡng cấu hình qua ENV; tái dùng buffer sharp.

## Architecture

### PDF ingest
Chèn vào `lib/pipeline.ts` (đang unzip + natural sort + downscale sharp). Input có `.pdf` → render từng trang → buffer → vào danh sách theo thứ tự, rồi downscale như ảnh thường.
- **Lib chốt: `pdf-to-img`** (pdfjs + `@napi-rs/canvas`). ⚠️ Verify build/run trên Node 24 ở Step 1 (native canvas). Nếu vỡ → fallback `mupdf` (wasm). Đọc doc bản mới nhất, KHÔNG giả định API.

### Phân loại nguồn (`lib/source-kind.ts`)
Heuristic tỉ lệ `ratio = height/width` per-image: `ratio ≥ STRIP_RATIO` (mặc định ~2.5) → strip. Đa số ảnh strip → job strip. Override thủ công ở UI (Phase 4).

### Stitch (chỉ strip)
`lib/stitch.ts`: gộp các slice dọc thành 1 canvas (`sharp` composite/join theo chiều cao cộng dồn, giữ width lớn nhất/pad). Manga pages **không** stitch.

### Smart-split — port SmartStitch từ `jhin1m/manhwa-sticher` (`src-tauri/src/lib.rs`)
Port Rust→TS/sharp qua **`/ck:xia`**. Thuật toán (theo `ALGORITHM_IMPROVEMENTS.md`):
1. Duyệt `target_y` mỗi `split_height` px.
2. `findSplitPosition(target_y, lastSplitY)`: tìm **hai chiều** — LÊN trước theo `scan_line_step`, hết biên thì XUỐNG — tới `isSafeLine(y)` đầu tiên thoả `y - lastSplitY ≥ min_distance`.
3. `isSafeLine(y)`: đọc raw grayscale hàng y (`sharp.greyscale().raw()`); an toàn khi chênh lệch pixel liền kề trong hàng ≤ tolerance (hàng free-space, không đè bubble/SFX).
4. `min_distance = split_height * 40 / 100`.
5. Fallback: `min(target_y, height-1)` nếu vượt `max_attempts`.
6. Settings (ENV, có preset): `SPLIT_HEIGHT`, `SCAN_LINE_STEP`, `LINE_TOLERANCE` (pixel-diff), `MIN_DISTANCE_PCT=40`.

Output: `BeatRegion[]` (band = full width, dải `y`) trên **canvas làm việc** (`sourceIndex` trỏ working image). Manga: 1 region = cả trang.

## Related Code Files

- Modify: `content-extractor/lib/pipeline.ts` — nhánh render PDF trước bước sharp.
- Create: `content-extractor/lib/pdf.ts` — `renderPdf(buffer): Promise<Buffer[]>` (pdf-to-img).
- Create: `content-extractor/lib/source-kind.ts` — `classifySource`.
- Create: `content-extractor/lib/stitch.ts` — gộp slices → canvas (strip).
- Create: `content-extractor/lib/smart-split.ts` — **port SmartStitch** (`findSplitPosition`, `isSafeLine`).
- Modify: `content-extractor/.env.example` — `STRIP_RATIO`, `SPLIT_HEIGHT`, `SCAN_LINE_STEP`, `LINE_TOLERANCE`, `MIN_DISTANCE_PCT`.
- Reference (đọc để port): `jhin1m/manhwa-sticher` `src-tauri/src/lib.rs` + `ALGORITHM_IMPROVEMENTS.md` (MIT, của user).

## Implementation Steps

1. **Verify `pdf-to-img`** render 1 PDF mẫu → ảnh trên Node 24 (native canvas). Ghi kết quả; fallback mupdf nếu fail.
2. `lib/pdf.ts`: `renderPdf`, lỗi từng trang cô lập.
3. Nối vào `pipeline.ts`: nhận `.pdf`, chèn trang đúng thứ tự trước downscale.
4. `lib/source-kind.ts`: `classifySource(meta)`.
5. `lib/stitch.ts`: gộp strip → 1 canvas buffer (lưu vào store như working image).
6. **`/ck:xia` port SmartStitch** → `lib/smart-split.ts`: `detectBands(canvasBuf, settings): BeatRegion[]`. Đối chiếu output với repo gốc trên ảnh mẫu.
7. Đọc ENV settings (+ preset mặc định); override được.
8. Unit-test: strip tổng hợp có bubble giả → split KHÔNG cắt ngang bubble; min-distance chặn band < 40%; không safe-line → fallback.

## Success Criteria

- [x] PDF nhiều trang → đúng số buffer ảnh, đúng thứ tự.
- [x] Strip stitch → 1 canvas; smart-split ra band, **không cắt ngang** vùng nội dung mẫu.
- [x] `min_distance` chặn band quá nhỏ (≥40% split_height).
- [x] Manga trang → `pages`, 1 region cả-trang, không stitch.
- [x] Không safe-line → fallback `target_y`, không văng.
- [x] Settings ENV/preset đổi được, không sửa code.
- [x] Output band khớp hành vi repo `manhwa-sticher` trên cùng ảnh mẫu.

## Risk Assessment

- **`pdf-to-img` native canvas fail Node 24** → verify sớm (Step 1); fallback `mupdf` wasm.
- **Port SmartStitch lệch hành vi** → test đối chiếu ảnh mẫu với repo gốc; đọc kỹ `lib.rs` (không chỉ ALGORITHM_IMPROVEMENTS.md).
- **Canvas cực cao (12000px+) tốn RAM khi raw()** → scan theo hàng/stride, hoặc grayscale downscale khi phân tích (giữ canvas gốc để crop).
- **Band vẫn có thể lệch** → chỉ là *đề xuất*; người kéo chỉnh ở Phase 4 là chốt chặn.
