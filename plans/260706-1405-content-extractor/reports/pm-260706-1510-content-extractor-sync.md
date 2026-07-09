# PM Report — Content Extractor (Stage 1) — 2026-07-06 15:10

## Trạng thái

| Mục | Giá trị |
|-----|---------|
| Plan | `plans/260706-1405-content-extractor/` |
| Status | **completed** (2 live-gates chờ API key) |
| Phases | 5/5 completed |
| Checkboxes | 26/28 checked (2 deferred: real-model content + Z.AI thật) |
| Code review | DONE_WITH_CONCERNS → 3 Medium đã fix, 0 Critical/High |
| Gates | tsc ✓ lint ✓ build ✓ dev ✓ E2E-mock ✓ |

## Deliverables

- App: `content-extractor/` — Next 16.2.10, 7 API routes, 1 trang UI tiếng Việt, 4 lib modules.
- Contract downstream: manifest v1 `{version,jobId,createdAt,itemCount,items[{index,filename,content,error?}]}`.
- Docs: `content-extractor/README.md` (setup, ENV switch, API, manifest, kiến trúc) + `.env.example`.
- Review: `reports/code-review-content-extractor.md`.

## Việc còn lại (onboarding — cần người dùng)

1. Điền `OPENAI_API_KEY` thật vào `content-extractor/.env.local` → chạy 1 chapter thật → xác nhận nội dung tiếng Việt.
2. Switch `.env.local` sang Z.AI GLM (`OPENAI_BASE_URL` + `VISION_MODEL`) → chạy lại → tick nốt criterion 3.
3. Test tắt mạng giữa job + lượt bấm UI trên trình duyệt.
4. Commit đầu tiên (chưa commit — chờ người dùng yêu cầu; `.env.local` đã được gitignore, `.env.example` đã được un-ignore).

## Ghi chú kỹ thuật

- Node 24 qua Herd nvm (`~/Library/Application Support/Herd/config/nvm`); shell mới mặc định Node 22 → `nvm use 24` trước khi build.
- Không tạo `./docs/` — repo mới chỉ có 1 app con, README + plan là đủ (YAGNI); docs-manager sẽ hữu ích từ stage 2 trở đi khi có nhiều app.
- Task list phiên: #1–#6 completed (finalize #6 đóng sau journal).

## Câu hỏi mở

- Stage 2 (TTS) đọc manifest từ đâu — file người dùng tự đặt hay thư mục quy ước (`exports/`)? Quyết định khi plan stage 2.
