# RegionCropper: Resize handles + live shot preview

**Date**: 2026-07-09 13:45
**Severity**: Medium
**Component**: Storyboard region cropper
**Status**: Completed

## Bối cảnh

RegionCropper trong Storyboard có 2 điểm đau: (1) **mơ hồ** — kéo hộp nhưng không thấy kết quả preview, user không chắc họ chọn cái gì; (2) **sơ sài** — hộp chỉ vẽ mới / nhấc, không resize được. Plan chốt 3 việc: rút helper Ken Burns CSS (DRY từ trang video), 8 tay cầm resize delta-based, live shot preview + chip nhãn chuyển động.

## Triển khai kỹ thuật

**Phase 1 — Rút helper:** `lib/kenburns-css.ts` (pure, 18 test assertion) + `use-reduced-motion.ts` hook. Video page thay xài helper chung, xoá CSS inline 30 dòng.

**Phase 2 — 8 tay cầm:** Quyết định quan trọng từ code review: **delta-based resize** (`edge = baseEdge + Δpointer`) thay vì "edge snap tới con trỏ". Lý do: click suông trên tay cầm không làm region nhảy giá trị; kéo dài không giật nhát đầu. Fix sau review: bare click không còn mutate region.

**Phase 3 — Preview:** `ShotPreview` dùng `<canvas>` làm foreground element thay vì dataURL nested / CSS-transform cồng kềnh. Vì canvas là replaced element có intrinsic size → tái dùng nguyên fgStyle + object-fit khớp trang video. RAF loop p 0→1 ở state cục bộ, chỉ `ShotPreview` re-render → 60fps mượt. Fallback `onload` cho decode() reject trên Safari với strip lớn.

## Sự cố đáng ghi

`test:e2e-video` fail ở `parseScriptJSON` (HTTP 502). Nghi hồi quy từ phiên này — test lại bằng **stash toàn bộ thay đổi + chạy trên cây sạch**: fail y hệt, cùng chi tiết lỗi. Chứng minh lỗi **có sẵn** ở `lib/script.ts:116-118`, không liên quan plan này.

**Bài học:** Stash-and-rerun là cách rẻ nhất tách "lỗi của mình" khỏi "lỗi có sẵn". Tiết kiệm thời gian debug cực lớn so với đào vào ngành hàng `parseScriptJSON`.

## Verification

| Gate | Kết quả |
|------|---------|
| `tsc`, `eslint`, `next build` | PASS |
| `test:unit` (6 suite) | PASS |
| `test:e2e` (storyboard 70+ assert) | PASS |
| `test:render` (28+ assert) | PASS |
| `test:e2e-video` | FAIL — lỗi có sẵn, ngoài scope |

## Follow-up

`parseScriptJSON` (HTTP 502) → điều tra riêng (mock-script-model format?). Ngoài phạm vi plan này.

---

**Cảm xúc thực**: Plan chốt sâu, 3 phase liên tiếp xanh. Điểm khó (delta-based resize) được code review tìm ra + fix ngay. Phần preview canvas là khoản design thông minh — tái dùng constraint của video page thay vì hardcode UI mới. Sự cố e2e-video lúc đầu nghi hồi quy — stash+rerun ngay giải tỏa nghi ngờ, không phí công debug sâu.

**Status**: DONE
**Summary**: 3/3 phase xanh; RegionCropper resize + live preview hoạt động khớp design; Ken Burns CSS rút thành module dùng chung.
