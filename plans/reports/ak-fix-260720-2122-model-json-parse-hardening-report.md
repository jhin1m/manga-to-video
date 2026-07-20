# Fix: "Model trả về không đúng JSON" (kịch bản + storyboard)

Ngày 2026-07-20 · nhánh `main` · chưa commit

## Triệu chứng

Lỗi verbatim `Model trả về không đúng JSON` — ném từ `extractJson` (`lib/vision.ts`).
Nổ ở bước tạo kịch bản; storyboard thỉnh thoảng vài panel.

## Config đang chạy (quyết định phạm vi giả thuyết)

`.settings.json` → provider `openrouter`, vision + script đều `google/gemini-2.5-flash`,
`disableThinking: false`. Vì `isZaiProvider('openrouter') === false`, cờ này **không bao giờ
được áp** → Gemini luôn chạy reasoning, reasoning tokens ăn vào ngân sách output.

## Khiếm khuyết đã sửa (có file:line trước fix)

1. **`vision.ts:135-146` — latch `jsonModeSupported` toàn tiến trình.** Mọi 400 (ảnh quá khổ,
   content-filter, param lạ) đều tắt vĩnh viễn json-mode cho cả process → mọi panel sau đó
   mất json-mode. Khớp "thỉnh thoảng vài panel".
   → Vẫn thử lại không-json-mode cho mọi 400 (giữ đường lùi), nhưng **chỉ tắt vĩnh viễn** khi
   thông báo 400 thật sự nói về json-mode.
2. **`script.ts:252` / `vision.ts:233` — parse nằm NGOÀI `withRetry`.** Output hỏng ngẫu nhiên
   = fail cứng một phát, trong khi 429 được thử 4 lần.
   → `completeJson()` gộp gọi + parse trong cùng vòng retry; lần sau kèm lời nhắc sửa format.
3. **`vision.ts:162-163` — `indexOf('{')` + `lastIndexOf('}')`.** Cắt sai khi có chữ thừa sau
   JSON và khi output bị cắt giữa chừng.
   → Bộ quét cân bằng ngoặc (bỏ qua ngoặc trong chuỗi + escape), gỡ khối `<think>` và fence
   chưa đóng trước khi dò.
4. **Không chỗ nào đọc `finish_reason`** → không phân biệt được cắt-do-token với model trả prose.
   → Log `finish=` mỗi lần gọi; `finish_reason=length` cho lỗi riêng, non-retryable, kèm cách chữa.
   Thêm `MODEL_MAX_TOKENS` (để trống = giữ mặc định endpoint).

## Nghiệm thu

- `tsc --noEmit`, `eslint`, `npm run build`, `npm run test:unit` — exit 0.
- Test hồi quy mới (`verify-script.mts` Test 2b/2c, mock 5 kiểu output hỏng): `<think>`/lời dẫn
  parse thẳng không tốn lượt gọi; JSON vỡ/sai shape retry rồi qua (đúng 1 lần gọi lại);
  truncation dừng ngay 1 lượt + báo `MODEL_MAX_TOKENS`.
- Route `/storyboard/script` catch-all → trả `err.message` 502, thông báo mới hiện thẳng trên UI
  (không 500 trần).

## KHÔNG được coi là bằng chứng

- `test:e2e-video` PASS toàn bộ — nhưng **cây sạch (stash) cũng PASS**. E2E không tái hiện được
  triệu chứng, nên nó không chứng minh gì cho fix này. (Phụ phẩm: ghi chú "known-issue 502" cũ
  đã lỗi thời, đã cập nhật.)
- **Chưa xác nhận nguyên nhân gốc trên API thật.** Toàn bộ nghiệm thu là mock do tôi tự soạn.

## Việc còn lại của user

1. Chạy 1 chương thật, đọc log `[script …] finish=`.
   - `finish=length` → truncation là nguyên nhân; đặt `MODEL_MAX_TOKENS` (cao) trong `.env.local`.
   - `finish=stop` → nguyên nhân là output bẩn; retry mới đã tự xử lý, xem log có `parse lỗi lần 1` không.
2. Quyết định về reasoning: `MODEL_MAX_TOKENS` chữa được nhưng vẫn để reasoning đốt token mỗi
   lượt. Muốn tắt hẳn thì phải thêm param `reasoning` của OpenRouter — công tắc "disableThinking"
   ở Settings hiện **là no-op với OpenRouter**. Đây là follow-up riêng, chưa làm.

## Đánh đổi đã chấp nhận

- Retry-on-parse nhân chi phí tối đa 4× mỗi panel trong kịch bản output hỏng hệ thống
  (vision concurrency 4). Truncation không retry nên không dính.

## Câu hỏi treo

- Có muốn làm follow-up cho `reasoning` OpenRouter, hay `MODEL_MAX_TOKENS` là đủ?
- Công tắc `disableThinking` nên áp cho mọi provider hay nên ẩn đi khi provider không hỗ trợ?
