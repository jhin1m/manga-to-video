# Manga Content Extractor (Stage 1 + 1.5)

Tool nội bộ, một người vận hành. Xử lý manga theo hai stage:

**Stage 1:** Nhận chapter (nhiều ảnh đánh số / file zip / file PDF) → **gộp toàn bộ thành một canvas dọc rồi smart-split lại thành band** tại khoảng an toàn (không cắt ngang bubble/chữ) → gọi vision LLM (OpenAI-compatible) → bảng nội dung từng band (`mô tả + thoại + ghi chú`, tiếng Việt) → sửa tay inline → xuất **JSON manifest**.

**Stage 1.5:** Từ chapter hoặc manifest, tạo **storyboard** = danh sách nhịp hình ảnh + lời đọc (dành cho TTS + video tạo Ken Burns). Mỗi band từ lúc upload = 1 nhịp — biên nhịp đã chuẩn từ ingest nên không cần tách/gộp tay. Nhịp thiếu nội dung (chưa chạy Stage 1) bấm **Generate** (vision) hoặc điền tay.

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
| `MAX_EDGE` | Cạnh dài tối đa ảnh gửi model (px, downscale trước khi encode). Ảnh dải dọc (ratio ≥ `STRIP_RATIO`) chỉ kẹp **bề rộng** theo ngưỡng này; giữ nguyên chiều cao để stitch/smart-split không mất chữ. Payload vision luôn ≤ `MAX_EDGE` | `1568` |
| `VISION_CONCURRENCY` | Số ảnh gọi vision song song | `4` |
| `VISION_RPM` | Nhịp tối đa khi bấm Chạy (requests/phút) — giãn thời điểm bắt đầu mỗi request để chặn 429; chỉnh nhanh mỗi lượt bằng ô "Nhịp" cạnh nút Chạy | `30` |
| `VISION_DISABLE_THINKING` | Tắt "thinking/reasoning" của model (GLM z.ai) để tiết kiệm ~50% token | `false` |

Chuyển sang Z.AI GLM: `OPENAI_BASE_URL=https://api.z.ai/api/paas/v4` + `VISION_MODEL=glm-4.5v` + `VISION_DISABLE_THINKING=true`.

**Ingest gộp + chia band (mọi upload)**

| Biến | Ý nghĩa | Mặc định |
|------|---------|----------|
| `PDF_SCALE` | Hệ số phóng khi render PDF (1 = 72dpi; 2 = 144dpi đủ nét trước downscale) | `2` |
| `STRIP_RATIO` | Tỉ lệ cao/rộng ≥ ngưỡng này coi là ảnh dải dọc: downscale chỉ kẹp bề rộng, giữ chiều cao | `2.5` |
| `SPLIT_HEIGHT` | Chiều cao band mục tiêu khi smart-split (px trên canvas gộp lúc upload). Band = 1 nhịp video, thu về `MAX_EDGE` trước vision → band quá cao làm chữ nát | `1600` |
| `SCAN_LINE_STEP` | Bước nhảy (px) khi dò safe-line quanh vị trí cắt mục tiêu | `5` |
| `LINE_TOLERANCE` | Hàng "an toàn" khi chênh lệch 2 pixel liền kề ≤ ngưỡng này (0-255; 25 ≈ 90% sensitivity) | `25` |
| `MIN_DISTANCE_PCT` | Khoảng cách tối thiểu giữa 2 điểm cắt, tính theo % `SPLIT_HEIGHT` — chặn band quá nhỏ | `40` |
| `IGNORABLE_BORDER` | Bỏ qua N px sát mép trái/phải khi xét safe-line (viền, watermark dọc mép) | `5` |

## Luồng sử dụng (Stage 1)

1. Kéo thả ảnh (`1.jpg, 2.jpg, …` — thứ tự đọc theo natural sort tên file) hoặc 1 file `.zip` / `.pdf` (file rác macOS trong zip tự bị lọc).
2. **Tải lên & xem trước** → tạo job: downscale từng ảnh → **gộp toàn bộ thành một canvas dọc → smart-split thành band** (`band-1.jpg, band-2.jpg, …`) — **chưa gọi vision**; hiện lưới thumbnail band theo thứ tự đọc.
3. Chỉnh **Nhịp** (req/phút) nếu cần rồi bấm **Chạy tất cả** → vision cho từng band, theo dõi tiến độ realtime (SSE, có poll dự phòng). Request được giãn nhịp để tránh lỗi 429.
4. Band lỗi hiện badge đỏ + nút **Thử lại** (lỗi từng band được cô lập, không làm sập job).
5. **Sửa** nội dung inline → **Lưu**.
6. **Export JSON** → tải `manifest-<jobId>.json`.
7. (Hoặc từ trang chính) **Tạo storyboard** (nút xuất hiện ở phase `ready` / `done`) → nhảy sang `/storyboard/{jobId}`.

## Luồng sử dụng (Stage 1.5 — Storyboard)

1. Tạo storyboard qua nút **"Tạo storyboard"** (trang chính) hoặc trực tiếp `/api/jobs/{id}/storyboard` → **mỗi band = 1 nhịp**, region `null` (trọn band), narration pre-fill từ content Stage 1 (template thuần, không gọi vision).
2. Trang `/storyboard/{jobId}` hiển thị danh sách nhịp + preview hình.
3. Biên tập nhịp:
   - **Narration** (lời đọc): sửa tay, durationHint tự cập nhật theo độ dài.
   - **Region**: input số x/y/w/h (hoặc tick "Cả trang").
   - **Generate ✨**: gọi vision cho riêng nhịp đó (crop vùng nhịp → mô tả + thoại) — dùng khi chưa chạy Stage 1, khi band lỗi, hoặc muốn soạn lại từ ảnh.
   - **Reorder** (▲▼): xếp thứ tự nhịp.
4. Export → tải `storyboard-<jobId>.json` (manifest v1, hợp đồng cho TTS/video).
5. Import: upload manifest + đúng bộ ảnh gốc → ingest gộp + chia band tái lập y phiên export (cần cùng `MAX_EDGE`/`SPLIT_HEIGHT`…).

Có thể tạo storyboard **ngay từ phase xem trước** (chưa chạy Stage 1): mọi nhịp trống → bấm Generate từng nhịp cần thiết, không đốt vision cho cả chapter.

## API (Stage 1)

| Method | Route | Chức năng |
|--------|-------|-----------|
| POST | `/api/jobs` | multipart (`images[]` / `zip` / `pdf`) → tạo job ở phase `ready` (downscale → gộp canvas → chia band, **chưa** gọi vision) → trả về `{jobId, progress, items}` — item là band |
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
| POST | `/api/jobs/{id}/storyboard` | không body → tạo storyboard từ job (1 band = 1 nhịp, narration từ content Stage 1). Trả về `{jobId, createdAt, sourceKind, progress, working, beats}` ở phase `queued` |
| GET | `/api/jobs/{id}/storyboard` | trạng thái + beat hiện tại |
| GET | `/api/jobs/{id}/storyboard/stream` | SSE tiến độ compose |
| GET | `/api/jobs/{id}/storyboard/export` | storyboard manifest JSON (v1) |
| PATCH | `/api/jobs/{id}/storyboard/beats/{beatId}` | sửa beat `{narration?, region?, order?}` (region chuẩn: x/y ≥ 0, w/h ≥ 1, trong biên ảnh nguồn) |
| POST | `/api/jobs/{id}/storyboard/beats/{beatId}/generate` | **Generate bằng vision**: crop vùng nhịp → mô tả + thoại → narration (lỗi cô lập vào beat) |
| POST | `/api/jobs/{id}/storyboard/beats/{beatId}/retry` | compose lại từ content Stage 1 (không gọi vision) |
| GET | `/api/jobs/{id}/storyboard/beats/{beatId}/crop` | preview crop JPEG theo region hiện tại |
| POST | `/api/jobs/{id}/storyboard/beats/reorder` | body `{beatId, to}` → sắp xếp lại |
| GET | `/api/jobs/{id}/storyboard/working/{i}/image` | preview working image (ảnh band) |
| POST | `/api/storyboard/import` | multipart (`manifest`, `images[]`/`zip`) → tạo job mới (ingest gộp + chia band như upload) + nạp lại storyboard từ manifest |

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
- `sourceKind`: export mới luôn là `'pages'` (mỗi band 1 nhịp); `'strip'` chỉ còn ở manifest cũ (import vẫn đọc được)
- `beatCount` = số nhịp
- **beats**:
  - `id`: UUID nhịp (truy vết retry/generate)
  - `order`: thứ tự hiển thị (tăng từ 0)
  - `sourceIndex`: trỏ working image (index band)
  - `region`: null = trọn band; nếu có = `{x, y, w, h}` (px, người biên tập chọn manual)
  - `narration`: lời đọc cuối cùng (template pre-fill + sửa tay)
  - `sourceDialogue`: truy vết thoại gốc từ 2A/manifest (opt)
  - `durationHint`: ước lượng giây (15 ký tự/giây tiếng Việt; Stage 2 tinh chỉnh)
  - `error`: nếu beat bị lỗi (stage 1.5, opt)

## Kiến trúc

**Chung:**
- `lib/schema.ts` — hợp đồng dữ liệu (Manifest, StoryboardManifest, Beat, BeatRegion…; không import Node).
- `lib/jobs.ts` — store in-memory job + item (Map trên globalThis, sống sót HMR) + event bus tiến độ.
- `lib/vision.ts` — vision LLM client (OpenAI-compatible, adaptive json-mode, retry 429/5xx/mạng, parse chịu ```json fences).
- `lib/pipeline.ts` — unzip/lọc ảnh, natural sort, downscale sharp, **ingest gộp + chia band** (`ingestBandItems`: stitch → smart-split → crop), p-limit + cổng nhịp (rpm).

**Ingest & Storyboard:**
- `lib/pdf.ts` — render PDF → Buffer ảnh dùng `pdf-to-img` (Node 24).
- `lib/source-kind.ts` — ngưỡng `STRIP_RATIO` cho nhánh downscale ảnh dải dọc.
- `lib/stitch.ts` — nối các ảnh thành một canvas dọc (căn giữa slice hẹp).
- `lib/smart-split.ts` — port SmartStitch (jhin1m/manhwa-sticher): detect safe-line, chia band né bubble/SFX.
- `lib/narration.ts` — compose narration template từ content Stage 1; nhánh vision (Generate) crop vùng nhịp → describeImage; rev-guard per-beat.
- `lib/storyboard-store.ts` — in-memory storyboard + working image (Map per-jobId, sống sót HMR).

**Routes & UI:**
- `app/api/jobs/**` — 8 route Stage 1 (POST/GET/PATCH/POST retry).
- `app/api/jobs/{id}/storyboard**` — 9 route Stage 1.5 (POST create / PATCH beat / POST generate-retry-reorder / GET crop-export-stream-working).
- `app/api/storyboard/import` — nạp lại từ manifest + ảnh.
- `app/page.tsx` — UI một trang: upload (gộp + chia band) → xem trước → [Chạy Stage 1 | Tạo storyboard] → progress → edit/export.
- `app/storyboard/[jobId]/page.tsx` — UI storyboard: danh sách nhịp → chỉnh narration/region, Generate ✨ per-beat, reorder → export/import.

## Kiểm thử

**Unit tests** (ingest, banding, narration):
```bash
npm run test:unit
```
Kiểm tra downscale/bound, smart-split band detection, ingest gộp + chia band, narration compose (42 assert).

**E2E test** (đầu tào cuối):
```bash
npm run mock:vision   # Mock OpenAI vision (port 3106)
PORT=3105 OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://localhost:3106/v1 \
VISION_MODEL=mock-vision VISION_RPM=600 SPLIT_HEIGHT=1000 npm run dev
npm run test:e2e      # upload band/Stage 1/storyboard/Generate/reorder/import/export/PDF (55 assert)
```

Test scripts: `content-extractor/scripts/` (`verify-ingest.mts`, `verify-banding.mts`, `verify-narration.mts`, `mock-openai-vision.mjs`, `e2e-storyboard.mts`).

## Known Limitations (v1, ghi nhận cho Stage 2)

- **Import phụ thuộc env:** Band tái lập từ ảnh gốc — cần cùng `MAX_EDGE`/`SPLIT_HEIGHT`/settings smart-split như phiên export, khác đi là `sourceIndex` lệch (được validate, báo 400). Cân nhắc nhúng settings vào manifest v2.
- **Memory canvas:** Mỗi upload stitch toàn bộ chapter thành một canvas rồi raw-decode khi smart-split — chapter rất dài tốn RAM tạm thời (dev tool chấp nhận, ghi chú).
- **PDF trong zip:** Bỏ qua (chỉ nhận PDF upload trực tiếp).
- **UI beat:** Kéo-thả handle chưa có — dùng input số x/y/w/h.
