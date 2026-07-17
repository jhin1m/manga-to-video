# Research: heuristic auto-trim ink bounding-box cho webtoon strip

Bối cảnh: `content-extractor/lib/smart-split.ts` đã có `detectBands` (gutter-based band split, full-width). Cần thêm bước co bbox theo nội dung (bỏ lề trắng 4 phía) cho từng band, phục vụ khung hình video. **Không tìm được nguồn nào giải quyết đúng bài toán "ink-bbox trim cho webtoon/manhwa"** — không có công cụ production nào công khai thuật toán này cho domain truyện tranh màu. Mọi khuyến nghị dưới đây là suy luận bắc cầu từ 3 domain lân cận (document/OCR trim, ImageMagick `-trim`, comic-panel-detection OSS), không phải số đo trực tiếp trên webtoon. **Độ tin cậy tổng thể: THẤP-TRUNG BÌNH — khuyến nghị bắt buộc phải calibrate bằng mắt trên corpus thật trước khi chốt giá trị.**

## Tóm tắt tham số đề xuất

| Tham số | Giá trị khởi điểm | Lý do ngắn |
|---|---|---|
| Ngưỡng tỉ lệ ink/hàng-cột để tính "có nội dung" | **1%** (0.01), dò 0.5–3% | Không có số chuẩn cho comic art trong literature; 1% đủ bắt nét mảnh nếu kết hợp run-length lọc nhiễu. Confidence THẤP. |
| Run-length tối thiểu cho "hàng trắng" (chống nhiễu JPEG single-pixel) | Vài hàng liên tiếp dưới ngưỡng (tái dùng cơ chế run như `computeSafeRuns`), KHÔNG xét từng hàng độc lập | IM usage-guide: xét từng hàng độc lập bị 1 pixel nhiễu phá vỡ ngay. Confidence TRUNG BÌNH-CAO. |
| Ngưỡng ink pixel (grayscale, cho ảnh B&W raw) | Giữ `<250` CHỈ khi nền là giấy trắng thật (manga scan B&W) | Đây là use-case gốc mà 250 được thiết kế cho (kế thừa SmartStitch). Confidence TRUNG BÌNH. |
| Ngưỡng ink cho color webtoon (nền gradient/màu) | Không dùng "khoảng cách tới trắng cố định". Dùng khoảng-cách-tới-màu-nền-tham-chiếu (sample từ mép band) + fuzz ~2–5%, tương tự `-fuzz`/`trim:percent-background` của ImageMagick | `<250` tuyệt đối vô dụng khi nền là bầu trời gradient màu (không hề gần trắng) → bbox = full band. Confidence TRUNG BÌNH-CAO (hướng đúng), THẤP (số fuzz cụ thể). |
| Otsu / ngưỡng thích nghi toàn cục | KHÔNG dùng làm cơ chế chính | Otsu thất bại có hệ thống trên ảnh non-bimodal/gradient/tương phản thấp — đúng đặc điểm webtoon màu. Confidence CAO (nhiều nguồn học thuật đồng thuận). |
| Padding sau bbox | 3–5% mỗi cạnh theo kích thước bbox, hoặc floor 12–16px (lấy max) | Không có chuẩn ngành cho comic; tham chiếu tinh thần pdfCropMargins (giữ % biên thay vì crop tuyệt đối tới bbox) nhưng nới hơn vì mục đích khung hình video cần "thở". Confidence THẤP — đây là lựa chọn thẩm mỹ. |
| Ngưỡng diện tích tối thiểu để ĐÁNG áp trim | Chỉ trim nếu bbox ≤ 80–85% diện tích band gốc (tiết kiệm ≥15–20%) | Không có chuẩn ngành. Chọn ngưỡng thận trọng: trim nhỏ hơn mức này không đáng giá trong khung hình Ken Burns, thà không trim. Confidence THẤP. |
| ignorableBorder cho watermark biên (tính năng trim) | Cân nhắc > 5px hiện tại, tách hằng số RIÊNG khỏi `ignorableBorder` của gutter-detection | Watermark webtoon thực tế thường 10–30px, dùng chung constant với band-split có thể lệch mục đích. Confidence TRUNG BÌNH. |
| Phát hiện viền đen scan (loại khỏi ink test) | Run đồng nhất tuyệt đối (variance ~0), MỎNG (≤ vài px) sát mép → loại trừ trước khi tính projection | Suy luận riêng, không có nguồn trực tiếp — phân biệt viền artifact (mỏng, đồng nhất) với panel nền đen thật (dày, có nhiễu/variance). Confidence THẤP-TRUNG BÌNH. |

---

## Q1 — Ngưỡng tỉ lệ pixel mực cho "hàng/cột có nội dung"

**Không tìm được số chuẩn cho comic/manga.** Các nguồn lân cận:

- ImageMagick `trim:percent-background=X%`: mặc định KHÔNG set (tương đương 0% — bất kỳ 1 pixel khác biệt nào cũng chặn trim tại hàng đó). Đây chính là kiểu "gặp pixel mực đầu tiên" mà user đã chủ động loại bỏ trong thiết kế — xác nhận hướng thiết kế "ngưỡng tỉ lệ" là đúng, không phải chi tiết số. Nguồn: https://usage.imagemagick.org/crop/ (Anthony Thyssen, tài liệu tham chiếu IM kinh điển, dùng >20 năm).
- Text-line-segmentation (OCR/document): có paper dùng "10% giá trị projection cực đại" làm ngưỡng phân biệt dòng chữ/nhiễu (nguồn: khảo sát academic qua search, chưa đọc full-text — độ tin cậy vừa phải).
- Nội bộ repo: `minInkDensity = 0.02` (2%) — nhưng đây là ngưỡng ở cấp **band** (hàng trăm hàng gộp lại) để coi band là "gần trắng toàn phần", KHÔNG tương đương ngưỡng per-row/col. Không nên copy thẳng.

**Khuyến nghị**: bắt đầu ở **1%** ink pixel/hàng (hoặc cột), kèm bắt buộc run-length filter (xem Q5) để không bị nhiễu JPEG kích hoạt sai. Đây là điểm khởi đầu để dò thực nghiệm (sweep 0.5–3%), không phải số đã kiểm chứng.

## Q2 — Ngưỡng ink `<250` có hợp lý cho webtoon?

**Không, có 2 vấn đề riêng biệt:**

1. **Quá lỏng cho B&W scan**: so với pdfCropMargins (`--threshold` mặc định **191/255 ≈ 75%** — pixel phải tối hơn 191 mới tính "chữ/ink") thì `<250` (≈98%) lỏng hơn nhiều, sẽ bắt cả antialiasing nhạt, JPEG ringing quanh chữ/viền bong bóng làm hàng/cột gần-trắng bị tính nhầm là "có nội dung". Nguồn: https://pypi.org/project/pdfCropMargins/, https://github.com/abarker/pdfCropMargins/blob/master/README.rst (tool OSS đang maintain, số liệu từ chính doc chính thức).
2. **Vô dụng cho color webtoon có nền gradient/màu**: `<250` giả định nền là giấy trắng gần 255 (đúng cho manga B&W raw — đây là use-case gốc SmartStitch được thiết kế, xem comment dòng 62-64 trong `smart-split.ts`). Với webtoon nền trời gradient, nền màu pastel, halftone — pixel nền có thể là 150-220 và KHÔNG hề gần trắng → mọi pixel đều `<250` → ink density = gần 100% → bbox = cả band → trim vô tác dụng (không phải "trim quá tay" mà là "không trim được gì").

**Cả 2 vấn đề trên đều AN TOÀN theo đúng ưu tiên bảo thủ của user**: lỏng hơn ở B&W → bbox rộng hơn thực tế cần → under-trim, không đụng vào bong bóng/nét vẽ; vô dụng ở color webtoon → bbox = cả band → no-op (tiết kiệm 0%, không cắt nhầm vào gì cả). Nói cách khác, `<250` không có đường nào dẫn tới trim quá tay/cắt vào nội dung thật — rủi ro thực sự chỉ là tính năng "không làm được gì" trên webtoon màu, không phải "làm hỏng ảnh". Vì vậy giữ `<250` làm fallback (YAGNI) là AN TOÀN để ship trước; đầu tư reference-color-distance chỉ cần thiết nếu muốn tính năng THỰC SỰ có tác dụng trên corpus color webtoon, không phải vì lo ngại về an toàn.

**Otsu**: KHÔNG khuyến nghị làm cơ chế chính. Nhiều nguồn học thuật đồng thuận (≥3 nguồn độc lập: https://www.baeldung.com/cs/otsu-segmentation , https://ietresearch.onlinelibrary.wiley.com/doi/full/10.1049/iet-ipr.2019.0176 , https://muthu.co/otsus-method-for-image-thresholding-explained-and-implemented/ ): Otsu thất bại khi histogram non-bimodal, tương phản thấp, hoặc ánh sáng/nền không đều — chính xác là đặc điểm ảnh webtoon màu (không phải text B&W scan mà Otsu được thiết kế cho). Chi phí cài Otsu đúng (histogram + tối ưu variance) cũng không rẻ hơn nhiều so với phương án dưới, trong khi rủi ro sai cao hơn.

**Đề xuất thay thế** (mượn ý tưởng "reference background color + fuzz" của ImageMagick thay vì "khoảng cách tới trắng cố định"): sample màu nền tham chiếu từ dải pixel sát 4 mép band (giả định mép band thường là vùng đệm/gutter), rồi tính ink = khoảng cách màu tới nền tham chiếu vượt ngưỡng fuzz (ví dụ 2–5%, tương tự khuyến nghị `-fuzz 1-2%` cho JPEG của IM). Cách này handle được cả 2 trường hợp (B&W trắng thật + color gradient) bằng cùng 1 cơ chế, chi phí tính toán tương đương (vẫn O(W×H) một lần quét). **Đây là thay đổi kiến trúc, không phải chỉnh số — cần bàn với planner có đáng làm không, hay giữ `<250` làm fallback đơn giản (YAGNI) và chỉ áp trim khi phát hiện ảnh có đặc điểm gần B&W** (ví dụ: histogram grayscale có đỉnh gần 255 rõ rệt) để tránh rủi ro trim sai trên color webtoon.

## Q3 — Padding sau bbox

Không có chuẩn ngành riêng cho comic. Tham chiếu gần nhất: **pdfCropMargins** (`-p`/`--percentRetain`, mặc định **10%**) — giữ lại 10% của PHẦN LỀ ĐÃ PHÁT HIỆN (không phải 10% kích thước trang); `-p 0` = bbox sát tuyệt đối, giá trị âm = crop lấn vào nội dung. Nguồn: https://pypi.org/project/pdfCropMargins/ , https://github.com/abarker/pdfCropMargins/blob/master/README.rst (chính thức).

ImageMagick `-trim` mặc định **KHÔNG có padding** (bbox sát tuyệt đối; muốn đệm phải tự thêm `-border` sau).

**Khuyến nghị cho project này**: vì mục đích là khung hình VIDEO (Ken Burns), không phải in ấn tiết kiệm giấy, nên rộng rãi hơn quy ước pdfCropMargins: **3–5% kích thước bbox mỗi cạnh, hoặc tối thiểu 12–16px (lấy max)**. Đây là lựa chọn thẩm mỹ (breathing room quanh nhân vật/chữ), độ tin cậy THẤP — nên để designer/user xem preview thực tế trước khi chốt.

## Q4 — Ngưỡng "có lợi rõ ràng" để áp trim

Không tìm được số chuẩn ngành. Tiền lệ gần nhất chỉ là khái niệm tương tự khác mục đích: Kumiko (https://github.com/njean42/kumiko , file `lib/panel.py`) lọc bounding-box panel nhỏ hơn `small_panel_ratio` (tỉ lệ so với kích thước trang) để loại nhiễu phát hiện — không phải ngưỡng "đáng trim".

**Khuyến nghị (suy luận, không phải số đã kiểm chứng)**: chỉ áp trim khi bbox ≤ **80–85%** diện tích band gốc (tiết kiệm ≥15–20%). Lý do: dưới mức này, khác biệt gần như không nhận ra được trong khung hình pan/zoom, mà rủi ro (trim nhầm do nhiễu/watermark) là có thật → thà không trim (bảo thủ, đúng tinh thần user yêu cầu). Nên thêm điều kiện phụ: không trim nếu MỘT cạnh riêng lẻ chỉ co lại <2% kích thước cạnh đó (tránh trim vài px không ý nghĩa, tăng phức tạp không lợi).

## Q5 — Cạm bẫy và cách chống

| Cạm bẫy | Cách chống | Nguồn/độ tin cậy |
|---|---|---|
| Nhiễu JPEG (ringing quanh chữ/viền, block artifact) | Bắt buộc **run-length** (nhiều hàng/cột liên tiếp dưới ngưỡng), không xét từng hàng độc lập. Có thể pre-blur nhẹ trước khi tính ink (IM khuyến nghị `-blur` trước `-trim` cho ảnh nhiễu, fuzz 15% khi kèm blur) | https://usage.imagemagick.org/crop/ — TRUNG BÌNH-CAO |
| Watermark mảnh ở mép | `ignorableBorder` đã có (5px) đúng hướng nhưng có thể QUÁ NHỎ cho watermark webtoon thực tế (thường 10-30px, đôi khi giữa mép không sát biên). Đề xuất: tách hằng số riêng cho tính năng trim (không dùng chung với gutter-detection, vì 2 mục đích khác nhau — 5px hợp lý cho gutter nhưng có thể không đủ cho watermark) | Suy luận nội bộ — TRUNG BÌNH |
| Viền đen của ảnh scan | Đây là lỗ hổng thật: viền đen tuyệt đối (~0) sẽ bị tính là "ink" ở MỌI ngưỡng (kể cả threshold nghiêm 191 của pdfCropMargins), khiến hàng/cột biên luôn "có nội dung" → bbox không co được (khác biệt với "trim quá tay", đây là "trim không tác dụng"). Cách chống: phát hiện run đồng nhất tuyệt đối (variance ~0, không phải chỉ "an toàn theo lineTolerance") sát mép (vài px) → loại trừ khỏi ink test TRƯỚC khi tính projection, coi như border-artifact chứ không phải nội dung | Suy luận riêng, không có nguồn xác nhận trực tiếp — THẤP-TRUNG BÌNH |
| Panel nền đen full-bleed (nội dung thật, ví dụ cảnh đêm) | KHÔNG được trim. Phân biệt với viền scan bằng: viền artifact MỎNG (vài px) + đồng nhất tuyệt đối; panel nội dung thật DÀY (chiếm phần lớn band) + có variance (nhiễu/nét/screentone dù tối). Chỉ áp cơ chế loại-trừ-viền khi run mỏng + variance~0 đồng thời | Suy luận riêng — THẤP-TRUNG BÌNH |
| Bối cảnh chung: khi nào KHÔNG trim | (1) Tiết kiệm diện tích < ngưỡng Q4; (2) bbox chạm cả 4 cạnh (no-op tự nhiên); (3) band đã gần-trắng toàn phần (đã bị `mergeLowInkBands` xử lý ở tầng khác — không nên trim tiếp band loại này theo nghĩa khác); (4) phát hiện nghi vấn (bbox lệch bất thường một phía, có thể do watermark/nhiễu chưa lọc hết) — bảo thủ: giữ nguyên band | Theo đúng yêu cầu "thà trim hụt còn hơn trim quá" của user |

## Q6 — So sánh với ImageMagick `-trim`

Cơ chế: `-trim` xét từng cạnh trong 4 cạnh ĐỘC LẬP, so khớp màu pixel biên với 1 màu "nền" tham chiếu trong dung sai `-fuzz` (không có `-fuzz` ⇒ so khớp gần như tuyệt đối/0% dung sai), trim tham lam từ ngoài vào cho tới hàng/cột đầu tiên KHÔNG khớp thì dừng. Define mở rộng `trim:percent-background=X%` cho phép một hàng/cột vẫn được coi là "nền" dù chứa tới X% pixel không khớp — đây chính là ý tưởng "ngưỡng tỉ lệ" mà thiết kế của user đã chọn đúng, chỉ khác là IM không bật default (mặc định 0%).

**Vì sao IM hay trim hụt hoặc trim quá tay** (nguồn: https://usage.imagemagick.org/crop/ , tài liệu chính thức/kinh điển của cộng đồng IM):
- **Trim hụt**: mặc định 0% dung sai + so khớp từng hàng độc lập ⇒ ảnh JPEG thật (không bao giờ đồng màu tuyệt đối, luôn có dải màu lệch nhẹ do nén lossy) chỉ cần 1 pixel lệch là dừng trim ngay tại đó — dừng sớm, để lại viền dư.
- **Trim quá tay**: khi tăng `-fuzz`/`percent-background` để chống lỗi trên, dung sai màu thuần túy (không có khái niệm cấu trúc/hình dạng) có thể nuốt luôn viền mờ, watermark nhạt, gradient nội dung thật vì chúng "đủ gần" màu nền về mặt khoảng cách màu.
- Không có khái niệm run-length/gutter tối thiểu — 1 hàng nhiễu đơn lẻ đủ chặn toàn bộ quá trình, khác với thiết kế band-split hiện tại của repo (`minGutterHeight`) vốn đã tránh được lỗi này.

**So với thiết kế hiện tại của repo**: cách tiếp cận projection-profile + ngưỡng tỉ lệ (đã chốt) về bản chất tương đương `trim:percent-background=X%` (biến thể NÂNG CAO của IM, không phải mặc định) — tức là đã đi trước 1 bước so với `-trim` mặc định. Nếu áp dụng thêm run-length filter (Q5) thì sẽ vượt trội hoàn toàn so với `-trim`, vì IM không có cơ chế "yêu cầu N hàng liên tiếp" — mỗi hàng được xét độc lập.

---

## Hạn chế của nghiên cứu này

- **Không có nguồn nào giải quyết trực tiếp bài toán ink-bbox-trim cho webtoon màu** — mọi số liệu là suy luận bắc cầu từ OCR/document-trim/PDF-crop, các domain có giả định B&W/độ tương phản cao khác với webtoon màu.
- Không đọc được raw source code của Kumiko (https://github.com/njean42/kumiko , `lib/panel.py`) và ManhwaFormatter (https://github.com/eskutcheon/ManhwaFormatter , `utils.py`, `manhwa_normalizer.py`) trực tiếp — dữ liệu lấy qua WebFetch tóm tắt AI của các file đó, có rủi ro sai lệch nhỏ so với code gốc dù đã trích quote cụ thể.
- Chưa test thực nghiệm trên corpus webtoon thật của project (không có sẵn ảnh mẫu trong session này) — mọi ngưỡng số (1%, 3-5%, 80-85%...) là điểm khởi đầu để calibrate, KHÔNG phải giá trị đã đo đạc.
- Không đánh giá halftone/screentone pattern (rất phổ biến trong manga đen trắng, ít trong webtoon màu Hàn) như một cạm bẫy riêng dù có nhắc tới trong Q2 — nếu corpus project có scan B&W có halftone, cần nghiên cứu bổ sung riêng (halftone dot pattern có thể phá ngưỡng ink cả absolute lẫn adaptive).

## Câu hỏi chưa giải quyết

1. Corpus thực tế của project là B&W scan (manga dịch) hay color webtoon (manhwa gốc) chiếm đa số? Quyết định này ảnh hưởng trực tiếp Q2 (giữ `<250` đơn giản hay đầu tư reference-color-distance).
2. Có sẵn tập ảnh mẫu (10-30 strip) để calibrate ngưỡng 1%, 80-85% bằng mắt trước khi hard-code không?
3. Watermark trong corpus thực tế nằm ở đâu (mép hay giữa ảnh), kích thước bao nhiêu px — cần biết để chỉnh `ignorableBorder` riêng cho trim.

Status: DONE_WITH_CONCERNS
Summary: Đã trả lời đủ 6 câu hỏi kèm bảng tham số, nhưng phần lớn số liệu là suy luận bắc cầu từ domain lân cận (OCR/PDF-crop/ImageMagick), không có nguồn nào giải bài toán ink-bbox cho webtoon màu trực tiếp — bắt buộc calibrate thực nghiệm trước khi hard-code ngưỡng.
Concerns/Blockers: (1) Chưa rõ corpus thật B&W hay color — ảnh hưởng lớn tới Q2. (2) Chưa có ảnh mẫu để test ngưỡng số. (3) Phát hiện viền đen scan vs panel nền đen full-bleed là suy luận riêng, chưa kiểm chứng — planner nên coi là rủi ro cần review kỹ khi implement, không nên tin tuyệt đối.
