# Journal: Nối dây region → render + ghi đè hiệu ứng per-nhịp + nút "Vừa khít nội dung"

- **Ngày:** 2026-07-17
- **Plan:** `plans/260717-1702-storyboard-region-motion-autotrim/` (3 phase, hoàn tất cả 3)
- **Review:** code-reviewer DONE_WITH_CONCERNS — 0 Critical/High, 4 Low (đã fix L1–L3, chấp nhận L4 cosmetic)

## Việc đã làm

**P1 — Region tới được render.** Sợi dây đứt đúng một chỗ: `lib/script.ts` hardcode `region: null`
khi map beat → shot. Nối lại 3 điểm (`ScriptBeatInput.region`, `toScriptSegments`, `script/route.ts`)
+ banner "tạo lại kịch bản" ở Storyboard. Validate ngủ đông `project.ts` (region shot vượt biên)
thức dậy và chạy đúng — kiểm chứng bằng round-trip `.mtvproj` region thật.

**P2 — MotionOverride per-nhịp.** `{mode: auto|pan-v|pan-h|zoom|static, reverse?}` trên Beat/Shot,
`undefined` = auto (không migration). `planKenburns` nhận `motion`: mode ép dùng chung helper công
thức với auto; ép pan bỏ trần `PAN_MAX_COVER` (tôn trọng người dùng, vận tốc vẫn kẹp), bất khả thi
→ fallback auto. `static` bỏ hẳn zoompan. Reverse: pan `(t/dur)→(1-t/dur)`, zoom dạng đóng
`Z-(Z-1)*on/(frames-1)`. UI: chip preview thành dropdown + nút đảo hướng; đảo khi đang Auto =
"đóng băng" mode suy ra thành ghi đè tường minh.

**P3 — Nút "Vừa khít nội dung".** `lib/ink-bbox.ts` thuần (projection profile, ink `<250` gray công
thức repo, ngưỡng tỉ lệ 1%, padding max(4%, 14px)); cropper tính trên canvas 800px rồi scale ngược
về px working (sàn padding co theo scale — finding L1 của review).

## Số đo đáng nhớ

- Baseline corpus thật (38 slice → 16 band): **12/16 pan-v, 0 pan-h** — bệnh đơn điệu là cấu trúc.
- Gate hồi quy quan trọng nhất: `motion` undefined → filtergraph **byte-identical** (string assert
  literal trong `verify-script.mts` Test 7b + diff JSON 16 band trước/sau).
- Reverse chứng minh bằng mắt: frame đầu forward = đỉnh band, frame đầu reverse = đáy band.
- **Trái với spike:** nút trim ăn tiền hơn dự đoán — 11/16 band co 15–47% (spike đo 7.3% TB trên
  cấu hình band khác). Corpus này có lề trắng hai bên thật sự (panel hẹp căn giữa), nhìn thấy rõ
  trong frame render. Spike đo trên 27 band settings khác nên số khác; nút thủ công hưởng lợi lớn.

## Quyết định & bài học

- **Byte-identical bằng string assert rẻ hơn và mạnh hơn so sánh video.** Đóng đinh literal
  filtergraph vào test = mọi hồi quy nhánh auto lộ ngay, không cần render lại chương nào.
- `static` không dùng nhánh pan với `travelPx=0` như plan gợi ý mà `scale=W:H` thẳng — nhánh pan
  có edge case crop vượt biên khi lệch tỉ lệ ≤2% (scaledH < H); dung sai méo ≤2% đúng bằng nhánh
  zoompan đang chấp nhận.
- `reverse` × `static`/`auto` = no-op im lặng (comment tại chỗ) — ném lỗi chỉ phiền UI.
- Sàn padding tuyệt đối phải **co theo scale** khi tính trên canvas hạ cỡ rồi phóng ngược —
  không thì sàn 14px thành ~39px working.

## Nợ ghi nhận (không làm lần này)

- 🔍 `MAX_BAND_HEIGHT` đang quyết định hiệu ứng (band chạm trần → tallness 3.11 → pan-v hàng loạt)
  — điều tra riêng, có khi giá trị hơn cả P3.
- Cảnh báo UI khi region quá nhỏ (video mờ do scale) — câu hỏi mở từ gate validate, chưa chốt.
- `sourceKind: 'pages'` hardcode ở `storyboard/route.ts` — nhãn thừa sau refactor 07-07.
- L4 (review, cosmetic): dấu ✓ dropdown có thể trỏ mode ép đã bất khả thi sau khi co vùng — chip
  và render vẫn đúng (fallback auto), chấp nhận.
