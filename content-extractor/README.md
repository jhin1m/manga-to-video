# Manga Content Extractor (Stage 1 + 1.5)

Tool nội bộ, một người vận hành. Xử lý manga theo hai stage:

**Stage 1:** Nhận chapter (nhiều ảnh đánh số / file zip / file PDF) → gọi vision LLM (OpenAI-compatible) → bảng nội dung từng trang (`mô tả + thoại + ghi chú`, tiếng Việt) → sửa tay inline → xuất **JSON manifest**.

**Stage 1.5:** Từ chapter hoặc manifest, tạo **storyboard** = danh sách nhịp hình ảnh + lời đọc (dành cho TTS + video tạo Ken Burns). Hỗ trợ 2 loại nguồn: **trang rời (pages)** hoặc **dải dọc (strip/webtoon)** — tự phân loại từ aspect ratio ảnh. Nguồn dải dọc có thể tạo storyboard NGAY từ phase xem trước (không cần chạy Stage 1 trước — 2A tự trích xuất nội dung). Trang rời cần chạy Stage 1 trước.

Không DB, không auth, không queue. Job sống trong RAM — restart server là mất; **file JSON export chính là bản lưu**.

## Chạy

Yêu cầu Node 24 (`.nvmrc` đã pin; máy dùng Herd nvm thì `nvm use 24`).

```bash
npm install
cp .env.example .env.local   # rồi điền OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

## Cấu hình (ENV — đổi nhà cung cấp không cần sửa code)

**Vision LLM (Stage 1)**

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `OPENAI_API_KEY` | API key (bắt buộc) | — |
| `OPENAI_BASE_URL` | Endpoint OpenAI-compatible | `https://api.openai.com/v1` |
| `VISION_MODEL` | Model vision | `gpt-4o-mini` |
| `MAX_EDGE` | Cạnh dài tối đa ảnh gửi model (px, downscale trước khi encode). Ảnh dải dọc (`sourceKind='strip'`) chỉ kẹp **bề rộng** theo ngưỡng này; giữ nguyên chiều cao để stitch/smart-split không mất chữ. Payload vision luôn ≤ `MAX_EDGE` | `1568` |
| `VISION_CONCURRENCY` | Số ảnh gọi vision song song | `4` |
| `VISION_RPM` | Nhịp tối đa khi bấm Chạy (requests/phút) — giãn thời điểm bắt đầu mỗi request để chặn 429; chỉnh nhanh mỗi lượt bằng ô "Nhịp" cạnh nút Chạy | `30` |
| `VISION_DISABLE_THINKING` | Tắt "thinking/reasoning" của model (GLM z.ai) để tiết kiệm ~50% token | `false` |

Chuyển sang Z.AI GLM: `OPENAI_BASE_URL=https://api.z.ai/api/paas/v4` + `VISION_MODEL=glm-4.5v` + `VISION_DISABLE_THINKING=true`.

**Storyboard (Stage 1.5)**

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `PDF_SCALE` | Hệ số phóng khi render PDF (1 = 72dpi; 2 = 144dpi đủ nét trước downscale) | `2` |
| `STRIP_RATIO` | Tỉ lệ cao/rộng ≥ ngưỡng này được coi là dải dọc (webtoon strip); phân nhánh xử lý stitch + smart-split | `2.5` |
| `SPLIT_HEIGHT` | Chiều cao band mục tiêu khi smart-split (px trên canvas làm việc). Band = 1 nhịp video, thu về `MAX_EDGE` trước vision → band quá cao làm chữ nát | `1600` |
| `SCAN_LINE_STEP` | Bước nhảy (px) khi dò safe-line quanh vị trí cắt mục tiêu | `5` |
| `LINE_TOLERANCE` | Hàng "an toàn" khi chênh lệch 2 pixel liền kề ≤ ngưỡng này (0-255; 25 ≈ 90% sensitivity) | `25` |
| `MIN_DISTANCE_PCT` | Khoảng cách tối thiểu giữa 2 điểm cắt, tính theo % `SPLIT_HEIGHT` — chặn band quá nhỏ | `40` |
| `IGNORABLE_BORDER` | Bỏ qua N px sát mép trái/phải khi xét safe-line (viền, watermark dọc mép) | `5` |

## Luồng sử dụng (Stage 1)

1. Kéo thả ảnh (`1.jpg, 2.jpg, …` — thứ tự đọc theo natural sort tên file) hoặc 1 file `.zip` / `.pdf` (file rác macOS trong zip tự bị lọc).
2. **Tải lên & xem trước** → tạo job (downscale ảnh) nhưng **chưa gọi vision**; hiện lưới thumbnail theo thứ tự đọc. Tự phân loại: dải dọc (`STRIP_RATIO` ≥ ratio) = "Webtoon" / trang rời = "Manga Pages".
3. Chỉnh **Nhịp** (req/phút) nếu cần rồi bấm **Chạy tất cả** → theo dõi tiến độ realtime (SSE, có poll dự phòng). Request được giãn nhịp để tránh lỗi 429.
4. Ảnh lỗi hiện badge đỏ + nút **Thử lại** (lỗi từng ảnh được cô lập, không làm sập job).
5. **Sửa** nội dung inline → **Lưu**.
6. **Export JSON** → tải `manifest-<jobId>.json`.
7. (Hoặc từ trang chính) **Tạo storyboard** (nút xuất hiện ở phase `ready` / `done`) → nhảy sang `/storyboard/{jobId}`.

## Luồng sử dụng (Stage 1.5 — Storyboard)

**Từ job stage 1:**
1. Tạo storyboard qua nút **"Tạo storyboard"** (trang chính) hoặc trực tiếp `/api/jobs/{id}/storyboard` → nếu dải dọc: stitch + smart-split thành band, tự tạo narration từ 2A dialogue; nếu trang rời: 1 beat/trang, region `null` (toàn trang).
2. Trang `/storyboard/{jobId}` hiển thị danh sách beat + preview hình (kéo overlay trên canvas để chọn region hoặc nhập tọa độ x/y/w/h).
3. Biên tập nhịp:
   - **Narration** (lời đọc): sửa tay, durationHint tự cập nhật theo độ dài.
   - **Region**: overlay trên canvas hoặc input số (giữ nguyên hay xóa để cả trang).
   - **Split/Merge/Reorder**: chia beat / gộp 2 beat liền kề / xếp thứ tự.
   - **Retry beat**: gọi lại vision nếu 2A sai, nhưng region được đổi giữ nguyên (compose tươi).
4. Export → tải `storyboard-<jobId>.json` (manifest v1, hợp đồng cho TTS/video).
5. Import: upload manifest + ảnh (zip/folder) để phục hồi session (dải dọc: stitch lại, trang rời: giữ nguyên).

**Từ ảnh dải dọc (mà không cần chạy Stage 1):**
- Nếu upload dải dọc mà không sửa nội dung, **tạo storyboard NGAY từ phase xem trước** (nút "Tạo storyboard") — tự detect band + narration template, skip Stage 1. Pages không hỗ trợ cách này (vì cần vision per-page).

## API (Stage 1)

| Method | Route | Chức năng |
|--------|-------|-----------|
| POST | `/api/jobs` | multipart (`images[]` / `zip` / `pdf`) → tạo job ở phase `ready` (downscale, **chưa** gọi vision) → trả về `{jobId, progress, items}` |
| POST | `/api/jobs/{id}/run` | body `{rpm?}` → vision cho toàn bộ item (rate limit), pipeline nền |
| GET | `/api/jobs/{id}` | trạng thái + item |
| GET | `/api/jobs/{id}/stream` | SSE tiến độ (snapshot + real-time updates) |
| GET | `/api/jobs/{id}/export` | manifest JSON (attachment) |
| PATCH | `/api/jobs/{id}/items/{i}` | sửa `{description?, dialogue?, note?}` |
| GET | `/api/jobs/{id}/items/{i}/image` | thumbnail JPEG (downscale) |
| POST | `/api/jobs/{id}/items/{i}/retry` | vision lại cho 1 item |

## API (Stage 1.5 — Storyboard)

| Method | Route | Chức năng |
|--------|-------|-----------|
| POST | `/api/jobs/{id}/storyboard` | body `{overridePagesOrStrip?, rpm?}` → tạo storyboard từ job (dải dọc: stitch + smart-split, trang rời: 1 beat/page). Trả về `{jobId, createdAt, sourceKind, progress, working, beats}` ở phase `queued` |
| GET | `/api/jobs/{id}/storyboard` | trạng thái + beat hiện tại |
| GET | `/api/jobs/{id}/storyboard/stream` | SSE tiến độ compose |
| GET | `/api/jobs/{id}/storyboard/export` | storyboard manifest JSON (v1) |
| PATCH | `/api/jobs/{id}/storyboard/beats/{beatId}` | sửa beat `{narration?, region?, error?}` (region chuẩn: x/y/w/h ≥ 0 và w/h ≥ 1) |
| POST | `/api/jobs/{id}/storyboard/beats/{beatId}/retry` | vision lại (narration tươi, region giữ nguyên) |
| POST | `/api/jobs/{id}/storyboard/beats/{beatId}/crop` | body `{region}` → preview crop |
| POST | `/api/jobs/{id}/storyboard/beats/split` | body `{beatId, splitAtOrder}` → chia 1 beat |
| POST | `/api/jobs/{id}/storyboard/beats/merge` | body `{beatId1, beatId2}` → gộp 2 beat liền kề |
| POST | `/api/jobs/{id}/storyboard/beats/reorder` | body `{beatId, newOrder}` → sắp xếp lại |
| GET | `/api/jobs/{id}/storyboard/working/{i}/image` | preview working image (canvas dải dọc / trang pages) |
| POST | `/api/storyboard/import` | multipart (`manifest`, `images[]`/`zip`) → tạo job mới + nạp lại storyboard từ manifest |

## Manifest (Stage 1 — hợp đồng cho TTS v1)

```json
{
  "version": 1,
  "jobId": "uuid",
  "createdAt": "ISO-8601",
  "itemCount": 3,
  "items": [
    { "index": 0, "filename": "1.jpg", "content": { "description": "…", "dialogue": ["…"], "note": "" } }
  ]
}
```

Item lỗi chưa retry: `"error": "…"` + `content: null`.

## StoryboardManifest (Stage 1.5 — hợp đồng cho TTS/video)

```json
{
  "version": 1,
  "jobId": "uuid",
  "createdAt": "ISO-8601",
  "sourceKind": "strip|pages",
  "beatCount": 5,
  "beats": [
    {
      "id": "uuid",
      "order": 0,
      "sourceIndex": 0,
      "region": { "x": 0, "y": 100, "w": 1024, "h": 800 },
      "narration": "Lời đọc…",
      "sourceDialogue": ["…"],
      "durationHint": 3,
      "error": null
    }
  ]
}
```

**Hợp đồng:**
- `version` = 1 (Stage 2: TTS/video dùng phiên bản này)
- `sourceKind`: `'pages'` (trang rời) hoặc `'strip'` (dải dọc stitch)
- `beatCount` = số nhịp
- **beats**:
  - `id`: UUID nhịp (lưu để merge/split/retry trace)
  - `order`: thứ tự hiển thị (tăng từ 0)
  - `sourceIndex`: trỏ working image (canvas strip hoặc index trang)
  - `region`: null = cả canvas/trang; nếu có = `{x, y, w, h}` (px, người biên tập chọn manual)
  - `narration`: lời đọc cuối cùng (template pre-fill + sửa tay)
  - `sourceDialogue`: truy vết thoại gốc từ 2A/manifest (opt)
  - `durationHint`: ước lượng giây (15 ký tự/giây tiếng Việt; Stage 2 tinh chỉnh)
  - `error`: nếu beat bị lỗi (stage 1.5, opt)

## Kiến trúc

**Chung:**
- `lib/schema.ts` — hợp đồng dữ liệu (Manifest, StoryboardManifest, Beat, BeatRegion…; không import Node).
- `lib/jobs.ts` — store in-memory job + item (Map trên globalThis, sống sót HMR) + event bus tiến độ.
- `lib/vision.ts` — vision LLM client (OpenAI-compatible, adaptive json-mode, retry 429/5xx/mạng, parse chịu ```json fences).
- `lib/pipeline.ts` — unzip/lọc ảnh, natural sort, downscale sharp (một lần lúc ingest, buffer dùng chung), p-limit + cổng nhịp (rpm).

**Stage 1.5 (Storyboard):**
- `lib/pdf.ts` — render PDF → Buffer ảnh dùng `pdf-to-img` (Node 24).
- `lib/source-kind.ts` — phân loại job (pages/strip) từ aspect ratio item.
- `lib/stitch.ts` — nối dải dọc thành canvas (horizontal concatenation).
- `lib/smart-split.ts` — port SmartStitch (jhin1m/manhwa-sticher): detect safe-line, chia band né bubble/SFX.
- `lib/narration.ts` — compose narration template từ 2A dialogue/description (per-beat, không LLM; rev-guard theo per-beat).
- `lib/storyboard-store.ts` — in-memory storyboard + working image (Map per-jobId, sống sót HMR).

**Routes & UI:**
- `app/api/jobs/**` — 8 route Stage 1 (POST/GET/PATCH/POST retry).
- `app/api/jobs/{id}/storyboard**` — 11 route Stage 1.5 (POST create / PATCH beat / POST split-merge-reorder / POST retry / POST crop / GET export-stream / GET working image).
- `app/api/storyboard/import` — nạp lại từ manifest + ảnh.
- `app/page.tsx` — UI một trang: upload → xem trước → [Chạy Stage 1 | Tạo storyboard] → progress → edit/export.
- `app/storyboard/[jobId]/page.tsx` — UI storyboard: danh sách beat + canvas overlay → chỉnh narration/region/split-merge → export/import.

## Kiểm thử

**Unit tests** (ingest, banding, narration):
```bash
npm run test:unit
```
Kiểm tra downscale/bound, smart-split band detection, narration compose (18 assert).

**E2E test** (đầu tào cuối):
```bash
npm run mock:vision   # Khởi động mock OpenAI vision (port 3001)
npm run dev           # Khởi động server dev (port 3000) với env mock
npm run test:e2e      # Chạy test (pages/strip/PDF/edit/split-merge/import/export, 58 assert)
```

Test scripts: `content-extractor/scripts/` (`verify-ingest.mts`, `verify-banding.mts`, `verify-narration.mts`, `mock-openai-vision.mjs`, `e2e-storyboard.mts`).

## Known Limitations (v1, ghi nhận cho Stage 2)

- **Pages split:** Retry cả 2 nửa cho cùng narration full-page (compose pages bỏ qua region).
- **Manifest metadata:** Chưa nhúng filename/dims → import nhầm bộ ảnh cùng số lượng chỉ bị bắt khi region vượt biên. Cân nhắc manifest v2.
- **Memory canvas strip:** Raw decode toàn phần khi smart-split (dev tool chấp nhận, ghi chú).
- **PDF trong zip:** Bỏ qua (chỉ nhận PDF upload trực tiếp).
- **UI beat:** Kéo-thả handle chưa có — dùng overlay chọn + input số x/y/w/h.
