---
phase: 1
title: "Nối dây region → render"
status: done
priority: P1
effort: "3-4h"
dependencies: []
---

# Phase 1: Nối dây region → render

## Overview

Làm cho `Beat.region` thật sự điều khiển khung hình video. Hiện `lib/script.ts:159` đặt cứng
`region: null` cho mọi shot → mọi thứ người dùng vẽ ở Storyboard bị vứt. Đây là nền móng: không có
phase này, Phase 2 và 3 đều vô nghĩa.

**Điều chỉnh so với brainstorm:** brainstorm gộp "nối dây region **+ motion**" vào một bước. Phase
này cố ý **chỉ nối region**. Lý do: `motion` chưa tồn tại cho tới Phase 2, nối sẵn sẽ để lại field
chết; và phase này cần kiểm chứng được độc lập ("region có tới render không?") mà không bị nhiễu bởi
field chưa dùng. Chi phí: Phase 2 sửa lại đúng 3 chỗ này thêm một lượt (~3 dòng) — rẻ hơn là mang
dead code qua một gate kiểm chứng.

## Requirements

**Functional**
- [ ] Region vẽ ở Storyboard → tạo kịch bản → render: khung hình video khớp region
- [ ] `region = null` (Cả trang) vẫn hoạt động y như cũ (cả band)
- [ ] UI nói rõ: sửa nhịp sau khi đã có kịch bản thì phải tạo lại kịch bản mới ăn

**Non-functional**
- [ ] `BeatRegion` + hợp đồng PATCH beat giữ **tương thích ngược** — không đổi
- [ ] `.mtvproj` cũ (chưa có region trên shot) import vẫn chạy
- [ ] `lib/script.ts` giữ thuần ở phần `toScriptSegments` (không I/O) để test được

## Architecture

Sợi dây đứt tại đúng 3 điểm, nối lại theo thứ tự dữ liệu chảy:

```
storyboard/script/route.ts:48-61   map beat → ScriptBeatInput   ← (3) thêm region: beat.region
        ↓
lib/script.ts:40-45   interface ScriptBeatInput                 ← (1) thêm field region
        ↓
lib/script.ts:131-173 toScriptSegments → Shot                   ← (2) region: inputs[idx].region
        ↓
lib/timeline.ts:109 → render-video.mts:180-188 → kenburns()     ← không đụng, tự ăn theo
```

`1 beat = 1 shot` map 1:1 (`toScriptSegments` dòng 157-161 tạo đúng 1 shot cho mỗi `shotIndex`), nên
copy trực tiếp, không cần đối chiếu `sourceBeatIds`.

**Không cần đụng** `toScriptManifest` (`lib/schema.ts:209-217`) — nó **đã** copy `shot.region` sẵn.
Region đã round-trip đúng qua `.mtvproj`; chỉ là trước giờ luôn copy giá trị `null`.

### Hệ quả: code validate ngủ đông sẽ thức dậy

`lib/project.ts:156-162` validate "region shot vượt biên ảnh working" — **code này chưa bao giờ chạy
thật** vì `shot.region` luôn null. Sau phase này nó mới thực sự thực thi. Nếu nó có bug tiềm ẩn thì
đây là lúc lộ ra. Phải test round-trip `.mtvproj` có region thật, không chỉ tin là nó đúng.

## Related Code Files

- Modify: `content-extractor/lib/script.ts` — `ScriptBeatInput` (40-45), `toScriptSegments` (157-161)
- Modify: `content-extractor/app/api/jobs/[id]/storyboard/script/route.ts` — map inputs (48-61)
- Modify: `content-extractor/app/storyboard/[jobId]/page.tsx` — cảnh báo "cần tạo lại kịch bản"
- Read-only (hiểu bối cảnh): `lib/timeline.ts:109`, `scripts/render-video.mts:180-188`,
  `lib/project.ts:156-162`, `lib/schema.ts:165-169` (`Shot`), `lib/kenburns.ts:49-91`

## Implementation Steps

1. **Baseline (BẮT BUỘC, làm trước mọi thay đổi).** Ở cây sạch: `nvm use 24`, render 1 chương thật,
   lưu MP4 + ghi lại mode mà mỗi shot nhận được. Không có mốc này thì không thể phân biệt "P1 làm
   đúng" với "P1 làm hỏng". Lưu ghi chú vào `plans/260717-1702-storyboard-region-motion-autotrim/reports/`.

2. `lib/script.ts:40` — `ScriptBeatInput` thêm `region: BeatRegion | null`. Import type từ `./schema`
   (file đã import `SceneContent` sẵn).

3. `lib/script.ts:159` — `region: null` → `region: inputs[idx].region`.
   ⚠️ Không đụng `weight: 1` và logic lọc `shotIndices` trùng/ngoài biên (dòng 138-151) — orthogonal.

4. `app/api/jobs/[id]/storyboard/script/route.ts:55-60` — object trả về thêm `region: beat.region`.
   Giữ nguyên toàn bộ logic `itemMatchesWorking` (dòng 51-59) — nó giải bài toán khác (content tươi
   vs snapshot), đừng gộp vào.

5. **UI cảnh báo** ở `app/storyboard/[jobId]/page.tsx`: khi storyboard đã có script và người dùng vừa
   sửa region/narration → banner "Kịch bản hiện tại chưa ăn thay đổi này — bấm Tạo kịch bản lại".
   Đặt ở Storyboard (nơi gây ra thay đổi), không phải Script.
   → **Chốt trong lúc code:** `updateBeat` (`storyboard-store.ts:145`) đã tăng `beat.rev` mỗi lần
   sửa — rẻ nhất là so `rev` tại thời điểm generate. Nếu store chưa lưu mốc đó thì banner tĩnh "sửa
   nhịp xong nhớ tạo lại kịch bản" cũng đủ cho v1 (KISS). Không xây cơ chế đồng bộ.

6. **Verify** theo thứ tự, dừng ngay khi đỏ:
   ```bash
   nvm use 24
   pnpm build
   pnpm tsx scripts/verify-render.mts
   pnpm tsx scripts/verify-kenburns-css.mts
   ```
   Rồi render lại đúng chương của bước 1, **so với baseline bằng mắt**.

7. **Test round-trip `.mtvproj`**: tạo project có region thật (không null) → Export → Import → render
   → so khung hình. Đây là đường duy nhất phát hiện `project.ts:156-162` có bug ngủ đông hay không.

## Success Criteria

- [ ] Vẽ region ôm nửa trên band → render: video chỉ thấy nửa trên (trước: thấy cả band)
- [ ] Switch "Cả trang" (`region = null`) → video y hệt baseline bước 1
- [ ] `.mtvproj` export→import với region ≠ null → render ra khung hình y hệt trước khi export
- [ ] `.mtvproj` cũ (shot region null) vẫn import + render được — không vỡ tương thích ngược
- [ ] `pnpm build` + `verify-render.mts` + `verify-kenburns-css.mts` xanh
- [ ] Sửa nhịp khi đã có kịch bản → UI nói rõ phải tạo lại, không âm thầm

## Risk Assessment

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Đổi output render mọi project có region đã vẽ | Cao | Chủ ý (đó là mục đích). Baseline bước 1 + duyệt bằng mắt |
| `project.ts:156-162` có bug ngủ đông, giờ mới chạy | Trung | Bước 7 test round-trip region thật — bắt buộc, không bỏ |
| **Region nhỏ → video mờ nhoè.** Vùng 300×400 scale lên 1080×1920 = vỡ. Trước đây không gặp vì region luôn null | Trung | Chưa xử lý ở phase này (scope HOLD). Ghi nhận; cân nhắc cảnh báo UI khi `region.w` < ~50% bề rộng band — đưa ra hỏi ở gate validate |
| Người dùng đã vẽ region "cho vui" trên project cũ → video đột ngột đổi | Thấp | Nêu trong ghi chú phát hành; region cũ vốn không có tác dụng nên số lượng nhỏ |

## Notes

- `sourceKind: 'pages'` hardcode (`storyboard/route.ts:50`) là nhãn thừa sau refactor 07-07 —
  **không đụng** ở phase này. Nợ đã ghi ở plan.md.
- Working tree đang có thay đổi TTS chưa commit chạm `lib/schema.ts` — phase này không sửa
  `schema.ts` nên không đụng nhau. Phase 2 thì có.
