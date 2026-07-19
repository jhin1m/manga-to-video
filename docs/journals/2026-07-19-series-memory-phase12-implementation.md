# Series-memory bible + recap — Phase 1+2 implementation

**Date**: 2026-07-19 23:01
**Severity**: Medium
**Component**: Python skill (`~/.claude/skills/manga-to-video/`) + TS app `content-extractor` (lib/script.ts, storyboard recap route, page.tsx)
**Status**: Resolved (Phase 1+2 code done, commit `4763d7c`) — Phase 3 pilot Blocked chờ corpus

## What Happened

Thực thi plan `plans/260719-2235-series-memory-bible-recap/plan.md` (từ brainstorm cùng ngày, kiến trúc đã khóa, không bàn lại). Mục tiêu: pipeline vốn xử lý từng chương độc lập trôi xưng hô, hụt mạch truyện giữa chương — thêm state xuyên chương `<series>/.mtv/` (`series.json` + `bible.md` facts bền cap 2000 từ + `summaries/chapter-N.md` recap cap 250 từ).

Phase 1 (skill Python, engine chính, tự động): contract `.mtv/`, `references/series.md` làm nguồn chân lý format, `series.schema.json`, `validate.py --series` mới, `SKILL.md` thêm Series mode (bước 0 nạp bible + 2 recap gần nhất, bước 9 diff-update bible, cảnh báo stale khi re-run chương cũ). Agent `manga-vision-reader` nhận guardrail context series.

Phase 2 (TS app, chỉ Mức 1 — nạp/xuất file, không server-side, không đổi `.mtvproj`): `buildRecapPrompt`/`generateRecap` trong `lib/script.ts`, route `POST /api/jobs/[id]/storyboard/recap`, 2 nút UI (nạp series context qua file picker + xuất recap .md), trần context 4000→16000 ký tự.

## The Brutal Truth

Code review 7/10 bắt đúng thứ đáng sợ nhất trước khi ship: một helper dùng chung có side-effect ngầm, và test không hề chạm vào nó. `Test 1c` chỉ assert chuỗi prompt, chưa từng gọi thật `generateRecap` — coverage trông đủ nhưng là ảo cho đúng cái hợp đồng generation thật sự chạy production.

## Technical Details

**H1 (High)**: `generateRecap` (script.ts:294) tái dùng `createCompletion` — cùng helper `generateScript` (script.ts:247) dùng để lấy JSON. `createCompletion` (vision.ts:124-150) **luôn** gắn `response_format:{type:'json_object'}` khi `jsonModeSupported=true` (mặc định). Prompt recap yêu cầu văn bản thuần ("Trả về DUY NHẤT phần recap dạng văn bản thuần"), `generateRecap` chỉ `.trim()` chứ không parse JSON. Trên z.ai/GLM (provider mặc định dự án), model bị ép trả object → recap tải về là `{"recap":"…"}`, không phải format `references/series.md`. Lỗi im lặng — không exception, chỉ sai file. Trên OpenAI thì json_object bắt buộc chữ "json" trong prompt → 400, `createCompletion` bắt lỗi và lật cờ `jsonModeSupported=false` **process-wide**, tự sửa được recap nhưng tắt luôn tối ưu token cho mọi call script/vision sau đó.

Fix: thêm param `jsonMode=false` additive vào `createCompletion`, không đổi call site của `generateScript`.

**M2**: `importSeriesContext` chỉ `setContext()`, không PATCH — file picker không trigger `onBlur` của textarea nên context nạp vào mất khi reload trước khi blur/tạo storyboard. Fix: gọi `saveContext(jobId)` ngay sau import.

**M3**: Trần cũ 4000 ký tự < bible cap thiết kế 2000 từ (~10-12k ký tự) — hai engine cùng một contract nhưng lệch số. Bible đầy đủ một mình đã vượt trần, và vì bị cắt *đuôi* trong khi comment ghi ngược chiều, phần mất luôn là recap **mới nhất** — đúng thứ quan trọng nhất cho nối mạch. Nâng lên 16000.

## What We Tried

M1 (gate nút "Xuất recap" theo script tồn tại) bị reject có căn cứ: nút nằm ở trang Home, Home không giữ state script (script sinh ở trang storyboard khác) — route đã trả 404 rõ ràng, coi đây là deviation ghi nhận chứ không phải bug chặn ship.

## Root Cause Analysis

`createCompletion` được thiết kế cho một use case (ép JSON) rồi tái dùng cho use case khác (plain text) mà không có cờ phân biệt. Đây là lỗi kinh điển: helper "tiện" nên dùng lại, nhưng side-effect (response_format + auto-flip global flag khi 400) không nằm trong signature, chỉ nằm trong doc/đọc code. Test viết theo prompt-level (assert string) thay vì exercise thật generation path nên không bắt được nhánh JSON.

## Lessons Learned

Khi một helper có side-effect phụ thuộc provider (ép JSON mode, tự lật cờ global khi lỗi), bất kỳ call site mới nào cũng phải tự hỏi "output tôi cần có phải JSON không?" trước khi tái dùng — đừng copy-paste theo chỗ nào "gần giống". Test phantom coverage (chỉ assert prompt string, không chạy generation thật) là nợ kỹ thuật vô hình — cần ít nhất 1 test path chạm provider mock cho mỗi hàm generation mới, không chỉ prompt builder.

## Next Steps

Phase 3 pilot (3 chương liên tiếp, corpus thật do user chuẩn bị) đang **Blocked** — chờ corpus. Khi có: chạy pilot để nghiệm thu tay 2 criteria UI của Phase 2 (M1 gate + M2 PATCH đã fix nhưng chưa test end-to-end với dữ liệu thật), đối chiếu xưng hô/tên nhân vật 100% nhất quán giữa 3 script, và kiểm bible sau 3 chương ≤ cap 2000 từ. Owner: session tiếp theo khi corpus sẵn sàng.
