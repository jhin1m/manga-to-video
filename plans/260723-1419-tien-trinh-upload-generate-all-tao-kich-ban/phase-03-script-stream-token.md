---
phase: 3
title: "Tạo kịch bản — stream token real-time"
status: done
priority: P1
effort: "6-8h"
dependencies: [2]
---

# Phase 3: Tạo kịch bản — stream token real-time

# Overview
Hiện `POST /storyboard/script` là 1 `fetch` blocking, chỉ đổi chữ nút "Đang biên kịch…". Phase này cho thấy tiến trình real-time: đếm ký tự/token model sinh dần + nhãn theo pha. Tái dùng helper NDJSON từ Phase 2.

**Ràng buộc hình hài (quan trọng):** model gọi ở **JSON mode** (`response_format:json_object`) → chuỗi stream là JSON thô, KHÔNG đọc được như văn bản. Nên hiển thị **bộ đếm ký tự** ("Model đã sinh ~1.240 ký tự…") + bar vô định, KHÔNG phải preview lời kể chạy dần. (Preview đọc được cần parse-JSON-từng-phần mong manh hoặc bỏ JSON-mode → không làm, giữ đúng đắn.)

## Requirements
- Functional:
  - Nhãn pha đếm được: `resolveMissingContent` → "Bổ sung nội dung {done}/{total} band".
  - Pha `writing`: bộ đếm ký tự tăng real-time khi model stream.
  - Pha `splitting`: "Chia shot & né bubble…".
  - Retry: khi parse hỏng và `withRetry` thử lại → "Đang thử lại lần {k}…", counter reset.
  - Kết thúc: dòng cuối = `ScriptDTO` đầy đủ (như hành vi cũ), client set state + `publish`.
- Non-functional:
  - **Kết quả kịch bản KHÔNG đổi** so với non-streaming (cùng prompt, cùng parse, cùng `toScriptSegments` + `splitTallShotsInJob`).
  - Giữ `withRetry` (4 lần) + `REPAIR_NUDGE` + `setScriptGenerating` guard (409 chống trùng).
  - Fallback: endpoint từ chối `stream:true` → tự lùi về non-streaming (giữ đường lùi giống json-mode fallback hiện có), vẫn ra kết quả, chỉ mất counter real-time. **IM LẶNG — không toast/không cảnh báo** (quyết định Validation S1); counter chỉ đứng im.
<!-- Updated: Validation Session 1 - fallback stream im lặng, không toast -->

## Architecture
### Streaming model call (`lib/vision.ts` — nơi có `createCompletion`/`completeJson`)
- Thêm `createCompletionStream(client, model, messages, disableThinking, jsonMode, onDelta)`:
  - Gọi `client.chat.completions.create({..., stream:true})`, cộng dồn `chunk.choices[0]?.delta?.content`, gọi `onDelta(totalChars)` (throttle ~10 lần/giây để không spam UI).
  - Trả chuỗi content đầy đủ (giống `res.choices[0].message.content` của bản non-stream).
  - Bắt lỗi "endpoint không hỗ trợ stream" (một số OpenRouter model) → ném lỗi phân loại để caller fallback non-stream.
- Thêm `completeJsonStream<T>(..., parse, label, onDelta)` song song `completeJson`: trong `withRetry`, gọi `createCompletionStream`, parse chuỗi đầy đủ NGAY trong vòng retry (giữ nguyên semantics: parse-lỗi = retry); báo attempt qua callback để UI hiện "thử lại lần k".
  - **DRY:** cân nhắc refactor `completeJson` để nhận `onDelta?`/`onAttempt?` optional thay vì nhân đôi — quyết định lúc code, ưu tiên không lặp logic retry/nudge.

### generateScript streaming (`lib/script.ts`)
- `generateScript(inputs, context, hooks?)` nhận `hooks?: { onChars?, onAttempt? }`; dùng `completeJsonStream` khi có hooks, `completeJson` khi không (giữ caller cũ như recap không đổi).

### Route NDJSON (`app/api/jobs/[id]/storyboard/script/route.ts`)
- Đổi trả NDJSON stream (helper Phase 2). Trình tự trong stream:
  1. Guards hiện có (404/409/`setScriptGenerating`) — nếu fail, phát 1 dòng error (hoặc giữ trả JSON lỗi TRƯỚC khi mở stream cho các guard đồng bộ — đơn giản hơn).
  2. `resolveMissingContent` với callback → `write({type:'progress', phase:'resolving', done, total})`.
  3. `generateScript(resolved, context, { onChars: n => write({type:'progress', phase:'writing', chars:n}), onAttempt: k => write({..., attempt:k}) })`.
  4. `splitTallShotsInJob` → `write({type:'progress', phase:'splitting'})`.
  5. `setScript(...)` → `write({type:'done', script: toScriptDTO(...)})`.
  6. Lỗi → `write({type:'error', status, message})`; `finally setScriptGenerating(false)`.
- Giữ `resolveMissingContent`/`generateScript`/`splitTallShotsInJob` y nguyên logic — chỉ luồn callback.

### Client (`app/script/[jobId]/page.tsx`)
- `generate()` đổi từ `fetchJSON(POST)` sang XHR/`fetch`+reader NDJSON (dùng `lib/ndjson-client.ts`). Vì đây KHÔNG cần upload-bytes progress, có thể dùng `fetch`+`response.body` reader (đơn giản hơn XHR) — nhưng để DRY, tái dùng `readNdjson`; nếu `readNdjson` chỉ nhận XHR thì thêm biến thể nhận `ReadableStream` (quyết định lúc code).
- State: `phase`, `chars`, `attempt`, `resolveDone/Total`. Render: bar animate (indeterminate) + nhãn theo pha + counter.
- Dòng `done` → `setScript(dto)`, `setDrafts({})`, `publish`. `error` → toast.

## Related Code Files
- Modify: `content-extractor/lib/vision.ts` (thêm `createCompletionStream` + `completeJsonStream`, hoặc mở rộng `completeJson` với `onDelta?`/`onAttempt?`)
- Modify: `content-extractor/lib/script.ts` (`generateScript` nhận `hooks?`)
- Modify: `content-extractor/app/api/jobs/[id]/storyboard/script/route.ts` (NDJSON stream + luồn callback; giữ guards)
- Modify: `content-extractor/app/script/[jobId]/page.tsx` (đọc NDJSON, UI counter + nhãn pha)
- Reuse: `content-extractor/lib/ndjson-stream.ts`, `lib/ndjson-client.ts` (Phase 2)
- Kiểm: `resolveMissingContent` signature (`lib/script.ts:124`) có chỗ luồn callback per-band.

## Implementation Steps
1. `lib/vision.ts`: viết `createCompletionStream` (stream:true, cộng dồn delta, throttle onDelta, phân loại lỗi không-hỗ-trợ-stream). Thêm `completeJsonStream` hoặc mở rộng `completeJson` (giữ retry/nudge). Fallback non-stream khi endpoint từ chối.
2. `lib/script.ts`: `generateScript` thêm `hooks?`; luồn `onChars`/`onAttempt`. `resolveMissingContent` thêm `onProgress?(done,total)`.
3. Route: bọc NDJSON; phát `resolving`→`writing`→`splitting`→`done`; giữ mọi guard + `finally setScriptGenerating(false)`. Guard đồng bộ nên trả JSON lỗi trước khi mở stream (đơn giản).
4. Client: `generate()` đọc NDJSON; state + UI (bar indeterminate + counter + nhãn pha + "thử lại lần k").
5. Thử thật 1 lượt trên provider hiện tại (OpenRouter/z.ai): xác nhận `stream:true` + `thinking:{disabled}` + json-mode chịu được; nếu không → nhánh fallback non-stream hoạt động, kết quả vẫn đúng.
6. So sánh kịch bản trước/sau (cùng job) — segments phải tương đương (model phi tất định, nhưng cấu trúc/parse/split path không đổi).

## Success Criteria
- [x] Bấm "Tạo kịch bản AI": thấy counter ký tự tăng real-time + nhãn pha đúng thứ tự (resolving → writing → splitting). *(Thứ tự pha đảm bảo bằng `writing` marker phát ở route trước generateScript; counter real-time cần provider thật để nghiệm thu — mock e2e đi đường fallback.)*
- [x] Kết quả `ScriptDTO` set đúng, `Xác nhận kịch bản` + `Dựng video` hoạt động như cũ (e2e block C/D/E PASS).
- [x] Parse hỏng 1 lần → hiện "thử lại lần 2", cuối cùng vẫn ra kịch bản (verify-script test 2c PASS — retry path non-hooks không đổi; onAttempt phát attempt+1).
- [x] Endpoint từ chối stream → tự fallback non-stream, vẫn ra kịch bản (counter đứng im, không lỗi) — **đã xác nhận chạy thật** trong e2e (StreamUnsupportedError → completeJson).
- [x] `setScriptGenerating` vẫn chặn 2 lần bấm trùng (409) — đặt đồng bộ trước khi mở stream, reset trong `finally`.
- [x] `pnpm test:unit` (gồm `verify-script`) xanh; `pnpm test:e2e-video` PASS (E2E_SCRIPT_VIDEO_ALL_PASS); `pnpm lint` xanh.

## Risk Assessment
- **Provider không hỗ trợ `stream:true` kèm param ngoài chuẩn** (`thinking`): nhánh fallback non-stream bắt buộc có → mất counter chứ không mất chức năng. Đây là rủi ro chính, xác nhận bằng 1 lượt chạy thật (bước 5).
- **`usage`/token count không có trong stream**: dùng độ dài `delta.content` (ký tự), không phụ thuộc `usage`.
- **Đổi parse path vô tình đổi kết quả**: giữ CHÍNH XÁC `parseScriptJSON` + `toScriptSegments` + `splitTallShotsInJob`; streaming chỉ đổi cách LẤY chuỗi, không đổi cách XỬ LÝ chuỗi. Test `verify-script` + so sánh thủ công.
- **NDJSON mock cho e2e**: `scripts/mock-script-model.mjs` có thể cần hỗ trợ stream; nếu mock chưa stream → route fallback non-stream trong e2e (chấp nhận, e2e vẫn xanh). Kiểm memory `e2e-video-parsescript` (SETTINGS_FILE=/dev/null).
- **Guard mở stream rồi mới lỗi**: giữ guard đồng bộ TRẢ JSON lỗi TRƯỚC khi mở stream (tránh client phải parse error trong NDJSON cho lỗi 404/409 tầm thường).
