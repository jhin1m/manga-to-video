# Content Extractor Stage 1: Greenfield Build Hoàn Thành — E2E Verify via Mock API

**Date**: 2026-07-06 14:05–20:30+
**Severity**: Medium (MVP sẵn sàng, chờ onboarding API key thật)
**Component**: Manga→Video pipeline: Content Extractor (internal tool)
**Status**: Completed (code), Blocked on API integration (feature gates)

## Sự Kiện Chính

Xây dựng Stage 1 từ zero (greenfield) trong một phiên: Next.js 16.2.10 + TypeScript + Tailwind v4 + vision LLM client. Hoàn thành 5 phases (scaffold, core lib, API routes, UI, verify) và đạt tất cả acceptance gates qua E2E mock.

- **Build output**: `./content-extractor/` (Node 24, 24 tệp/.ts(x), ~8KB minified)
- **E2E cover**: Upload sắp xếp natural order (1,2,10 ✓) · error isolation + retry (401 giữa job ✓) · SSE live + snapshot ✓ · PATCH merge ✓ · export manifest + zip filter (`__MACOSX`, `.DS_Store`, `._*`) ✓ · adaptive json-mode fallback ✓
- **Gates**: `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · `npm run dev` (dev server boot) ✓

## Sự Thực Khó Khăn

Ba quyết định bị buộc bởi môi trường/design:

1. **Node 24 via Herd nvm**: Fresh shell mặc định Node 22 (Herd hardcode trong login profile) → mỗi build/test phải `nvm use 24` trước. `.nvmrc = 24` đã pin, nhưng không tự động đọc. Phải viết helper `use-node24.sh` (scratchpad) để wrap mọi lệnh Node.

2. **Font Geist không support tiếng Việt**: Scaffold mặc định dùng `next/font` + Geist từ Vercel CDN. Google Fonts không có Geist + Vietnamese subset tổng hợp → bỏ custom font, dùng system stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`). UI tiếng Việt 100%, glyph cover tới bây giờ phụ thuộc OS.

3. **create-next-app tạo git repo lồng**: `--yes` flag tự gọi `git init` bên trong thư mục app → phải gỡ để git root nằm ở `manga-to-video/`. Kết quả: một lệnh `rm -rf .git` trong `content-extractor/`. 

## Chi Tiết Kỹ Thuật

**Lỗi/Khó khăn trong implement:**

- **M1 (.gitignore)**: Scaffold tạo `.gitignore` dạng mặc định, nuốt luôn `.env.example` (yêu cầu docs chỉ → keep template env). Fix: thêm `!.env.example`.

- **M2 (SSE listener race)**: `controller.enqueue()` trong SSE handler không guard. Listener chạy đồng bộ từ `bus.emit()` trong pipeline → nếu stream bị close hay error, lỗi lan đồng bộ qua tất cả callback. Cô lập lỗi per-item bị phá. Fix: wrap `enqueue` với try/catch, gọi `controller.close()` khi error.

- **M3 (SSE timeout UI)**: SSE dứt giữa job dài → progress UI đóng băng. Fix: client poll `/items?includeError=true` mỗi 2s đến khi job done/failed.

**Verify E2E (mock server):**
Mock OpenAI-compatible endpoint (scratchpad, `:7777`) đơn giản: return Vietnamese content chuẩn, reject requests thiếu header. Concurrency test: inject 400 cho call 1–3 (json_mode), call 4–6 retry không json_mode thành công. Token log: ghi mỗi call (prompt + completion tokens). Cô lập lỗi: inject 401 khi item 2 → item 2 fail, 1+3 thành công, retry endpoint phục hồi item 2.

## Lý Do Sâu Hơn (Root Cause)

- **Node 24 hardcoding**: Herd (package manager Mac) quản lý nvm profile — không phải NVM gốc lưu trong `~/.nvm/`. Phải allowlist `~/Library/Application Support/Herd/config/nvm`.
- **Font issue**: Geist là proprietary Vercel font, Google Fonts chỉ host Geist Mono + Geist Sans (không subset VN). Next.js `next/font` wrapper chỉ optimize sau download — không merge subset riêng.
- **SSE race**: Node.js SSE route handler đồng bộ emit listener → không có backpressure check trước `enqueue`. Cần explicit error boundary.

## Bài Học

1. **Scout dependency version** trước build (Next 16 vs plan 15 — ảnh hưởng API async `params`; dù unchanged logic).
2. **System-level tool constraints** (Herd, nvm, font) phải encode thành workflow docs/helper script, không tính vào estimate task.
3. **SSE error boundary** là bắt buộc khi listener chạy đồng bộ. Thêm try/catch, close lập tức, không dựa vào client disconnect.
4. **Natural sort requirement** rất cứng — encode `localeCompare({numeric:true})` sớm; không phải lúc sau kiểm chứng.

## Tiếp Theo

- **Onboarding API thật** (cần Z.AI GLM key hoặc OpenAI key): switch ENV, verify nội dung Việt từ model thật, network-kill scenario.
- **Commit** (chờ user yêu cầu): 5 phase changes + 3 Medium fixes đã sẵn sàng.
- **TTS/video stage**: Dùng manifest export từ tool này làm input.

---

**Status**: DONE
**Summary**: Build Stage 1 (5 phases) xong: Next 16 + TS + Tailwind v4 + vision client, E2E via mock (ordering, error isolation, retry, SSE, export); 3 Medium fixes (gitignore, SSE guard, progress poll); chờ onboarding API key thật.
