---
phase: 1
title: "Capture CapCut Response"
status: done
priority: P1
effort: "1h"
dependencies: []
---

# Phase 1: Capture CapCut Response

## Overview
Chạy Python client gốc (K07VN/capcut-tts-api) 1 lần với credentials mặc định để capture response THẬT của API CapCut — điều kiện tiên quyết để viết parser TypeScript ở Phase 3 (README/source không ghi rõ audio trả về dạng URL hay base64).

## Requirements
- Functional: có mẫu JSON thật của `tts-new` và `tts-query` (đến khi task done), xác định chính xác JSON path chứa audio + định dạng audio.
- Non-functional: không commit credentials/response chứa token vào git ngoài thư mục reports (redact token trước khi lưu).

## Architecture
Chỉ dùng repo nguồn, chưa đụng codebase. Clone về scratchpad/thư mục tạm, không thêm vào project.

## Related Code Files
- Create: `plans/260717-1515-capcut-tts-provider-tts-provider-abstraction/reports/capcut-response-samples.md`

## Implementation Steps
1. Clone `https://github.com/K07VN/capcut-tts-api` vào thư mục tạm; `python3 -m pip install requests` (cần Python 3.9+).
2. Chạy `--dry-run` trước để capture bộ headers/signing chuẩn (đối chiếu khi port TS): `python3 capcut_common_task_client.py tts-new --text "Xin chào" --dry-run`.
3. Chạy thật: `tts-new --text "Xin chào, đây là bài kiểm tra giọng đọc."` với voice `BV074_streaming`, resource-id `7102355709945188865` → ghi lại `task id` + `token`.
4. Poll `tts-query --task-id ... --token ... --out response.json` đến khi status done; ghi nhận các giá trị status trung gian (queueing/processing/…) và thời gian chờ thực tế.
5. Xác định: audio nằm ở JSON path nào, là URL tải hay base64, format thật (mp3?). Nếu là URL — tải thử, xác nhận header cần thiết khi tải.
6. Thử thêm 1–2 voice khác (vd `BV075_streaming` nếu tồn tại) để mở rộng catalog giọng Việt; ghi lại voice hoạt động/không.
7. Viết `reports/capcut-response-samples.md`: request headers (từ dry-run), JSON new/query (redact token), audio path + format, status values, poll timing, danh sách voice verify được.

## Success Criteria
- [ ] File report chứa mẫu JSON new + query hoàn chỉnh (đã redact token)
- [ ] Kết luận rõ: audio lấy ở đâu, dạng gì, tải thế nào
- [ ] Ít nhất 1 voice tiếng Việt verify được, nghe thử file audio OK
- [ ] Ghi nhận status values + poll timing để chọn interval/timeout ở Phase 3

## Risk Assessment
- **API chết/đổi signing ngay từ bước này** → DỪNG toàn bộ plan, báo user — không đốt công port khi API không còn hoạt động.
- Credentials device mặc định trong repo bị khóa → thử `--device-json` với profile khác trước khi kết luận.
