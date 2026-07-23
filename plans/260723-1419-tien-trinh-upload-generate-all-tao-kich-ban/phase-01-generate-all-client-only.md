---
phase: 1
title: "Generate all — làm giàu tiến trình (client-only)"
status: done
priority: P2
effort: "2-3h"
dependencies: []
---

# Phase 1: Generate all — làm giàu tiến trình (client-only)

## Overview
Backend Generate all đã phát đủ `JobProgress{done,total,currentIndex,phase}` qua SSE; client đã render `<Progress>` + nhãn "Đang soạn nhịp X/Y…". Phase này CHỈ làm giàu hiển thị ở client — thêm %, ETA, và thông tin nhịp đang chạy. **Không đụng API/store/SSE.** Rủi ro thấp nhất → làm trước, độc lập với Phase 2/3.

## Requirements
- Functional:
  - Hiện % số cạnh nhãn (hiện chỉ có thanh, không có số text).
  - Hiện ETA ước lượng từ nhịp `rpm`: `còn ~ (total-done) × 60000/rpm` (làm tròn phút/giây). Xác nhận HIỆN ETA dạng "còn ~" (Validation S1) — chấp nhận lệch.
<!-- Updated: Validation Session 1 - giữ ETA dạng "còn ~" ước lượng -->
  - Hiện nhịp đang chạy từ `currentIndex`: "Đang soạn nhịp k/N: '<mấy chữ đầu narration của nhịp đó>'".
  - Auto-highlight (và scroll-into-view) nhịp đang chạy ở cột trái danh sách.
- Non-functional:
  - Zero thay đổi backend/API/store/schema.
  - Tôn trọng reduced-motion (đã có `components/use-reduced-motion.ts`) cho hiệu ứng scroll.
  - ETA chỉ hiện khi `phase==='processing'` và `rpm>0` và `total>done` (tránh chia 0 / nhấp nháy "còn 0s").

## Architecture
- Toàn bộ dữ liệu đã có ở client: `dto.progress` (SSE cập nhật), `beats` (đã sort), `rpm` (state).
- `currentIndex` = `beat.order` của nhịp đang xử lý → `beats.find(b => b.order === progress.currentIndex)` để lấy narration.
- ETA thuần client: interval mỗi nhịp ≈ `60000/rpm` ms (khớp `minIntervalMs` server dùng). Ước lượng "đủ tốt" — nêu rõ "còn ~", không cam kết chính xác (vision latency biến thiên).
- Highlight cột trái: class active theo `progress.currentIndex`; `scrollIntoView({block:'nearest'})` khi đổi (guard reduced-motion → `behavior:'auto'`).

## Related Code Files
- Modify: `content-extractor/app/storyboard/[jobId]/page.tsx`
  - `phaseLabel(p)` (~dòng 45): thêm nhánh ghép % + ETA khi processing.
  - Khối `<Card>` tiến độ (~dòng 440-451): thêm dòng phụ ETA + nhịp đang chạy.
  - Danh sách nhịp cột trái (aside ~dòng 475+): thêm highlight + scrollIntoView theo `currentIndex`.
- Không tạo/xoá file. Không sửa `lib/*`, không sửa route.

## Implementation Steps
1. Helper `formatEta(remainingMs: number): string` → "~2 phút" / "~45 giây". Đặt cục bộ trong page (KISS); nếu muốn test riêng thì `lib/utils.ts` + case trong `scripts/verify-*.mts`.
2. Mở rộng `phaseLabel` (hoặc biến dẫn xuất trong render): khi `processing`, nhãn = "Đang soạn nhịp {done}/{total} · {pct}% · còn {eta}". Giữ nguyên nhãn `done`/`queued`/`failed` cũ.
3. Tính `currentBeat = beats.find(b => b.order === progress.currentIndex)`; hiện dòng phụ "'{narration.slice(0,60)}…'"; fallback narration rỗng → "band #{sourceIndex+1}".
4. Thêm `data-active` + `ref` cho item cột trái; scroll trong `useEffect([progress.currentIndex])` (KHÔNG setState trong render/effect — chỉ scroll DOM).
5. Kiểm mắt: chạy Generate all job nhiều nhịp → xác nhận %/ETA/nhịp cập nhật mượt, highlight bám SSE.

## Success Criteria
- [x] Nhãn tiến độ hiện đủ: số nhịp, %, ETA khi đang chạy; done hiện "Hoàn tất X/Y nhịp" như cũ.
- [x] Nhịp đang chạy hiện đúng nội dung + được highlight/scroll ở cột trái (`activeBeatRef` + `scrollIntoView` guard reduced-motion).
- [x] ETA ẩn khi không hợp lệ (rpm 0, done≥total, không processing) — điều kiện `etaVisible`.
- [x] Không thay đổi nào ở `app/api/**`, `lib/**`, `lib/schema.ts` (Phase 1 chỉ đụng `app/storyboard/[jobId]/page.tsx`).
- [x] `pnpm lint` + `pnpm test:unit` xanh.

## Risk Assessment
- **ETA lệch thực tế** (vision latency > interval): nhãn ghi "còn ~" (ước lượng), chấp nhận được.
- **Lint react-hooks mới** (cấm setState-trong-effect/render — memory `shadcn-cli4-react-hooks-lint`): dùng "adjust state during render" đã có sẵn trong file làm mẫu; scroll đặt trong effect theo `currentIndex`, không setState.
- **SSE nhảy `done` thưa do pacing**: không phải lỗi phase này; %/ETA phản ánh đúng dữ liệu server gửi.
