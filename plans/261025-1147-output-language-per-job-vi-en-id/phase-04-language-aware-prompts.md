---
phase: 4
title: "Language-aware prompts"
status: completed
priority: P1
effort: "3h"
dependencies: [2, 3]
---

# Phase 4: Language-aware prompts

## Overview
Prompt vision/biên kịch/recap nhận ngôn ngữ. Prompt vẫn viết bằng tiếng Việt (chỉ dẫn), chỉ đổi
ngôn ngữ ĐẦU RA. Nhánh `vi` trả đúng hằng số cũ.

## Requirements
- Vision `buildVisionPrompt(context?, lang = 'vi')`:
  - `vi` → `PROMPT` cũ nguyên vẹn.
  - khác → biến thể: "MỌI giá trị bằng {PROMPTNAME VIẾT HOA}"; dialogue "PHẢI DỊCH sang {promptName}; nếu thoại gốc đã là {promptName} thì giữ nguyên" (tránh mâu thuẫn "không chép nguyên văn tiếng Anh" khi đích là en). Giữ vế ép dịch — memory: thiếu vế này glm-4.5v chép nguyên văn ~6/9 lượt.
  - Ví dụ gọi nhân vật "chàng trai/cô gái…" → "bằng {promptName}" cho non-vi.
- Biên kịch `buildPrompt(inputs, context?, lang = 'vi')`: thay "lời kể tiếng Việt" → "{promptName}"; khối "Ngôi kể" có ví dụ đại từ VIỆT (hắn, y, cô, nàng / tôi, ta, mình / huynh, muội) → non-vi dùng câu chung "đại từ ngôi ba của {promptName}; cấm ngôi nhất của {promptName} làm chủ ngữ lời kể". Nhãn dữ liệu (`Thoại:`, `Lưu ý:`, `(không có mô tả)`) giữ nguyên.
- Recap `buildRecapPrompt(segments, lang = 'vi')`: "tiếng Việt" → promptName; **giữ literal dòng `Kết chương: `** (hợp đồng series.md) — ghi rõ trong prompt "dòng cuối bắt đầu đúng chuỗi 'Kết chương: ' (giữ nguyên chữ này), nội dung sau bằng {promptName}".
- Cách cài: một hàm/bảng nhỏ cục bộ trong từng file sinh đoạn khác nhau theo lang; KHÔNG template hoá cả prompt vi (rủi ro lệch byte). vi = early return hằng số.
- Call-site truyền ngôn ngữ job:
  - `lib/narration.ts:76` `describeImage(..., getJob(jobId)?.context, getJob(jobId)?.outputLanguage)`
  - `describeImage(buffer, filename?, context?, lang?)` (`lib/vision.ts:482`)
  - `resolveMissingContent` opts `{ context, lang }` (`lib/script.ts:170`)
  - `generateScript(inputs, context, hooks, lang)` — hoặc gộp `{context, lang}`; chọn cách ít đổi chữ ký nhất, cập nhật mọi caller (`git grep generateScript`).
  - Route script `app/api/jobs/[id]/storyboard/script/route.ts:99`, route recap `.../recap/route.ts:27`.
- `estimateSeconds` (`lib/schema.ts:138`): chỉ sửa comment ("~15 ký tự/giây, đúng cho vi/en/id").

## Related Code Files
- Modify: `lib/vision.ts`, `lib/script.ts`, `lib/narration.ts`, `lib/schema.ts` (comment), 2 route trên.

## Success Criteria
- [x] Hash snapshot Phase 1 vẫn khớp với `lang='vi'` và khi bỏ trống lang.
- [x] Prompt `en`/`id` chứa promptName, không còn chữ "tiếng Việt" ngoài literal `Kết chương`.

## Risk Assessment
Model trả lẫn tiếng Việt do chỉ dẫn viết bằng tiếng Việt → kiểm ở e2e thật Phase 7; nếu lẫn thì thêm câu nhấn "TUYỆT ĐỐI không viết tiếng Việt" cho non-vi (không đụng nhánh vi).
