# CapCut TTS Provider: Brainstorm + Plan chốt provider abstraction

**Date**: 2026-07-17 15:21
**Severity**: Medium
**Component**: TTS (`content-extractor/lib/tts.ts`)
**Status**: Ongoing — plan chốt, implementation chưa chạy, có gate cứng ở Phase 1

## Bối cảnh

`lib/tts.ts` hard-code ElevenLabs — trả phí theo ký tự, không có lựa chọn free. Muốn thêm CapCut TTS (giọng Việt, free) dựa trên [K07VN/capcut-tts-api](https://github.com/K07VN/capcut-tts-api), một Python CLI ~500 dòng reverse-engineer API nội bộ CapCut (không phải API chính thức, không có doc). Root cause của nợ kỹ thuật: hệ thống được viết cho đúng 1 provider ngay từ đầu, giờ thêm provider thứ 2 thì lộ ra là không có interface nào cả — mọi thứ (cache, retry, ffprobe) trộn thẳng vào code gọi ElevenLabs.

## Quyết định chốt

1. **Provider abstraction** (interface `TtsProvider` + registry) — orchestration chung (cache, retry, `probeDurationSec`) ở lại `lib/tts.ts`, mỗi provider chỉ lo text → Buffer mp3. Bị loại: mỗi provider tự cache riêng (lặp DRY), đổi baseUrl qua ENV như mock hiện tại (CapCut là flow async new→poll, khác hẳn sync của ElevenLabs).
2. **Port signing sang TypeScript thuần** (`node:crypto`) — không spawn Python subprocess, không thêm FastAPI microservice. Lý do: YAGNI, không muốn thêm runtime/service phải vận hành chỉ để ký request.
3. **Không auto-fallback** khi CapCut lỗi. Đây là quyết định có chủ đích, không phải thiếu sót: fallback âm thầm sang ElevenLabs nghĩa là user tưởng đang free nhưng bị trừ tiền không biết. Thà báo lỗi rõ + gợi ý đổi `TTS_PROVIDER=elevenlabs` bằng tay.
4. **Cache key ElevenLabs giữ nguyên** (`sha256(text\0voice\0model)`) để không vô hiệu hoá cache đã trả phí. Provider khác dùng key mới có prefix provider.
5. **Chọn provider per-project** qua dropdown UI, lưu `renderConfig.tts.provider` trong `.mtvproj`; rỗng = ENV `TTS_PROVIDER`. File `.mtvproj` cũ không cần migration.
6. Scope khoá cứng: chỉ TTS. STT/word-timestamp (karaoke subtitle) cố tình để ngoài phạm vi, chỉ đảm bảo kiến trúc không chặn đường sau này.

## Điểm chưa chắc — rủi ro nhìn thẳng

Format response audio của CapCut (URL tải hay base64, JSON path nào) **chưa xác nhận được** — repo nguồn không có doc, phải đọc code Python để đoán. Vì vậy Phase 1 của plan không phải "viết code", mà là chạy Python client gốc 1 lần để capture response thật trước khi viết parser TS. Nếu API đã chết (CapCut đổi signing) thì **dừng plan ngay ở Phase 1**, không port vô ích — đây là gate cứng ghi thẳng trong `plan.md`. Đây là kiểu rủi ro không thể loại bỏ bằng thiết kế tốt: API unofficial, nhà cung cấp có thể đổi bất cứ lúc nào không báo trước. ElevenLabs được giữ làm đường lùi chính vì lý do này — rủi ro bị cô lập gọn trong 1 file provider (`capcut.ts`) thay vì lan ra toàn hệ thống.

Catalog giọng Việt cũng chỉ có 1 giọng được xác nhận thật (`BV074_streaming`, resource_id `7102355709945188865`) — không có danh sách công khai, phải verify thực nghiệm từng giọng, mở rộng dần.

## Kết quả phiên

Plan 5 phase tại `plans/260717-1515-capcut-tts-provider-tts-provider-abstraction/`: (1) capture response CapCut thật, (2) refactor provider abstraction, (3) capcut provider, (4) schema + UI chọn provider, (5) mock/verify/docs. Tasks đã hydrate, sẵn sàng cook.

## Bài học

Đừng port code reverse-engineered dựa trên đọc source mù — capture response thật trước, viết parser sau. Đặt gate cứng ("API chết thì dừng") ngay trong plan thay vì để lộ ra giữa chừng lúc code đã viết một nửa, tránh phí công port cho một API sẽ throw ngay khi test.

## Next Steps

- Owner: dev cook plan — chạy Phase 1 (capture CapCut response bằng Python client gốc) trước, KHÔNG bắt đầu Phase 2/3 tới khi có response mẫu thật.
- Nếu Phase 1 xác nhận API sống: cook tuần tự Phase 2 → 5 theo dependency đã khai trong `plan.md`.
- Nếu Phase 1 phát hiện API chết: báo lại user ngay, đóng plan, không refactor abstraction cho một provider không dùng được.

---

**Status**: DONE_WITH_CONCERNS
**Summary**: Brainstorm + plan cho CapCut TTS provider đã chốt (abstraction, TS port, no auto-fallback, cache backward-compat); chưa implement gì, rủi ro lớn nhất (format response CapCut chưa xác nhận, API unofficial có thể đổi/die bất cứ lúc) dồn hết vào gate cứng ở Phase 1.
**Concerns/Blockers**: Phase 1 chưa chạy — plan có thể chết ngay từ bước đầu nếu CapCut đã đổi signing hoặc response format khác giả định trong brainstorm.
