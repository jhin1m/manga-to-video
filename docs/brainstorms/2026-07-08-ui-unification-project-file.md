# Brainstorm — Đồng bộ UI 4 Stage + File project (.mtvproj)

- **Ngày:** 2026-07-08
- **App:** `content-extractor` (Next 16.2 · React 19.2 · Tailwind v4 · tool nội bộ, 1 người vận hành)
- **Trạng thái:** Đã chốt thiết kế — chuyển sang `/ck:plan`
- **Flags:** none

## 1. Vấn đề

App có 4 "stage" theo cảm nhận người dùng nhưng UI/UX rời rạc:

1. **Không có app shell chung** — `app/layout.tsx` rỗng; mỗi trang tự dựng header + cụm nút → gốc rễ của "không nhất quán".
2. **Điều hướng lộn xộn** — từ vựng nút back/forward mỗi trang mỗi kiểu, không có mô hình bước, không biết "đang ở đâu / đi đâu tiếp".
3. **Bề rộng + màu nút trôi tự do** — `max-w-5xl/6xl/3xl` lẫn lộn; blue/emerald/violet/red gõ tay, chưa codify.
4. **"Nạp lại storyboard từ manifest + ảnh" đần** — do kiến trúc: export chỉ lưu *beats* (toạ độ), không lưu ảnh working; store in-memory → nạp lại phải **re-ingest** (stitch + smart-split) để *hy vọng* tái lập toạ độ, phụ thuộc `MAX_EDGE`/`SPLIT_HEIGHT`/env → lỗi "region vượt biên". Fragile.
5. **Storyboard không chuẩn UI/UX** — sửa region bằng ô số x/y/w/h thô; nhồi 2 stage (nhịp + Kịch bản AI) trên 1 trang cuộn dài; canvas strip 1/4 cạnh list dọc dài.

Stage **"Dựng video"** được đánh giá tốt → giữ nguyên ruột.

## 2. Yêu cầu (chốt qua hỏi–đáp)

| Hạng mục | Quyết định |
|---|---|
| Mức redesign | **Redesign toàn bộ bằng shadcn/ui** |
| Nội dung file project | **Toàn bộ project** (Stage 1 content + storyboard + script + render config + audio synth) |
| Quan hệ với export cũ | **Gộp "Lưu/Mở project" + giữ `bundle.zip` cho CLI**; thay cặp export/import storyboard JSON |
| Điểm đau Storyboard | Sửa region số x/y/w/h · Nhồi 2 stage 1 trang · Canvas aside + list dọc dài |
| Tách Kịch bản | **Route riêng `/script/[jobId]`** (khớp stepper 4 bước) |
| Video | Giữ nguyên logic, chỉ reskin control |

**Ngoài phạm vi:** đổi logic ingest/vision/smart-split/Ken Burns/timeline/render CLI; DB/auth/queue (vẫn in-memory + file là bản lưu); drag-reorder nhịp (không chọn).

## 3. Nền tảng kỹ thuật đã xác minh

- Tailwind **v4** CSS-first (`@import "tailwindcss"` + `@theme inline`, **không** có `tailwind.config.js`).
- React **19.2**, Next **16.2** (AGENTS.md cảnh báo Next bản phá vỡ tương thích — đọc `node_modules/next/dist/docs/` trước khi code).
- shadcn/ui **hỗ trợ chính thức Tailwind v4 + React 19** → khả thi. Chưa init (`components.json` chưa có; thiếu `clsx`/`tailwind-merge`/`class-variance-authority`/`lucide-react`).
- Dark mode hiện theo `prefers-color-scheme` (media) → chuyển **class-based** + nút toggle trên top bar.
- `lib/bundle.ts` đã có khuôn zip + `assertSafeName` chống path-traversal → **tái dùng** cho `.mtvproj`.

## 4. Phương án đã cân nhắc

| # | Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|---|
| A | Shell + design tokens (giữ ruột trang) | Rủi ro thấp, đồng bộ ngay | Chưa chạm điểm đau storyboard/route | Là **nền** của phương án chọn |
| B | Shell + tách Kịch bản thành route | Luồng mạch lạc | Nhiều việc hơn | Gộp vào phương án chọn |
| C | **Redesign toàn bộ shadcn/ui** | Nhất quán cao nhất, token hoá triệt để | Lift lớn, rủi ro regression | **CHỌN** |

File project: **toàn bộ project (.mtvproj zip)** thắng "chỉ storyboard" vì một file mở lại ở bất kỳ stage, đồng bộ với `bundle.ts` đã ôm audio/bgm.

## 5. Giải pháp chốt

### A. Design system (shadcn/ui trên Tailwind v4)
- Init shadcn (đường v4), thêm `clsx`/`tailwind-merge`/`cva`/`lucide-react` (+ `tw-animate-css`).
- Mở rộng token: shadcn chuẩn (primary/secondary/muted/accent/destructive/border/input/ring/card/radius) + custom `--ai` (violet) + `--success` (emerald).
- Chuyển dark mode sang class-based, thêm toggle.
- Component: Button (variant `ai`), Card, Input, Textarea, Slider, Select, Switch, Tabs, Progress, Badge, Dialog, DropdownMenu, Tooltip, **Sonner (toast)** thay banner lỗi inline. `lucide-react` thay SVG tự chế.

### B. App shell (vào `layout.tsx`)
- **Top bar cố định:** tên app · trạng thái project (tên/jobId + chấm "chưa lưu") · **Lưu project · Mở project · toggle theme**.
- **Stepper 4 bước:** `Trích xuất → Storyboard → Kịch bản → Video`; ✓ bước xong, khoá bước tương lai theo state (Video khoá tới khi script confirmed), click bước xong để nhảy.
- Container + page-header chuẩn hoá cho cả 4 trang.

### C. Bốn stage
- **① Trích xuất:** dropzone Card; lưới band hover-xoá; bảng kết quả shadcn Table. Bỏ `<details>` "Nạp lại" → **"Mở project"** trên top bar (1 file `.mtvproj`).
- **② Storyboard:** region → **kéo khung chọn vùng trực quan** (numeric là "nâng cao" thu gọn); bố cục **master–detail 2 cột** (list nhịp gọn ↔ chi tiết nhịp + crop lớn); tách Kịch bản ra.
- **③ Kịch bản:** route `/script/[jobId]`, giữ gộp/tách/reorder/cảnh báo band sót, reskin.
- **④ Video:** giữ nguyên logic player/Ken Burns/timeline; chỉ thay control bằng shadcn trong Card + bọc shell.

### D. `.mtvproj` (zip, tái dùng `lib/bundle.ts`)
```
project.json          # version, jobId, createdAt, sourceKind, stage có mặt
manifest.json         # (tuỳ) content Stage 1
storyboard.json       # beats
script.json           # (tuỳ) ScriptSegment[] + confirmed
render-config.json    # (tuỳ)
working/band-<i>.jpg  # ảnh working → mở lại KHÔNG re-ingest, khớp toạ độ 100%
audio/seg-<id>.mp3    # (tuỳ)
bgm/<file>            # (tuỳ)
```
- `GET /api/project/export` (stream zip) + `POST /api/project/import` (giải nén → hydrate store → jobId). Không phụ thuộc env → diệt gốc lỗi region.
- `assertSafeName` cho mọi path; versioned.
- Phân vai: `.mtvproj` = lưu/mở phiên (thay export/import storyboard JSON); `bundle.zip` giữ nguyên = hand-off render CLI.

## 6. Rủi ro & giảm thiểu

- **Regression khi reskin toàn bộ** → chia phase, giữ nguyên logic, không xoá route/endpoint cũ tới khi bản mới chạy.
- **Radix trên React 19** → verify từng primitive khi thêm (đa số đã ổn).
- **Migrate token + dark mode** → làm 1 lần ở phase nền, kiểm cả light/dark.
- **`.mtvproj` phình dung lượng** (ôm ảnh + audio) → chấp nhận (tool nội bộ); audio/bgm là tuỳ chọn.
- **Đồng bộ bất biến Stage 2** (audio là nhạc trưởng) → import phải giữ nguyên `SegmentAudio.text` để logic loại audio cũ vẫn đúng.

## 7. Tiêu chí thành công

- 4 trang dùng chung shell + stepper + token; không còn `max-w` / màu nút gõ tay lệch.
- Mở lại project chỉ bằng 1 file `.mtvproj`, không cần chọn ảnh rời, không lỗi env.
- Storyboard: chọn vùng bằng kéo-thả; bố cục 2 cột; Kịch bản ở route riêng.
- Video: hành vi không đổi (player/timeline/export bundle như cũ).
- `npm run test:unit` + verify scripts hiện có vẫn pass; thêm verify cho `.mtvproj` export/import.

## 8. Phase đề xuất (cho /ck:plan)

1. **Nền:** shadcn init + token + shell + stepper + toast (đồng bộ ~80%).
2. **Reskin 4 stage** bằng component mới (Video chỉ đổi control).
3. **`.mtvproj`**: `lib/project.ts` + 2 endpoint + gộp Lưu/Mở, thay export/import storyboard JSON; verify script.
4. **Storyboard master–detail + crop trực quan**; tách route `/script`.

## 9. Phụ thuộc

- shadcn/ui (Tailwind v4 path), Radix primitives, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css`.
- Tái dùng: `lib/bundle.ts`, `lib/storyboard-store.ts`, `lib/schema.ts` (thêm `PROJECT_VERSION`).
