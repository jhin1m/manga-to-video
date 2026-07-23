# Progress Report — Tiến trình Upload / Generate all / Tạo kịch bản

- **Ngày:** 2026-07-23
- **Workflow:** /ak:cook (chế độ code — thực thi plan có sẵn)
- **Plan:** `plans/260723-1419-tien-trinh-upload-generate-all-tao-kich-ban/`
- **Trạng thái:** DONE (3/3 phase) — 1 nghiệm thu manual còn treo (stream provider thật)

## Tóm tắt
Thêm phản hồi tiến trình trực quan cho 3 bước app `content-extractor` (Next 16 / React 19). Không thêm queue/DB — giữ in-memory single-user. Cơ chế: Phase 1 làm giàu SSE sẵn có (client-only); Phase 2 & 3 dùng NDJSON stream trên chính response POST.

## Đã ship
| Phase | Nội dung | Bằng chứng |
|-------|----------|-----------|
| 1 | Generate all: nhãn %+ETA, dòng nhịp đang chạy, highlight + scroll cột trái (reduced-motion) | client-only, `app/storyboard/[jobId]/page.tsx`; không đụng API/store/schema |
| 2 | Upload 2 pha: XHR `upload.onprogress` (% bytes) → NDJSON bước xử lý đếm được | e2e-storyboard PASS (upload/zip/PDF) |
| 3 | Tạo kịch bản: counter ký tự real-time + nhãn pha (resolving→writing→splitting) + fallback im lặng | e2e-script-video PASS; fallback xác nhận chạy |

**Transport dùng chung (mới):** `lib/ndjson-stream.ts` (server writer) + `lib/ndjson-client.ts` (`readNdjson` XHR / `readNdjsonBody` fetch). Type `IngestProgress` ở `lib/schema.ts`.

## Contract đổi
- POST `/api/jobs` → NDJSON (`{type:progress|done|error}`), thay JSON. Không có GET handler.
- POST `.../storyboard/script` → NDJSON; **guards (404/409/400) vẫn trả JSON TRƯỚC khi mở stream**; GET giữ JSON.
- Caller cập nhật đủ: `app/page.tsx`, `app/script/[jobId]/page.tsx`, `scripts/e2e-storyboard.mts` (4 call `/api/jobs`), `scripts/e2e-script-video.mts` (1 call `/api/jobs` + 1 call `/script`).
- **Lưu ý contract:** lỗi trong stream trả HTTP 200 với dòng `{type:error,status}` (status nằm trong body, không ở HTTP status). Cả 2 client đã xử; monitor ngoài keying theo HTTP status cần biết điều này.

## Gate
- `tsc --noEmit`: PASS (0 lỗi)
- `eslint`: PASS (10 file, gồm react-hooks rule mới)
- `pnpm test:unit`: PASS (9 suite — verify-ingest/banding/narration/script/project/kenburns/ink-bbox/auto-region/settings)
- `pnpm test:e2e` (storyboard): PASS — E2E_ALL_PASS
- `pnpm test:e2e-video` (script+TTS+bundle): PASS — E2E_SCRIPT_VIDEO_ALL_PASS
- Code review (`code-reviewer`): DONE_WITH_CONCERNS — **0 defect chặn**; `completeJson` semantics / parse path / guards / race đều giữ nguyên.

## Không regression (đã verify)
- `completeJson` (vision/recap/script non-hooks): tách `diagnoseAndParse` dùng chung, semantics `finish_reason=length` non-retryable + REPAIR_NUDGE + retry 4 y nguyên.
- `expandPdfs`/`ingestBandItems` gọi không callback (verify-banding): param cuối optional → PASS.
- `generateScript`/`resolveMissingContent`: streaming chỉ đổi cách LẤY chuỗi, không đổi cách XỬ LÝ (parseScriptJSON → toScriptSegments → splitTallShotsInJob).
- `setScriptGenerating` guard 409: đặt đồng bộ trước stream, reset trong `finally` (mọi nhánh gồm error/abort).

## Còn treo (manual — cần API key thật)
Nghiệm thu **counter ký tự real-time** trên provider (z.ai/OpenRouter): xác nhận `stream:true` + `thinking:{disabled}` + `json_object` cùng lúc chịu được. Nếu provider từ chối stream → counter no-op im lặng nhưng kịch bản vẫn đúng (đường lùi non-stream đã kiểm chạy thật qua mock). Đây là rủi ro chính plan đã nêu (Phase 3 bước 5). Cách chạy: bấm "Tạo kịch bản AI" trên UI với 1 chương thật, xem counter có tăng không.
