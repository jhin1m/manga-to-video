# Brainstorm → Plan: Tiến trình cho Upload / Generate all / Tạo kịch bản

**Ngày:** 2026-07-23 13:49 · **App:** `content-extractor` (Next 16, React 19, shadcn `Progress`, `sonner`) · **Trạng thái:** đã duyệt thiết kế, chuyển plan.

## Vấn đề
3 bước thiếu/thiếu-rõ phản hồi tiến trình, người dùng không biết hệ thống đang làm gì:
1. **Upload ảnh** — chỉ có chữ "Đang tải lên & xử lý ảnh…", không % nào.
2. **Storyboard "Generate all"** — đã có progress bar nhưng muốn rõ/chi tiết hơn.
3. **Tạo kịch bản** — chỉ đổi chữ nút "Đang biên kịch…", không progress.

## Yêu cầu chốt (từ discovery)
- **Output:** mỗi bước có phản hồi tiến trình trực quan (thanh + nhãn), khớp vòng đời từng thao tác.
- **Nghiệm thu:** (A) thấy % tải lên + bước xử lý server đếm được; (B) Generate all thêm %, ETA, nhịp đang chạy; (C) Tạo kịch bản có bộ đếm ký tự/token real-time + nhãn pha.
- **Ngoài phạm vi:** không queue/DB (giữ in-memory single-user), không đổi thuật toán band-split/vision/model, không làm progress TTS/render.
- **Ràng buộc:** chỉ thêm progress, tái dùng pattern `Progress`/SSE/store-bus sẵn có; đọc guide Next 16 trong `node_modules/next/dist/docs/` trước khi viết (per AGENTS.md).
- **Touchpoints:** `app/page.tsx`, `app/api/jobs/route.ts`, `lib/pipeline.ts`; `app/storyboard/[jobId]/page.tsx`; `app/script/[jobId]/page.tsx`, `app/api/jobs/[id]/storyboard/script/route.ts`, `lib/script.ts`, `lib/vision.ts` (createCompletion).

## Hiện trạng (scout)
- Upload: 1 `fetch` FormData → `POST /api/jobs` blocking; `ingestBandItems` làm hết trong 1 request, không stream ngược. `fetch` KHÔNG báo được % bytes upload.
- Generate all: ĐÃ có `POST /storyboard/generate` (fire-and-forget) + SSE `/storyboard/stream` phát `JobProgress{done,total,currentIndex,phase}` từng nhịp; client `attachStream()` + `<Progress>` + poll fallback. **Backend đủ dữ liệu.**
- Script: 1 `fetch` blocking. Bên trong `resolveMissingContent` (đếm được) → `generateScript` = **1 call model JSON-mode non-streaming** (`completeJson`→`createCompletion`, có `withRetry` 4 lần + `REPAIR_NUDGE`) → `splitTallShotsInJob`.
- Hạ tầng tái dùng: event `bus`+`subscribeStoryboard`+`updateStoryboardProgress` trong `storyboard-store.ts`.

## Thiết kế 3 workstream

### A. Upload — cả 2 pha, 1 XHR + response NDJSON stream
- Client `app/page.tsx`: thay `fetch` bằng `XMLHttpRequest`.
  - `xhr.upload.onprogress` → **pha 1** % bytes → `<Progress>` "Đang tải lên 62%".
  - `xhr.onprogress` đọc dần `responseText` (NDJSON) → **pha 2** bước xử lý; dòng cuối = `JobStatusDTO`.
- Server `POST /api/jobs`: trả `ReadableStream` NDJSON; phát mốc: expandPdfs (mỗi trang) → extractImages → ingestBandItems (downscale từng ảnh → detectBands → cắt từng band). Thêm callback `onProgress` cho `ingestBandItems`/`expandPdfs` trong `lib/pipeline.ts`.
- Trade-off: `req.formData()` nuốt hết buffer trước pha-2 → khoảng chờ giữa 2 pha, thanh pha-1 che. Lỗi → dòng `{phase:'error',message}` → toast.

### B. Generate all — làm giàu client-only, KHÔNG đụng backend
Dữ liệu đủ sẵn (progress + beats + rpm ở client). Thêm ở `app/storyboard/[jobId]/page.tsx`:
- % rõ ràng cạnh nhãn.
- ETA = `(total-done) × 60000/rpm` → "còn ~2 phút".
- Nhịp đang chạy từ `currentIndex` → "Đang soạn nhịp 5/12: '<đầu narration>'", auto-highlight/scroll cột trái.

### C. Tạo kịch bản — stream token real-time
- **Ràng buộc hình hài:** model JSON-mode → stream về là JSON thô → hiển thị **bộ đếm ký tự/token** ("~1.240 ký tự…") + bar vô định, KHÔNG phải preview đọc được (preview cần parse-JSON-từng-phần mong manh hoặc bỏ JSON-mode — không làm).
- Model call: thêm nhánh streaming (`stream:true`, gom `delta.content`) rồi `parseScriptJSON` chuỗi đầy đủ; **giữ** `withRetry`+`REPAIR_NUDGE` (retry = stream mới, counter reset → "Đang thử lại lần k…").
- Server `POST /storyboard/script`: trả NDJSON stream; pha `resolveMissingContent` (đếm được "Bổ sung 2/3 band") → `writing` (chars) → `splitting`; giữ guard `setScriptGenerating` (409).
- Client `app/script/[jobId]/page.tsx`: đọc stream → counter + nhãn pha + bar animate.

### Transport (đồng nhất theo vòng đời)
- Upload + Kịch bản → **NDJSON trên chính response POST** (một-lần, chờ tại chỗ, chết theo request → không cần bus/uploadId).
- Generate all → **giữ SSE + store-bus** (job nền thật, rời trang quay lại vẫn thấy).

## Rủi ro
1. Provider có thể không trả token-usage trong stream → dùng độ dài `delta.content`, không phụ thuộc `usage`.
2. `stream:true` kèm `thinking:{type:'disabled'}` + json-mode: thử thật 1 lượt để chắc endpoint chịu.
3. Next 16 stream response + `req.formData()`: return `ReadableStream` đúng cách (tiền lệ `/storyboard/stream`).

## Công sức
B nhỏ (client-only) · A vừa (refactor pipeline + XHR) · C vừa→lớn (streaming model + retry semantics).

## Câu hỏi mở
- C: có cần fallback về non-streaming khi endpoint từ chối `stream:true` không (giữ đường lùi giống json-mode fallback)? → nên có, xác nhận lúc plan.
