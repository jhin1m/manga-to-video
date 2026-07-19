# Code review — series-memory bible + recap (phase 1+2)

Scope: skill Python (SKILL.md, references/series.md, series.schema.json, validate.py, tests) +
TS app (lib/script.ts, recap route, page.tsx, verify-script.mts) + vision-reader agent.
Verdict: **7/10** — 1 High (recap output sai format trên provider mặc định), 3 Medium, 3 Low.
Không có Critical (không lộ dữ liệu/không breaking public contract).

---

## HIGH

### H1 — `generateRecap` đi qua `createCompletion` → ép JSON mode, recap ra sai format
`lib/script.ts:294` gọi `createCompletion(client, model, messages, disableThinking)`.
`createCompletion` (vision.ts:124-150) **luôn** gắn `response_format:{type:'json_object'}` khi
`jsonModeSupported=true` (mặc định, vision.ts:86). Nhưng prompt recap yêu cầu **văn bản thuần**
("Trả về DUY NHẤT phần recap dạng văn bản thuần, không markdown fence") và `generateRecap` KHÔNG
parse JSON — chỉ `.trim()` rồi trả nguyên.

Hệ quả theo provider:
- **z.ai / GLM (mặc định dự án)**: json-mode được hỗ trợ → model bị buộc trả JSON object. Recap trả
  về là chuỗi kiểu `{"recap":"…"}` (object, không thể là bare string). File `chapter-recap.md` tải
  về chứa JSON, KHÔNG phải format `references/series.md` (ngôi ba + "Kết chương:"). Hỏng deliverable
  chính của Phase 2, **im lặng** (không lỗi, user tải nhầm file JSON).
- **OpenAI gpt-4o**: json_object bắt buộc có chữ "json" trong messages; prompt recap không có → 400.
  `createCompletion` bắt 400, set `jsonModeSupported=false` **process-wide** rồi retry không json →
  recap plain text OK, nhưng lật cờ global tắt json-mode cho cả generateScript/vision sau đó (mất
  tối ưu token, không mất đúng đắn).

So sánh: `generateScript` (script.ts:247) dùng cùng helper nhưng SAU đó `parseScriptJSON(...)` —
đúng, vì nó CHỜ JSON. `generateRecap` tái dùng helper JSON cho output plain-text là lệch thiết kế.

Fix: `generateRecap` KHÔNG dùng `createCompletion`; gọi `client.chat.completions.create({model,
messages})` trực tiếp (không `response_format`), hoặc thêm cờ `json:boolean` vào `createCompletion`.

Test không bắt được: Test 1c (verify-script.mts:155) chỉ assert chuỗi `buildRecapPrompt`, KHÔNG chạy
`generateRecap` → nhánh json_object vô hình với test (coverage phantom cho hợp đồng generation thật).

---

## MEDIUM

### M1 — Nút "Xuất recap" không gate theo script tồn tại (lệch acceptance phase-02)
`page.tsx:317-328` render nút "Xuất recap chương" bất cứ khi nào có `jobId`, chỉ disable theo
`recapBusy`. Phase-02 step 3 + criterion: "Chỉ hiện nút xuất khi đã có script." Nút nằm ở trang
**home** (block context, gate `jobId`), nhưng script sinh ở trang **storyboard** khác. Ở home script
thường CHƯA tồn tại → bấm → route trả 404 "Chưa có kịch bản" → toast lỗi. Graceful nhưng gây hiểu
lầm và không đạt tiêu chí gate. Home không có tín hiệu script-existence nên cần fetch/subscribe mới
gate được, hoặc chuyển nút sang trang storyboard.

### M2 — `importSeriesContext` không PATCH → import rồi reload ngay là mất context
`page.tsx:104-127` chỉ `setContext(joined)`, không gọi `saveContext`. Persistence dựa vào onBlur
textarea hoặc `createStoryboard` (page.tsx:175). File picker KHÔNG focus textarea nên onBlur không
bắn. Kịch bản: user Nạp series context → reload trang (chưa blur, chưa tạo storyboard) → context vừa
nạp chưa PATCH → mất. Lệch criterion phase-02 "PATCH lưu, reload hiện lại". Fix: gọi
`void saveContext(jobId)` cuối `importSeriesContext`.

### M3 — Trần 4000 ký tự của TS << ngân sách bible của skill; cắt sai đầu + comment ngược
`page.tsx:118-123`: `joined.slice(0,4000)` khớp `maxLength` textarea. Nhưng bible skill cap **2000
TỪ** (~10-12k ký tự) — bible đầy đủ MỘT MÌNH đã vượt 4000 ký tự → import bible thật bị cắt còn một
phần bible, mọi summary (nằm sau) **không bao giờ vào** context. Ngoài ra thứ tự ghép là bible →
summaries natural-sort TĂNG dần, nên phần đuôi bị cắt là recap **MỚI NHẤT** (N-1, quan trọng nhất cho
nối mạch), KHÔNG phải "recap cũ nhất" như comment ghi. Cap là hành vi đã chấp nhận (plan: không nới),
nhưng comment sai chiều và thực tế interop bible-đầy-đủ trên TS coi như hỏng. Ít nhất sửa comment +
cân nhắc ưu tiên giữ recap mới thay vì cắt đuôi.

---

## LOW

### L1 — TS recap thiếu H1 header của format series.md
`buildRecapPrompt` (script.ts:260) yêu cầu văn bản thuần, không có dòng `# Recap <slug>: <title>` mà
`references/series.md` mô tả trong ví dụ. 3 phần tử hợp đồng được nêu tên (≤250 từ, "Kết chương:",
ngôi ba) đều KHỚP; header là cosmetic và validate.py không kiểm nên không fail. TS không biết slug/tên
bộ nên bỏ header là hợp lý — chỉ cần user tự thêm dòng tiêu đề khi đặt vào `.mtv/summaries/`. Ghi nhận
divergence, không chặn.

### L2 — `word_count` tính cả header/"Kết chương:" vào cap summary
`validate.py:150-151` đếm `str.split()` toàn file gồm dòng `# Recap …` và `Kết chương: …`. Recap thân
đúng 250 từ + header + dòng chốt có thể vượt cap → cảnh báo `summary-over-cap` giả. Chỉ WARNING, không
chặn pipeline (comment đã thừa nhận đếm thô). Chấp nhận được.

### L3 — validate_series không bắt self-reference / duplicate slug
`context_recaps_used` có thể chứa chính slug của chương đó (vô nghĩa cho stale) hoặc chapters có slug
trùng — cả hai đều pass. Không phải lỗi thực tế đáng chặn cho tool nội bộ; ghi nhận để về sau.

---

## Đối chiếu acceptance / checks bắt buộc

(a) **Phase 1 criteria**: đạt. `validate.py --series` phân biệt schema-sai / summary-thiếu / bible-
over-cap đúng (smoke 16/16, xác nhận logic khớp). SKILL.md mô tả đủ detect/context/recap/diff-update/
stale. Mode chương đơn không đổi hành vi validate content/script. **Phase 2 criteria**: chưa đạt trọn
— M1 (gate script) + M2 (PATCH-on-import) là 2 điểm lệch trực tiếp với Success Criteria phase-02.

(b) **Regression**: `buildPrompt`/`generateScript`/`PROMPT_HEADER` (script.ts) không đổi — recap là
hàm append thuần. `validate_content`/`validate_script` logic byte-nguyên; `main()` thêm nhánh
`--series` trước, giữ đường `--workdir --stage` cũ. Luồng context PATCH cũ (saveContext/onBlur/
createStoryboard) không đổi. Mode chương đơn skill: bước 0/9 chỉ chạy khi có `.mtv/`, workflow A-Z chỉ
thêm mệnh đề "nếu có" — hành vi cũ giữ nguyên.

(c) **Public contracts**: JobStatusDTO/.mtvproj/PROJECT_VERSION không đụng (diff không chạm schema.ts/
jobs.ts). Route recap là additive. CLI validate.py backward-compatible (invocation cũ chạy y hệt; args
chuyển từ required→optional + `parser.error` thủ công, exit code tương đương).

(d) **Nhất quán 2 engine**: format recap TS khớp 3 quy tắc được nêu tên (250 từ / "Kết chương:" /
ngôi ba) — trừ header H1 (L1). SKILL.md series mode nội bộ nhất quán: workdir series =
`<series>/.mtv/workdirs/<chapter-slug>/`, KHÔNG mâu thuẫn ràng buộc "mỗi workdir 1 render" (mỗi chương
workdir riêng). Guardrail vision-reader tái dùng đúng wording (chỉ gọi tên/xưng hô, cấm tả thứ không có
trong ảnh).

(e) **Lỗi logic code mới**: H1 (json mode) là lỗi thực. validate_series edge cases OK (summary thiếu
bắt được cả khi chỉ referenced; recap-ref-unknown đúng; chapters rỗng an toàn; slug pattern chặn `/`).
Sort file picker đúng (bible-first comparator chuẩn, numeric localeCompare). Blob download chuẩn
(revoke sau click sync OK). Route status codes hợp lý (404 no-script / 400 config / 502 model).

## Điểm tích cực (calibrate rủi ro)
- series.schema.json chặt (`additionalProperties:false`, slug pattern chống path).
- Smoke fixtures mỗi case-fail đúng 1 lỗi → phân biệt được rule; series-warn-* kiểm stderr.
- Guardrail context bleed nhất quán giữa series.md, SKILL.md, agent.
- Không log nội dung bible/recap (TS không log; validate.py chỉ in word-count + rule, không in nội dung).

## Unresolved
- Nút "Xuất recap" đặt ở home có chủ đích hay nên chuyển sang trang storyboard? (ảnh hưởng cách fix M1)
- Chấp nhận TS recap thiếu H1 header (L1) hay muốn thêm ô nhập slug/tên bộ để sinh header đúng?
