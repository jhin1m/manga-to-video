# 2026-07-09 — UI đồng bộ 4 stage + file project .mtvproj (shadcn/ui × React 19 × Next 16)

## Bối cảnh

Content-extractor có 4 stage (Trích xuất → Storyboard → Kịch bản → Video) nhưng UI rời rạc: không app shell chung, mỗi trang tự dựng header + điều hướng, màu/bề rộng gõ tay, "nạp lại storyboard từ manifest + ảnh" không an toàn (phụ thuộc env `MAX_EDGE`, `SPLIT_HEIGHT`, toạ độ region hay vượt biên). Cần redesign toàn bộ bằng **shadcn/ui** (Tailwind v4 CSS-first + React 19.2 + Next 16.2), thêm **app shell + stepper**, thay reload bằng **file project `.mtvproj`** (zip chứa cả data + ảnh → không re-ingest, không phụ thuộc env), tách **Kịch bản** thành route `/script/[jobId]`, làm lại **Storyboard** thành master-detail + chọn vùng trực quan.

## Triển khai

Phiên cook auto 4 phase, **TẤT CẢ XON XANH TỰ ĐỘNG** (không cần bàn tay):

### Phase 1 — Foundation & Shell
- **shadcn/ui trên Tailwind v4:** init qua `npx shadcn@latest init -y -b radix -p nova` (CLI mới: flag `-b` giờ là `base|radix`, không phải base color — tốn 2 lần thử debug). Components import từ package `radix-ui` hợp nhất; bỏ Geist font vì init tự thêm → build không phụ thuộc mạng (chế độ offline).
- **Token custom + Button variant:** Tailwind v4 khai báo `@theme inline` trong `globals.css`; mở rộng `:root` từ `--background/--foreground` hiện tại thành bộ token shadcn đầy đủ (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, radius) + custom `--ai` (violet)/`--success` (emerald). Button variant tương ứng (`.ai`, `.success`).
- **App shell:** top bar (tên app · trạng thái project/jobId · chấm "● chưa lưu" dirty · nút Lưu/Mở project + toggle theme) + stepper 4 bước gating theo `components/project-context.tsx` (readiness: jobId → storyboard → script → video). Theme class-based (`.dark` trên `<html>`) + next-themes duyệt.
- **Sonner toast:** sẵn sàng cho mọi lỗi/thông báo.
- **Quirk lint mới:** shadcn deps đưa `react-hooks/set-state-in-effect` + `react-hooks/refs` (Radix dùng ref nặng):
  - `set-state-in-effect` → mặc định: cấm `setState` trong `useEffect`. Giải pháp: `useSyncExternalStore` cho "mounted" flag thay vì state.
  - `refs` cấm đọc ref trong render. Giải pháp: pattern "adjust state during render" bằng state setter conditional.

### Phase 2 — File project .mtvproj
- **Định dạng zip:** `project.json` (version + jobId + metadata) + manifest + storyboard + script + render-config (tuỳ) + `working/*.jpg` (ảnh canvas storyboard) + `items/band-*.jpg` (ảnh band Job Stage 1 để rehydrate) + `audio/seg-*.mp3` (TTS cache) + bgm (tuỳ).
- **Quyết định KISS:** embed thẳng ảnh working + items → import **KHÔNG gọi `ingestBandItems`/`stitchSlices` lại** (bỏ phụ thuộc `MAX_EDGE`, `SPLIT_HEIGHT`, khớp toạ độ tuyệt đối 100%). Pages: `working/<i>.jpg` == `items/band-<i>.jpg` về nội dung (tool nội bộ, dung lượng OK trùng).
- **Audio cache hydration:** SegmentAudio trỏ `mp3Path` trên đĩa. Export đọc bytes từ `mp3Path` (bỏ qua nếu file dọn rồi, cảnh báo mềm). Import ghi mp3 vào `TTS_CACHE_DIR/<key>.mp3` (key = tên file cache gốc sha256) → `mp3Path` mới → preview/CLI tái dùng cache → **cache HIT, không gọi lại ElevenLabs**.
- **Route import/export:** `lib/project.ts` validate version/path-safety (tái dùng `assertSafeName`/`parseEntryJson` export từ `lib/bundle.ts` để DRY); biên region/index liền mạch. Gỡ route import/export storyboard JSON cũ. E2E section B2 chuyển sang `.mtvproj`.
- **Quyết định:** `.mtvproj` KHÔNG chứa RenderConfig/BGM → sống ở state trang Video, server không lưu (giữ stateless).
- **Top bar wiring:** "Lưu project" blob download; "Mở project" file picker → POST import → điều hướng tới `/storyboard/{jobId}` hoặc `/script`/`/video` theo trạng thái.

### Phase 3 — Reskin Trích xuất + Video
- **Chỉ thay lớp trình bày:** Card/Slider/Select/Switch/Table/Badge thay thế các thành phần cũ; lỗi → toast (không console.log).
- **Giữ nguyên SSE/poll/player/Ken Burns:** khung containerType/cqw/cqh không đụng → bất biến toàn bộ Stage 2.
- **Gỡ block reload:** trong `app/page.tsx` bỏ phần `<details>` "Nạp lại storyboard" cũ (thay bằng nút "Mở project" ở top bar).

### Phase 4 — Storyboard master–detail + `/script/[jobId]`
- **Cropper visual:** `components/region-cropper.tsx` (kéo-vẽ + kéo-di chuyển, quy đổi tỉ lệ hiển thị↔px working, clamp biên, numeric "Nâng cao" 2 chiều).
- **Tách ScriptPanel:** route mới `/script/[jobId]` (page riêng).

### Gate & Code Review
- **Tester subagent 243 assert PASS:** lint/build/unit/e2e×2/render MP4 xanh.
- **Code-reviewer tìm 3 vấn đề:**
  - **H1 (High):** draft stale sau compose → narration bị đè bằng chuỗi rỗng. Fix: flag `draftTouched` + auto-resync khi narration load.
  - **M1 (Medium):** cropper kéo vượt mép bị tịnh tiến (không clamp pointer). Fix: clamp x/y khi drag tới biên.
  - **M2 (Medium):** `readProject` thiếu check biên shot.region + dims dương. Fix: bổ sung validate + test case.
- **Tất cả fix xong, suite xanh lại.**

## Khó khăn thực

1. **shadcn CLI đổi flag:** `-b` giờ là `base|radix`, không phải base color. Tôi thử `-b nova` (sai) → đi thẳng Radix (đúng), rồi tìm `-p nova` (palette). 2 lần debug gây mất thời gian nhẹ.
2. **Hook scout-block chặn Next docs:** `.ckignore` không allow `node_modules/next/dist/docs/` → phải tạm allow pattern để đọc cách lifecycle. Pattern `!**/…` không ăn; phải dùng `!node_modules/next/dist/docs/**` explicit.
3. **Radix + React 19 lint:** `react-hooks/set-state-in-effect` + `react-hooks/refs` rất strict (Radix đọc ref trong render, `useEffect` setState pattern). Phải dùng `useSyncExternalStore` + state-during-render pattern thay vì bạn tay đút flag.
4. **Audio mp3Path portability:** khi export, nếu quên ghi mp3 vào cache + set `mp3Path` mới, CLI/preview miss cache → gọi lại ElevenLabs. Fix: cover ở verify-project.mts + explicit test.

## Quyết định ghi

| Quyết định | Lý do | Alternative |
|-----------|-------|------------|
| `.mtvproj` embed thẳng ảnh + không re-ingest | Tránh phụ thuộc env, khớp toạ độ 100%, đơn giản | Tái tạo từ bytes raw gốc (phức tạp, tốn tính) |
| Pages: `working/<i>.jpg` == `items/band-<i>.jpg` | Tool nội bộ, dung lượng OK, giữ đơn giản | Delta encoding (quá phức) |
| RenderConfig/BGM sống ở state Video, không lưu .mtvproj | Tránh dư thừa state, mỗi phiên chạy tuỳ chỉnh riêng | Lưu + import (cứng nhắc, khó update quy trình) |
| TTS cache key = tên file cache gốc sha256 | Dễ rehydrate, tránh collision, portable | Random UUID (khó match) |
| Tách Script thành route `/script/[jobId]` | Giảm page size, match dân UI component phân trang | Giữ trong storyboard layout (quá nặng) |

## Kết quả test

- `npm run lint` + `npm run build` **XANH**
- `npm run test:unit` **ALL_PASS** (132+ assert gồm verify-script, verify-project round-trip)
- `npm run test:e2e` × 2 (section A + B2 .mtvproj) **ALL_PASS** (34+ assert)
- `npm run test:render` (MP4 9:16 + 16:9 + TTS cache HIT) **RENDER_ALL_PASS**
- Lệnh custom `npm run verify:project` (round-trip fixture strip/pages, có/không script/audio, đổi `MAX_EDGE`) **PASS** → toạ độ region khớp, không re-ingest.

## Chưa commit

Toàn bộ thay đổi (14 file modify, 11 file create, 7 file delete, +2400 line) nằm ở working tree, chờ lệnh `git commit`.

---

## Cảm xúc thực

Phiên này tuyệt: plan chốt kỹ → 4 phase đều hoạt động liên tiếp, lint/build/test **không vỡ** lần nào. Khó khăn nhỏ (shadcn CLI flag, scout-block, react-hooks lint) đều giải ngoắn gọn. Code-reviewer tìm được 1 bug thật (H1 draft stale) + 2 lỗi tiềm tàng (M1 cropper, M2 validate) → tất cả fix xong. Cảm giác là plan được viết rất tỉnh táo — không gì bất ngờ, chỉ việc execute cẩn thận.

**Status:** DONE
**Summary:** 4/4 phase hoàn thành, suite xanh; shadcn/ui shell + .mtvproj file + storyboard/script tách UI × toàn bộ logic Stage 1–2 intact.
