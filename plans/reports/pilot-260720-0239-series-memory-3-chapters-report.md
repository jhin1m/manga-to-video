# Report nghiệm thu Phase 3: Pilot series-memory 3 chương liên tiếp

Plan: `plans/260719-2235-series-memory-bible-recap/` · Ngày: 2026-07-20
Corpus: `~/Downloads/Standard of Reincarnation/` (manhwa, 3 chương, 63 ảnh nguồn → 264 slice)

## Kết quả success criteria (plan.md)

| # | Criterion | Kết quả |
|---|---|---|
| 1 | Xưng hô + tên nhất quán 100% giữa 3 chương | **PASS** — đối chiếu tay 3 script: Daven="hắn", Kajin="y", Julian="gã", Daven↔Kajin/Julian "ta–ngươi"; tên Daven/Kajin/Vinchen/Julian/Arslan/Keshak/Raila/Samion/Adenca nhất quán, đúng bible. Chưa có check tự động (ghi hạn chế). |
| 2 | Narration chương 2+ nối mạch recap chương trước | **PASS** (đánh giá orchestrator) — ch2 mở: "Luồng sáng trắng trong ngục tối đã đưa Daven đến..."; ch3 mở tiếp câu hỏi treo "Ác Quỷ Tối Cao" cuối ch2. User nên xem video xác nhận cảm quan. |
| 3 | Regression chương đơn không `.mtv/` | **PASS** — ingest cùng input ngoài series: output identical (76 slice, 64 trimmed), KHÔNG sinh file series nào. |
| 4 | Bible ≤ cap, không diễn biến; re-run không xoá entry | **PASS** — bible 731/2000 từ sau 3 chương; diff-update 2 lần chỉ thêm/sửa entry liên quan; diễn biến nằm ở summaries. |
| 5 | Stale warning | **PASS** — demo: re-run ch1 → series.json chỉ ra recap ch1 đã bị ch2+ch3 tiêu thụ → orchestrator cảnh báo trước khi ghi đè. |
| 6 | TS app round-trip (nạp bible+summaries, xuất recap) | **PENDING** — cần dev server + browser; chưa chạy trong pilot này. Criteria 1-2 của phase-02 vẫn treo theo. |

**5/6 PASS, 1 pending.** Validator còn bắt đúng 2 lần `summary-over-cap` (recap ch2 269 từ, ch3 292 từ) → gọt xuống ≤250 → sạch. Cơ chế cap hoạt động thật.

## Sản phẩm

| Chương | Slice | Segment | Audio | Video (16:9) |
|---|---|---|---|---|
| Chapter 1 | 116 | 36 | 321s | **339s**, 40MB + SRT |
| Chapter 2 | 76 | 26 | 235s | **248s** + SRT |
| Chapter 3 | 72 | 24 | 244s* | **244s** + SRT |

Đường dẫn: `<series>/.mtv/workdirs/<chương>/out/video.mp4`. State series: `series.json` 3 entry done + `bible.md` + 3 recap — validate `--series` pass sạch.

## Luồng đã chạy thật (mỗi chương)

ingest → vision (z.ai glm-4.5v, context tiêm từ chương 2) → validate content → orchestrator viết script (đọc bible + recap 2 chương gần nhất) → validate script → TTS CapCut → render → bước 9: recap + diff-update bible + series.json + validate --series.

## Deviations so với plan

1. **Vision đổi từ subagent sonnet → z.ai glm-4.5v** (chỉ đạo user giữa pilot — sonnet phí phạm). 24 slice đầu ch1 do agent đọc, 240 slice còn lại qua script `zai_vision.py` (scratchpad; prompt port từ vision.ts). 264/264 pass schema. Follow-up đề xuất: đưa `vision.py --provider zai` vào skill.
2. Bước 9 (recap/bible) chạy TRƯỚC render để mở khóa vision chương sau sớm — nội dung chỉ phụ thuộc script+content nên không ảnh hưởng tính đúng; entry series.json vẫn ghi sau khi video xong.
3. Chapter slug dùng nguyên tên folder dài (có space) — hoạt động tốt, natural-sort đúng thứ tự 1<2<3.

## Quality caveats (không chặn nghiệm thu)

- glm-4.5v thỉnh thoảng trả dialogue tiếng Anh chưa dịch / lẫn lỗi chính tả trong content JSON (vd "GIẾT ĐẦU", "MÁU MÔN") — script narration do orchestrator viết lại nên video không lộ lỗi, nhưng content thô kém hơn bản sonnet đọc. Cân nhắc thêm câu "BẮT BUỘC dịch hết sang tiếng Việt" đậm hơn trong prompt vision.py tương lai.
- Ch1 dài (116 slice từ 26 ảnh — ảnh nguồn rất cao): ingest split-height default hoạt động đúng nhưng người dùng nên biết webtoon full-height sinh nhiều slice.

## Unresolved questions

1. TS app round-trip (criterion 6 + phase-02 criteria 1-2): chạy khi nào? Cần `pnpm dev` + browser ~10 phút.
2. Criterion 2 (nối mạch) mới có đánh giá orchestrator — user xem 3 video để chốt cảm quan cuối.
3. Có nhét `zai_vision.py` vào skill thành `vision.py` chính thức không (kèm secrets manager sẵn có)? Đề xuất: có, plan nhỏ riêng.
