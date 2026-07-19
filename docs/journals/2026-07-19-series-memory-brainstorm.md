# Series-memory (bible + recap) xuyên chương: brainstorm chốt thiết kế

**Date**: 2026-07-19 21:00
**Severity**: Low
**Component**: Pipeline (TS `content-extractor/` + Python skill `~/.claude/skills/manga-to-video/`)
**Status**: Resolved (brainstorm) — implementation chưa chạy, không viết code trong session này

## What Happened

User đề xuất: pipeline nên nhận thẳng 1 thư mục manga chứa nhiều thư mục chapter, chạy xong chương N thì tự tóm tắt diễn biến cho chương N+1 dùng, kèm memory tổng quan bộ truyện (nhân vật, bối cảnh). Hiện tại mỗi chương xử lý độc lập — chạy chương 2 không biết gì về chương 1, dễ trôi xưng hô, gọi sai tên nhân vật.

Scout phát hiện điểm chặn: TS app ingest ảnh qua browser upload (formData), **không có folder path trên đĩa** → không thể tự phát hiện series ở tầng TS. Python skill (đang port dở, plan 260719-2024, phase 2/7) thì có workdir per-chapter thật trên filesystem, và orchestrator là Claude agent nên thêm 1 stage tóm tắt gần như miễn phí (không tốn thêm API call model riêng).

## Quyết định (interview 2 vòng, đã chốt)

1. **Python skill là engine chính, full-auto**; TS app chỉ tích hợp Mức 1 (nút nạp/xuất file qua file picker) — vì TS không biết path nên không thể tự động theo dõi series server-side.
2. **Tách bible (facts bền, cap ~2000 từ) khỏi recap per-chapter (diễn biến, cap ~250 từ)** — để bible không phình tuyến tính theo số chương.
3. Sinh tóm tắt **từ `script.json` + `content/*.json`** đã có sẵn sau khi chương xong, không đọc lại ảnh bằng vision — giữ chi phí gần 0.
4. Context cho chương sau = bible + recap 2 chương gần nhất (~500 từ), không nạp toàn bộ lịch sử.
5. Contract trên đĩa dùng chung 2 engine: `MangaX/.mtv/{series.json, bible.md, summaries/chapter-N.md, workdirs/}`.
6. **Loại bỏ Mức 2 (series server-side trong TS app)** — đắt (đổi jobs store, `.mtvproj`, ingest path-based) trong khi port Python đang dở, rõ ràng YAGNI.
7. Implementation là **plan riêng, chạy sau khi port pilot xong** (phase 7 của 260719-2024). Chỉ chạm nhẹ vào Phase 6 của plan port hiện tại: đặt workdir tại `<series>/.mtv/workdirs/<chapter>/` khi chạy trong series folder, để chừa chỗ chứ không mở rộng scope.

## Root Cause / Lý do thiết kế

Vấn đề gốc không phải "làm sao tóm tắt" mà là **hai engine có mức truy cập filesystem khác nhau**: TS app chưa từng cần biết path vì thiết kế ban đầu là upload-based, còn Python skill vốn thao tác trực tiếp trên thư mục. Ép TS app tự phát hiện series sẽ đòi đổi kiến trúc ingest — không đáng làm khi Python skill đã có sẵn context tự nhiên hơn cho việc này.

## Lessons Learned

- Khi 2 engine cùng xử lý 1 domain nhưng khác model I/O (upload vs filesystem), đừng cố ép engine yếu hơn (TS) làm việc nặng — giao việc cho engine có context tự nhiên (Python + filesystem), engine kia chỉ cần tương thích ở mức tối thiểu (file picker).
- Tách "facts bền" khỏi "diễn biến" ngay từ thiết kế contract tránh được lớp bug kinh điển của mọi hệ context tích luỹ: memory phình vô hạn theo thời gian chạy.
- Đừng để plan mới chặn port pilot đang chạy dở — chỉ sửa 1 dòng nhỏ (workdir path) ở Phase 6 thay vì trì hoãn cả port để gộp scope.

## Next Steps

1. (Ngay, nhỏ) Sửa Phase 6 của plan `260719-2024`: SKILL.md đặt workdir tại `<series>/.mtv/workdirs/<chapter>/` khi chạy trong series folder.
2. Hoàn thành port pilot (phase 7 của 260719-2024).
3. Sau đó tạo plan riêng `series-memory` từ report `plans/reports/brainstorm-260719-2051-series-memory-bible-recap-report.md` (blockedBy: 260719-2024) — Python skill contract + prompts trước, TS app Mức 1 sau.
4. Unresolved: schema chi tiết `series.json`, và cách recap chương chia nhỏ (1.1/1.2 — đề xuất per-folder) — để phase plan quyết.
