---
phase: 4
title: "Preview UI video"
status: completed
priority: P2
dependencies: [1, 2, 3]
effort: ""
---

# Phase 4: Preview UI video

## Overview

Trang `/video/[jobId]`: phát duyệt kịch bản dưới dạng video (Ken Burns **xấp xỉ bằng CSS**), overlay phụ đề chỉnh **font/size/màu/vị trí live**, cấu hình **BGM** (file/âm lượng/duck) + **khung hình** + voice. Hai chế độ: "im lặng" (durationHint, free) và "có audio" (synth TTS → timing thật). Export → bundle + `render-config.json`.

## Requirements

- **Functional:** player lần lượt segment→shots; mỗi shot ảnh band + transform pan/zoom theo thời lượng; caption theo config; panel điều khiển live; nút "Synth audio" (gọi P3 `/tts`) chuyển sang timing thật; nút "Export để render" tải bundle.
- **Non-functional:** preview là **xấp xỉ** (nói rõ trên UI), MP4 từ CLI mới là chân lý; `prefers-reduced-motion` tôn trọng; không chặn UI khi synth.

## Architecture

- `app/video/[jobId]/page.tsx`: nạp `ScriptManifest` (đã xác nhận P2) + working image URLs + `RenderConfig` state (khởi từ `defaultRenderConfig`).
- **Khung hình:** container tỉ lệ cố định theo `aspect` (`aspect-ratio` CSS). Ảnh band `object-fit` + `transform: translateY()/scale()` nội suy theo `requestAnimationFrame` khớp thời lượng shot.
- **Ken Burns CSS (xấp xỉ):** suy hướng từ region như CLI (cao/hẹp→pan dọc, rộng→pan ngang, gần vuông→zoom) để preview ~ giống bản render. Ghi chú "preview xấp xỉ".
- **Phụ đề overlay:** div tuyệt đối, style từ `config.subtitles` (font/size theo `sizePct`×chiều cao khung, màu, outline `text-shadow`, vị trí). Chỉnh là thấy ngay. **Hiện caption theo câu** (Validation S1) — dùng chung logic split câu + canh giờ với `toSrt` (P5), không đổ cả khối narration segment.
- **BGM:** `<input type=file>` (giữ blob local để export), slider `volume`/`duckDb`; preview phát BGM nền (duck đơn giản bằng cách hạ volume khi có audio segment).
- **2 chế độ:** im lặng dùng `durationHint` (`estimateSeconds`); "Synth audio" gọi P3 `/tts` → thay `durationSec` thật + phát `<audio>` từ `tts/[segId]/audio`.
- **Trong 1 segment nhiều shot:** chia thời lượng theo `weight` → mốc đổi hình (như CLI P5) để preview khớp cảm giác b-roll.
- **Export:** gọi `GET export-bundle` (kèm config hiện tại + BGM blob nếu upload qua `POST` multipart) → tải `bundle.zip`. Nếu đã "Synth audio", audio cache vào bundle.

## Related Code Files

- Create: `content-extractor/app/video/[jobId]/page.tsx` (+ component player/controls)
- Modify: `content-extractor/app/storyboard/[jobId]/page.tsx` (link "Dựng video" — nếu chưa nối ở P2)
- Uses: routes P3 (`export-bundle`, `tts`, `tts/[segId]/audio`), working image route sẵn có

## Implementation Steps

1. Trang `/video/[jobId]`: nạp script + working + config state.
2. Player CSS Ken Burns (rAF) theo segment→shots, đổi hình theo weight.
3. Overlay phụ đề style-live từ config; panel điều khiển (aspect/fps/subtitle/BGM/voice).
4. Chế độ im lặng (durationHint) ↔ "Synth audio" (P3 /tts, timing thật + phát audio).
5. Export bundle (config + audio cache + BGM) → tải zip.

## Success Criteria

- [x] Phát duyệt được cả kịch bản: hình đổi theo segment/shot, caption hiện.
- [x] Chỉnh font/size/màu/vị trí phụ đề → thấy ngay trên khung.
- [x] Đổi aspect → khung + framing đổi tương ứng.
- [x] "Synth audio" → timing chuyển sang audio thật, nghe được.
- [x] Export → bundle.zip mở lại được ở CLI (P5) không lỗi.
- [x] UI nêu rõ preview là xấp xỉ, không phải bản render cuối.

## Risk Assessment

- **CSS ≠ ffmpeg zoompan** → chấp nhận (preview để duyệt bố cục/timing/style); ghi rõ.
- **BGM duck ở preview thô** → chỉ cần "cảm giác"; duck chuẩn do CLI (P6) làm.
- **Ảnh band lớn tải chậm** → dùng route working image (đã downscale); lazy theo segment.
