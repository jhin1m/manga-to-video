---
phase: 1
title: "Foundation & Shell"
status: completed
priority: P1
effort: ""
dependencies: []
---

# Phase 1: Foundation & Shell

## Overview

Dựng nền design system shadcn/ui trên Tailwind v4 + React 19, và thêm **app shell** (top bar + stepper 4 bước + container chuẩn) vào `app/layout.tsx` (đang rỗng). Riêng phase này đã đồng bộ ~80% cảm giác "nhất quán" mà chưa đụng logic từng stage.

## Requirements

- Functional: mọi trang (`/`, `/storyboard/[jobId]`, `/script/[jobId]`, `/video/[jobId]`) render trong cùng shell: top bar (tên app · trạng thái project · nút Lưu/Mở project · toggle theme) + stepper hiển thị bước hiện tại, bước đã xong (✓), bước tương lai bị khoá theo state. Toast (Sonner) là mặt lỗi/thông báo chung.
- Non-functional: không regression hành vi hiện có; light + dark đều đúng; không horizontal scroll; giữ AGENTS.md (đọc `node_modules/next/dist/docs/` trước khi viết code Next).

## Architecture

- **shadcn/ui trên Tailwind v4:** dùng đường cài cho Tailwind v4 (CSS-first, không tạo `tailwind.config.js`). Thêm deps: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css` (thay `tailwindcss-animate` cho v4), Radix primitives theo từng component. Tạo `components.json`, `lib/utils.ts` (`cn()`).
- **Token migration trong `app/globals.css`:** mở rộng `:root` từ `--background/--foreground` hiện tại thành bộ token shadcn đầy đủ (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, radius) + custom `--ai` (violet) + `--success` (emerald). Khai báo qua `@theme inline` (cú pháp v4). Chuyển dark mode từ `@media (prefers-color-scheme)` sang **class-based** (`.dark`) để nút toggle điều khiển; giữ 1 lần đọc `prefers-color-scheme` làm mặc định ban đầu.
- **App shell (client component `components/app-shell.tsx`)** bọc `{children}` trong layout:
  - Top bar: trái = tên app; giữa = trạng thái project (tên/jobId + chấm "● chưa lưu" khi dirty — dirty state để phase 2 nối); phải = Button "Lưu project" / "Mở project" (stub handler ở phase này, phase 2 nối endpoint) + toggle theme.
  - **Stepper** `components/stage-stepper.tsx`: 4 bước `Trích xuất · Storyboard · Kịch bản · Video`. Bước hiện tại suy từ `usePathname()`; jobId parse từ path. Gating: Storyboard mở khi có jobId; Kịch bản mở khi storyboard done + beats>0; Video mở khi script confirmed. Đọc gating qua 1 context provider `components/project-context.tsx` — pages publish readiness (đã có storyboard? script confirmed?) để stepper khoá/mở + click nhảy bước.
- **Container chuẩn:** component `components/page-shell.tsx` (hoặc class dùng chung): 1 `max-w` (chọn `max-w-6xl`), 1 padding, 1 mẫu page-header (title + subtitle + slot nút chính). Các trang phase 3/4 sẽ thay `<main className="mx-auto ...">` cục bộ bằng cái này.
- **Theme provider:** client component quản lý `.dark` class trên `<html>` + lưu localStorage; SSR-safe (tránh flash: script inline set class trước hydrate).

## Related Code Files

- Create: `components/app-shell.tsx`, `components/stage-stepper.tsx`, `components/project-context.tsx`, `components/theme-toggle.tsx`, `components/page-shell.tsx`, `lib/utils.ts`, `components.json`, và `components/ui/*` (button, card, input, textarea, slider, select, switch, tabs, progress, badge, dialog, dropdown-menu, tooltip, sonner, separator).
- Modify: `app/layout.tsx` (server → bọc shell + theme provider + `<Toaster/>`; giữ `lang="vi"`), `app/globals.css` (token + dark class), `package.json` (deps).
- Delete: none.

## Implementation Steps

1. Đọc `node_modules/next/dist/docs/` phần liên quan (App Router/layout/metadata) theo cảnh báo AGENTS.md.
2. `npx shadcn@latest init` theo đường Tailwind v4; xác nhận `components.json` + `lib/utils.ts`. Nếu init đòi `tailwind.config`, dùng chế độ v4 (CSS `@theme`). Thêm deps còn thiếu.
3. Viết token trong `globals.css` (`@theme inline` + `:root` + `.dark`), map `--ai`/`--success`. Kiểm cả 2 theme.
4. `npx shadcn@latest add button card input textarea slider select switch tabs progress badge dialog dropdown-menu tooltip sonner separator`. Verify build với React 19 (không lỗi peer/Radix).
5. Thêm variant `ai` cho Button (CVA) map token `--ai`; giữ `default`(primary)/`secondary`/`outline`/`ghost`/`destructive`.
6. Viết `theme-toggle.tsx` + theme provider + script chống-flash trong layout.
7. Viết `project-context.tsx` (readiness: `{ jobId, hasStoryboard, storyboardDone, scriptConfirmed, dirty, setX }`), `stage-stepper.tsx` (gating + nav), `app-shell.tsx` (top bar + stepper + `<main>` container), `page-shell.tsx`.
8. Sửa `app/layout.tsx`: bọc `AppShell` + `ThemeProvider` + `Toaster`. Không đổi 3 trang hiện có ở phase này (chúng vẫn render trong shell; reskin ở phase 3/4).
9. Chạy `npm run build` + `npm run lint`; mở thủ công 3 route hiện có xác nhận không vỡ layout.

## Success Criteria

- [x] `components.json` + `components/ui/*` tồn tại; `npm run build` xanh với React 19.
- [x] `layout.tsx` render top bar + stepper cố định trên cả 4 route; stepper khoá/mở đúng theo readiness.
- [x] Toggle theme đổi light/dark tức thì, không flash khi reload.
- [x] Toast (Sonner) sẵn sàng dùng chung.
- [x] 3 trang cũ vẫn hoạt động (chưa reskin) bên trong shell.

## Risk Assessment

- shadcn init trên Tailwind v4 + Next 16 có thể lệch generator → nếu init tự tạo `tailwind.config`, chỉnh về v4 CSS-first thủ công.
- Radix + React 19 peer warning → verify từng component ở bước 4; nếu 1 primitive lỗi, thay bằng bản Radix mới nhất.
- Gating stepper cần dữ liệu readiness → nếu context chưa nối kịp (phase 3/4), mặc định khoá an toàn (chỉ mở bước có bằng chứng dữ liệu).
