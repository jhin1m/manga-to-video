# Brainstorm: Series-memory (bible + recap) xuyên chương cho pipeline manga-to-video

Date: 2026-07-19 · Session: brainstorm · Status: APPROVED (mọi quyết định đã chốt qua interview)

## Problem statement

Pipeline hiện tại xử lý từng chương độc lập. Chạy chương 2 không biết gì về chương 1 → trôi xưng hô, gọi sai tên nhân vật, hụt mạch truyện. Context hiện có (textarea "Nhân vật & bối cảnh chương", plan 260718-1746, done) do người dùng nhập tay từng chương — không tự sinh, không tự nối.

Yêu cầu: cấu trúc 1 thư mục manga chứa các thư mục chapter; chạy chương N xong tự tóm tắt diễn biến + duy trì tổng quan bộ truyện (nhân vật, bối cảnh) để chương N+1 dùng.

## Bối cảnh codebase (scout)

- **TS app** `content-extractor/`: ingest qua browser upload (formData) → **không biết folder path trên đĩa**, không thể tự phát hiện series. Đã có cơ chế tiêm context: `buildVisionPrompt(context)` (vision.ts), `buildPrompt(inputs, context)` (script.ts), guardrail chống bleed, persist `.mtvproj`.
- **Python skill** `~/.claude/skills/manga-to-video/`: port đang chạy (plan 260719-2024, phase 2/7). Workdir contract per-chapter: manifest.json, slices/, content/NNN.json, script.json, audio/, out/. Orchestrator = Claude agent → stage tóm tắt gần như miễn phí.
- Chưa có khái niệm "series" ở cả hai engine.

## Quyết định đã chốt (interview 2 vòng)

| # | Câu hỏi | Quyết định |
|---|---|---|
| 1 | Engine | Cả hai — Python skill full-auto là chủ; TS app tích hợp **Mức 1** (nút nạp/xuất file, KHÔNG series server-side) |
| 2 | Memory gồm gì | **Bible tích lũy + recap per-chapter** (tách vai trò: bible = facts bền, recap = diễn biến) |
| 3 | Nguồn sinh | Từ `script.json` + `content/*.json` sau khi chương xong — không tốn vision call |
| 4 | Cách chạy | Từng chương, skill tự phát hiện series folder + tự nối (không batch v1) |
| 5 | Trình tự | **Plan riêng chạy SAU port pilot (phase 7)**; chỉ sửa nhẹ Phase 6 plan port để chừa chỗ workdir |
| 6 | Độ sâu recap | Bible + recap **2 chương gần nhất** (~500 từ context) |

## Thiết kế

### Contract series trên đĩa (dùng chung 2 engine)

```
MangaX/
  chapter-01/  *.jpg|pdf          # nguồn, user tự bỏ
  chapter-02/  ...
  .mtv/
    series.json                   # index: chương đã xong, timestamp, settings hash
    bible.md                      # nhân vật + xưng hô + quan hệ + bối cảnh; cap ~2000 từ
    summaries/chapter-01.md       # recap diễn biến; cap ~250 từ/chương
    workdirs/chapter-01/          # workdir per-chapter của Python skill
```

Quy tắc: bible CHỈ chứa facts bền (tên, xưng hô, quan hệ, thiết lập thế giới); diễn biến nằm ở summaries → bible không phình theo số chương.

### Luồng chạy chương N (Python skill)

1. Nhận path `MangaX/chapter-N/` → phát hiện `.mtv/` ở thư mục cha (không có → khởi tạo, coi như chương đầu).
2. Đọc `bible.md` + recap N-1, N-2 → ghép khối context → tiêm vào prompt vision batch + prompt biên kịch (mô phỏng cơ chế context TS đã có, kèm guardrail wording từ plan 260718).
3. Script.json validate pass → orchestrator đọc `script.json` + `content/*.json` → viết `summaries/chapter-N.md` + **diff-update** `bible.md` (chỉ thêm nhân vật mới / quan hệ thay đổi, không rewrite toàn bộ) → cập nhật `series.json`.
4. Bible/summaries = markdown thường, user sửa tay được bất cứ lúc nào.

### TS app — Mức 1

- Nút **"Nạp series context"**: file picker chọn `bible.md` + summary file(s) → app ghép thành chuỗi đổ vào field context sẵn có (không cần biết path).
- Nút **"Xuất recap chương"**: sau khi có script, gọi model text sinh recap đúng format `summaries/chapter-N.md` cho user tải về đặt vào `.mtv/summaries/`.
- Effort ~1 buổi. Không đụng jobs store, không đổi `.mtvproj` version.

## Phương án đã loại

- **TS app series server-side (Mức 2)**: đắt (jobs.ts + .mtvproj + UI + đổi ingest path-based) trong khi port đang dở — YAGNI.
- **Chỉ rolling recap không bible**: xưng hô trôi dần qua nhiều chương.
- **Summarize bằng vision đọc lại ảnh**: tốn token, script.json + content đã đủ.
- **Toàn bộ recap từ đầu vào context**: prompt phình tuyến tính, vision call mỗi slice đều gánh.
- **Batch cả series một lệnh**: v1 bỏ; nếu cần sau này chỉ là loop của mode từng chương.

## Rủi ro & cách đỡ

- **Sai lệch lan chuỗi** (recap chương 2 sai → 3+ lệch theo): summaries per-file sửa tay được; `series.json` ghi timestamp → cảnh báo khi re-run chương cũ mà chương sau đã dùng recap stale.
- **Bible phình/trôi**: cap độ dài + quy tắc facts-bền trong prompt; re-run 1 chương không được xóa entry của chương khác.
- **Context bleed vào narration**: tái dùng guardrail wording đã ship (chỉ dùng gọi tên/xưng hô, cấm tả thứ không có trong ảnh).
- **Chương chia nhỏ kiểu 1.1/1.2** (corpus thật ở ~/Downloads): sort tên thư mục phải natural-sort, ghi rõ trong contract.

## Success metrics

- Chạy 3 chương liên tiếp corpus thật: xưng hô + tên nhân vật nhất quán 100% giữa các chương (đối chiếu tay).
- Chương 2+ narration mở đầu nối mạch được với recap chương trước (đánh giá cảm quan).
- Không regression: chạy chương đơn lẻ không có `.mtv/` → hành vi y cũ.
- Bible sau 3 chương ≤ cap, không chứa diễn biến.

## Next steps

1. (Nhỏ, làm ngay được) Sửa Phase 6 plan port 260719-2024: SKILL.md đặt workdir tại `<series>/.mtv/workdirs/<chapter>/` khi chạy trong series folder — chừa chỗ, không thêm scope khác.
2. Hoàn thành port pilot (phase 7).
3. Tạo plan riêng `series-memory` từ report này (blockedBy: 260719-2024): Python skill contract + prompts trước, TS app Mức 1 sau.

## Unresolved questions

- Format chi tiết `series.json` (schema fields) — để phase plan quyết.
- Recap cho chương chia nhỏ (1.1, 1.2): mỗi file folder = 1 recap riêng hay gộp theo chương logic — đề xuất: per-folder (KISS), plan quyết.
