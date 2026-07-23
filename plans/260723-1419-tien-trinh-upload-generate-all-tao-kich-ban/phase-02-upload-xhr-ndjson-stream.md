---
phase: 2
title: "Upload — tiến trình 2 pha (XHR + NDJSON stream)"
status: done
priority: P1
effort: "5-7h"
dependencies: [1]
---

# Phase 2: Upload — tiến trình 2 pha (XHR + NDJSON stream)

## Overview
Hiện `POST /api/jobs` là 1 `fetch` blocking, UI chỉ có chữ "Đang tải lên & xử lý ảnh…". Phase này cho thấy CẢ hai pha bằng **một** `XMLHttpRequest`: pha-1 = % bytes tải lên (`xhr.upload.onprogress`), pha-2 = các bước xử lý server đọc dần từ **NDJSON** ghi vào response body. Đồng thời tạo **helper NDJSON dùng chung** (server writer + client reader) mà Phase 3 sẽ tái dùng.

## Requirements
- Functional:
  - Pha 1: `<Progress>` + "Đang tải lên {pct}%" theo bytes browser→server.
  - Pha 2: sau khi upload xong, hiện bước xử lý đếm được: nở PDF (mỗi trang), giải nén, downscale (i/N ảnh), gộp dải, chia band, cắt band (i/M).
  - Dòng NDJSON cuối = `JobStatusDTO` đầy đủ → client set state y như hành vi cũ (jobId, items, context, publish).
  - Pha-2 **luôn hiện** kể cả chapter nhỏ xử lý nhanh (KHÔNG debounce/ẩn) — quyết định Validation S1.
<!-- Updated: Validation Session 1 - luôn hiện pha-2, không debounce -->
  - Lỗi (ảnh hỏng / zip lỗi / PDF lỗi / config vision) → phát 1 dòng `{type:'error', status, message}` → client toast, không set job.
- Non-functional:
  - Giữ nguyên hợp đồng thành công: response cuối vẫn là `JobStatusDTO` (chỉ bọc trong NDJSON).
  - Không đổi thuật toán ingest; chỉ thêm callback tiến trình.
  - Reduced-motion cho thanh; XHR có `onerror`/`ontimeout` → toast mạng.

## Architecture
### Transport dùng chung (tạo mới ở phase này, Phase 3 tái dùng)
- **Server writer** `lib/ndjson-stream.ts`: helper tạo `ReadableStream` + hàm `write(obj)` đẩy `JSON.stringify(obj)+"\n"`, `close()`. Trả `Response` với `Content-Type: application/x-ndjson`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (mẫu headers đã có ở `/storyboard/stream`).
- **Client reader** `lib/ndjson-client.ts`: `readNdjson(xhr, onLine)` — parse phần mới của `xhr.responseText` theo `\n`, giữ con trỏ offset đã đọc, gọi `onLine(obj)` mỗi dòng hoàn chỉnh. (Dùng `xhr.onprogress` chứ không `fetch` — vì XHR mới có `upload.onprogress` cho pha-1.)
  - Lý do XHR thay vì `fetch`+ReadableStream: `fetch` KHÔNG expose upload-bytes progress cross-browser; XHR `upload.onprogress` là cách tin cậy duy nhất. XHR cũng đọc được `responseText` tăng dần trong `onprogress` (download) → 1 request 2 pha.

### Server route
- `POST /api/jobs` đổi trả `Response` NDJSON. Thứ tự: `readVisionConfig()` (lỗi→dòng error) → đọc formData (upload đã xong, pha-1 client đo) → `expandPdfs(onPage)` → `extractImages` → `ingestBandItems(onStep)` → `createJob` → phát dòng cuối `toJobStatusDTO(job)`.
- **Trade-off ghi chú:** `req.formData()` buffer toàn bộ upload trước khi pha-2 chạy → khoảng lặng giữa 2 pha; thanh pha-1 (đạt 100%) che quãng này. Chấp nhận (KISS) — không stream-parse multipart thủ công.

### Pipeline callbacks (`lib/pipeline.ts`)
- `expandPdfs(uploaded, onProgress?)`: gọi `onProgress({stage:'pdf', done, total})` sau mỗi PDF/nhóm trang.
- `ingestBandItems(images, maxEdge, onProgress?)`: phát mốc `{stage:'downscale', done, total}` trong `pLimit` map, `{stage:'stitch'}`, `{stage:'detect'}`, `{stage:'extract', done, total}` khi cắt band. Callback optional → giữ backward-compat cho các caller khác (verify scripts, import).

## Related Code Files
- Create: `content-extractor/lib/ndjson-stream.ts` (server writer helper)
- Create: `content-extractor/lib/ndjson-client.ts` (client reader helper)
- Modify: `content-extractor/app/api/jobs/route.ts` (trả NDJSON stream + phát mốc)
- Modify: `content-extractor/lib/pipeline.ts` (thêm `onProgress?` cho `expandPdfs`, `ingestBandItems`)
- Modify: `content-extractor/app/page.tsx` (thay `fetchJSON('/api/jobs')` bằng XHR 2 pha; state `uploadPct`, `procStep`; UI progress)
- Kiểm tra caller khác của `ingestBandItems`/`expandPdfs`: `grep -rn "ingestBandItems\|expandPdfs" scripts lib app` → đảm bảo param mới optional, không vỡ.

## Implementation Steps
1. Viết `lib/ndjson-stream.ts` (server) + `lib/ndjson-client.ts` (client), có kiểu `IngestProgress` chung (đặt trong `lib/schema.ts` để dùng cả 2 phía, không import Buffer).
2. Thêm `onProgress?` vào `expandPdfs` + `ingestBandItems` trong `lib/pipeline.ts`; phát mốc như Architecture. Giữ chữ ký cũ hoạt động (param cuối optional).
3. Refactor `app/api/jobs/route.ts`: bọc toàn bộ trong NDJSON stream; mỗi bước `write({type:'progress', stage, done, total})`; lỗi `write({type:'error', status, message})` rồi close; thành công `write({type:'done', job: toJobStatusDTO(job)})`.
4. Refactor `app/page.tsx` `handleUpload`: dựng `XMLHttpRequest`, `xhr.upload.onprogress → setUploadPct`, `xhr.onprogress → readNdjson(...)` cập nhật `procStep`; dòng `done` → set job như cũ; `error`/`onerror` → toast. Bỏ nhánh `fetchJSON` cho upload (giữ `fetchJSON` cho PATCH/DELETE).
5. UI: khi `busy`, hiện `<Progress value={uploadPct}/>` + nhãn pha-1; khi pha-2 hiện nhãn "Đang xử lý: {label bước} {done}/{total}". Map stage→nhãn tiếng Việt.
6. Chạy: upload thư mục ảnh thật + 1 zip + 1 PDF; xác nhận cả 2 pha hiện, job tạo đúng, lỗi ảnh hỏng toast rõ.

## Success Criteria
- [x] Upload bộ ảnh lớn: thanh pha-1 chạy tới 100%, rồi pha-2 hiện các bước đếm được, cuối cùng lưới preview hiện đúng như trước (e2e-storyboard upload gộp→band PASS).
- [x] Upload zip và PDF vẫn ra đúng band (không regression ingest) — e2e phủ PDF + gộp canvas.
- [x] Ảnh hỏng giữa chapter → toast lỗi rõ (kèm tên file), không tạo job treo (dòng `error` NDJSON → reject → toast; không set job).
- [x] `expandPdfs`/`ingestBandItems` gọi không kèm callback vẫn chạy (verify-banding PASS — param cuối optional).
- [x] `pnpm test:unit` (gồm `verify-ingest`, `verify-banding`) xanh; `pnpm lint` xanh.

## Risk Assessment
- **`req.formData()` buffer hết upload** trước pha-2: đã tính; thanh pha-1 che. Không stream-parse multipart (YAGNI).
- **XHR responseText tăng dần bị buffer bởi proxy dev**: đặt `X-Accel-Buffering: no` + `no-transform`; Next dev/`next start` không buffer (tiền lệ SSE storyboard chạy tốt).
- **Backward-compat pipeline**: callback optional; test `grep` mọi caller trước khi đổi chữ ký (bước 4 Related Files).
- **Kiểu dùng chung client/server**: `IngestProgress` để ở `lib/schema.ts` (đã có luật "không import Buffer vào schema").
