---
title: "Phase 7: Pilot A-Z + nghiệm thu"
status: done
phase: 7
priority: P1
effort: "4h"
dependencies: [6]
---

# Phase 7: Pilot A-Z + nghiệm thu

## Overview

Chạy skill trọn vẹn trên 1 chương thật, đối chiếu với output z.ai hiện có, chốt cả 3 gate nghiệm thu. Chỉ khi phase này xong mới coi port là hoàn thành.

## Input & mốc so sánh

- Chương pilot: corpus `~/Downloads/Vừa Gả Đã Làm Mẹ Kế Của Ba Nhóc Con Chap 1.1...` (38 slice — trùng corpus parity để so trực tiếp).
- Mốc tham chiếu: `content-extractor/output-16x9.mp4` + `output-16x9.srt` + `output-16x9.timeline.json` (pipeline z.ai + TS render).

## Implementation Steps

1. Session sạch (mô phỏng người dùng thật): invoke skill với input folder corpus, workdir mới → chạy A-Z đủ 8 bước SKILL.md, KHÔNG can thiệp tay ngoài quy trình skill.
2. Giữa chừng kill 1 lần có chủ đích (sau vision, trước tts) rồi resume → verify manifest resume đúng, không mất công đoạn đã làm.
3. Đối chiếu kết quả:
   - **Kịch bản**: so `script.json` với `output-16x9.srt` (z.ai) — checklist: đúng ngôi ba toàn bộ, xưng hô thoại giữ trong ngoặc kép, phủ đủ slice không sót/lặp, mạch truyện liền (đọc song song 2 bản, ghi nhận xét vào report).
   - **Video**: xem `out/video.mp4` — sync audio/hình, SRT khớp, không shake, không band đen bất thường, duration hợp lý so với baseline.
   - **Parity gates**: xác nhận lại gate #1 (Phase 3) + gate #2 (Phase 5) còn PASS trên artifact pilot; gate #3 = pilot này.
4. Ghi report nghiệm thu: `plans/reports/pilot-260719-manga-to-video-python-skill-report.md` — bảng 3 gate PASS/FAIL kèm số đo, khác biệt kịch bản đáng kể (nếu có), đường dẫn artifacts.
5. Drift/bug tìm thấy → fix trong skill (KHÔNG sửa content-extractor), cập nhật comment nguồn port nếu lệch có chủ đích.
6. Sau khi cả 3 gate PASS: cập nhật memory dự án (skill sẵn sàng, đường dẫn, quirks phát hiện) + `/ak:journal`.

## Success Criteria

- [ ] **Gate #1 banding**: PASS (từ Phase 3, xác nhận lại).
- [ ] **Gate #2 shake**: PASS (từ Phase 5, đo trên video pilot).
- [ ] **Gate #3 pilot A-Z**: video + SRT ra đủ, kịch bản đạt checklist ngôi kể/xưng hô/phủ index; resume test pass.
- [ ] Report nghiệm thu có số liệu cụ thể (số band, p95 displacement, duration, số segment).

## Risk Assessment

- Chất lượng kịch bản phụ thuộc model session lúc pilot → pilot bằng model mạnh (Opus+/Fable) đúng model policy; nếu kịch bản kém, phân biệt lỗi prompt (sửa style-guide) vs lỗi model (ghi khuyến nghị SKILL.md).
- So sánh với z.ai là so hai hệ khác nhau — mốc "không tệ hơn về mạch truyện + đúng quy tắc giọng kể", không yêu cầu giống từng câu.
