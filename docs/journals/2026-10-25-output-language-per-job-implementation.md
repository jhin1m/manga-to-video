# 2026-10-25 — Ngôn ngữ đầu ra theo job (vi/en/id): xong, nghiệm thu thật suýt bị đánh dấu BLOCKED oan

**Commit:** `da8a5c8` (feat), merge `8921e6d` | **Plan:** `plans/261025-1147-output-language-per-job-vi-en-id/` | **Báo cáo:** `reports/from-tester-261025-real-vision-acceptance-report.md`, `reports/from-code-reviewer-261025-output-language-review-report.md`

## Bối cảnh

Prompt vision, biên kịch, recap và catalog giọng CapCut đều gắn cứng tiếng Việt. Thêm `outputLanguage` theo job (vi mặc định, en, id), lưu vào Job, `.mtvproj`, bundle, và đồng bộ sang skill Python kèm lưới parity. Phần code và test đơn vị xanh khá sớm. Phần đau là nghiệm thu bằng model thật.

## Điều đã xảy ra khi nghiệm thu

Key z.ai trả 401, cả key của app lẫn key của skill. Vision thật bị chặn ngay. User dán key Claude vào, Anthropic cũng từ chối. Đến đây có xu hướng ghi AC2/AC3 là BLOCKED và dừng. Việc đó sai: `.settings.json` của app đang cấu hình provider **OpenRouter** và nó vẫn chạy bình thường. Nghiệm thu lại qua `google/gemini-2.5-flash`, mất thêm khoảng nửa giờ, và mọi thứ ra kết quả.

Kết quả (không ghi giá trị key ở bất kỳ đâu):
- App, job `id` và job `en`: vision 14/14 beat, 0 lỗi, mỗi job ~30s. Job `id` có 0 từ tiếng Anh trong 578 từ narration, 0 dấu Việt.
- Skill vision qua env override (`OPENAI_BASE_URL` + `VISION_MODEL`): `id` 3/3, `en` 3/3, `validate --stage content` pass.
- Recap giữ đúng một marker `Kết chương:` ở cả hai ngôn ngữ (hợp đồng `references/series.md`).
- TTS CapCut: id dùng Shinta (`id_female_noor`), en dùng `BV029_streaming`. Duration khớp ffprobe.
- Render `en`: h264 1080x1920 + aac, 129.4s, SRT 15 cue tiếng Anh.

## Quyết định

- **TTS mặc định ElevenLabs, thiếu key thì giữ nguyên.** Không có `ELEVENLABS_API_KEY` thì job en/id báo "Thiếu ELEVENLABS_API_KEY" cho mọi segment, phải chọn `provider=capcut`. Đây là cấu hình ENV, không phải lỗi của tính năng. Phương án tự chuyển sang CapCut theo ngôn ngữ bị loại vì sẽ lén đổi provider người dùng đã chọn.
- Giữ nguyên cache key TTS: text khác ngôn ngữ thì key khác tự nhiên, cache ElevenLabs đã trả phí không mất.

## Giới hạn còn lại (đừng tuyên bố quá tay)

- **Không có ASR.** Chưa ai xác nhận giọng nói thật sự là tiếng Anh hay Indonesia. Bằng chứng chỉ là voice id theo cấu hình, duration, và có tín hiệu audio (mean -22.6 dB). Cache TTS cũng không ghi voice id nên không đọc ngược được.
- Chưa kiểm chứng OpenRouter có thật sự tắt reasoning khi nhận `thinking:{type:disabled}`.
- 3 mục trung bình của review (M1 nhãn giọng UI lệch giọng server synth, M2 fallback subagent làm rơi ngôn ngữ, M3 parity chưa phủ logic chọn giọng) đã sửa trước commit `da8a5c8`: nhãn "synth sẽ dùng …", `vision.py` ghi `output_language` trước khi kiểm key, golden `i18n_pick_voice` trong `gen-parity.mts`.
- Môi trường: `~/.claude/skills/.venv` trỏ tới python 3.14 đã gỡ nên smoke validate Python không chạy bằng venv này.

## Bài học

1. **Trước khi tuyên bố BLOCKED, liệt kê hết provider đã cấu hình** (`.settings.json`, env, `.secrets.json`) rồi thử từng cái. Một provider chết không có nghĩa là không còn đường nào.
2. Nghiệm thu "đã chạy" khác "đã đúng". Không có ASR thì ghi thẳng là chưa xác minh, đừng để AC7 xanh trần.
3. Hai nơi cùng hiển thị một quyết định (UI và server chọn giọng) sẽ lệch nhau nếu không dùng chung một nguồn sự thật.

## Việc tiếp theo

- Quyết định có thêm ASR hoặc nghe tay một mẫu en và id (chủ: user).
- Thay key z.ai (app + skill) hoặc chuyển hẳn vision mặc định sang OpenRouter (chủ: user).
