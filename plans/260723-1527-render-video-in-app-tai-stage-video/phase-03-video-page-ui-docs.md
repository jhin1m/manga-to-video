---
phase: 3
title: "Video page UI + docs"
status: completed
priority: P1
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Video page UI + docs

## Overview

Thêm nút "Render MP4" (hành động chính) ở `/video/[jobId]` gọi route render, đọc NDJSON progress → thanh `<Progress>` + "shot i/N", nút Hủy, khi xong tự tải `results.zip` (MP4+.srt+.timeline). Hạ "Export bundle zip" xuống dropdown "Nâng cao". Cập nhật README.

## Requirements

- Functional: nút "Render MP4" (primary) → POST `.../render` (multipart config+bgm giống `exportBundle`), đọc stream qua `readNdjsonBody`.
- Functional: hiển thị progress — phase label tiếng Việt + "shot i/N" + `<Progress value>` (từ tổng shot). Khi `done`: tự click tải `downloads.zip` (results.zip, 1 cú — tránh multi-download bị chặn). Khi `error`: `toast.error`.
- Functional: nút **Hủy** trong lúc render → `AbortController.abort()` trên fetch → stream đóng → server kill ffmpeg. UI về trạng thái nghỉ.
- Functional: đang render → disable nút Render (+ server đã guard 409; nếu 409 thì toast).
- Functional: "Export để render" (zip) chuyển vào `DropdownMenu` "Nâng cao" (component `dropdown-menu.tsx` có sẵn). CLI hint text giữ nhưng gộp vào cùng menu.
- Non-functional: giữ style/preview hiện tại; không phá Ken Burns preview CSS. Copy tiếng Việt.

## Architecture

**`app/video/[jobId]/page.tsx` (sửa):**
- State mới: `renderBusy`, `renderPhase: string | null`, `renderProgress: {i,n} | null`, `renderZipUrl: string | null`, `renderAcRef = useRef<AbortController|null>`.
- `async function renderVideo()`:
  ```ts
  const ac = new AbortController(); renderAcRef.current = ac;
  const fd = new FormData(); fd.append('config', JSON.stringify(config)); if (bgmFile) fd.append('bgm', bgmFile);
  const res = await fetch(`/api/jobs/${jobId}/storyboard/render`, { method:'POST', body: fd, signal: ac.signal });
  if (res.status === 409) { toast.error('Đang render job này'); return; }
  if (!res.body) throw ...;
  await readNdjsonBody(res.body, (ev) => {
    // cập nhật renderPhase/renderProgress theo ev.phase; ev.done → setRenderZipUrl(ev.downloads.zip) + auto-download; ev.error → toast
  });
  ```
- Auto-download: tạo `<a href={downloads.zip} download>` click (results.zip là attachment từ output route). Một file → không lo multi-download bị chặn. Giữ URL ở `renderZipUrl` cho nút "Tải lại" nếu muốn.
- Hủy: `renderAcRef.current?.abort()` → fetch reject `AbortError` (nuốt), reset state.
- Nhãn phase VN: tts→"Tổng hợp giọng", timeline→"Dựng timeline", shot→"Render cảnh {i}/{n}", concat→"Ghép cảnh", audio→"Trộn tiếng", bgm→"Trộn nhạc nền", subs→"Khắc phụ đề", mux→"Đóng gói MP4".
- Actions bar: `[Synth audio] [Render MP4 (primary)] [Kịch bản]` + `DropdownMenu "Nâng cao"` chứa `Export để render (zip)` + dòng lệnh CLI hint.
- Progress UI: đặt dưới player (hoặc thay Badge preview khi đang render) — `<Progress value={i/n*100}>` + text phase + nút `[Hủy]`.

**README.md (sửa):**
- Thêm bước "Render MP4 tại trang video (1 nút)" là đường CHÍNH; zip+CLI là "nâng cao / render máy khác / batch".
- Sửa câu "MP4 từ CLI mới là chân lý" → "MP4 do engine render (in-app hoặc CLI, chung `lib/render.ts`) là chân lý; preview CSS xấp xỉ." Cập nhật mục "Preview ≠ render".

## Related Code Files

- Modify: `content-extractor/app/video/[jobId]/page.tsx`
- Reference: `content-extractor/lib/ndjson-client.ts` (`readNdjsonBody`), `components/ui/progress.tsx`, `components/ui/dropdown-menu.tsx`, `lib/render.ts` (kiểu `RenderEvent` — có thể import type để ăn khớp)
- Modify: `content-extractor/README.md`

## Implementation Steps

1. Import `readNdjsonBody` + `Progress` + `DropdownMenu`; import type `RenderEvent` từ `lib/render.ts` cho type-safe onLine.
2. Thêm state + `renderVideo()` + `cancelRender()`; map `RenderEvent` → UI.
3. Sửa actions bar: thêm nút Render primary; chuyển Export zip vào DropdownMenu "Nâng cao".
4. Thêm block Progress + nút Hủy; auto-download results.zip khi done (tùy chọn nút "Tải lại" dùng `renderZipUrl`).
5. Cập nhật README. `npm run lint` + `npm run build` (đảm bảo route mới + trang biên dịch).
6. Kiểm tay E2E thủ công: chạy `next start` với env mock (theo memory `next16-e2e-next-start`), tạo job → storyboard → script confirm → Render → thấy progress → MP4 tải về; test Hủy; test render lần 2 (disable/409).

## Success Criteria

- [ ] Bấm "Render MP4" → thấy progress theo shot → `results.zip` tự tải (giải nén ra MP4+.srt+.timeline).
- [ ] Nút Hủy dừng render (`pgrep ffmpeg` sạch), UI về nghỉ, không toast lỗi giả.
- [ ] Đang render: nút Render disable; nếu server 409 → toast rõ.
- [ ] "Export zip" vẫn hoạt động trong menu "Nâng cao" (không hồi quy).
- [ ] `npm run lint` + `npm run build` sạch. README phản ánh luồng mới + sửa câu "chân lý".

## Risk Assessment

- **Multi-download bị trình duyệt chặn:** đã né bằng gói 1 `results.zip` — chỉ 1 lượt tải.
- **AbortError rò ra toast:** fetch bị abort ném lỗi. *Mitigation:* bắt riêng `err.name === 'AbortError'` → bỏ qua.
- **Type lệch UI↔engine:** onLine parse sai shape. *Mitigation:* import `RenderEvent` type từ `lib/render.ts` (client-safe: chỉ type, không kéo Node code — kiểm không import runtime Node vào bundle client; nếu vướng thì khai type riêng ở client).
- **Next 16 build:** trang/route mới có thể cần convention mới. *Mitigation:* `npm run build` ở bước 5; đọc `node_modules/next/dist/docs/` nếu lỗi.

<!-- Updated: Validation Session 1 — done → tự tải results.zip 1 cú (bỏ nút .srt/.timeline riêng) -->

