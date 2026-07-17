---
title: "CapCut TTS Provider + TTS Provider Abstraction"
description: "Thêm CapCut TTS (free, unofficial) làm provider thứ 2 bên cạnh ElevenLabs; tách lib/tts.ts thành provider abstraction mở rộng được; chọn provider per-project trong UI"
status: done
priority: P1
effort: "2d"
tags: [tts, capcut, provider-abstraction]
created: 2026-07-17
blockedBy: []
blocks: []
---

# CapCut TTS Provider + TTS Provider Abstraction

## Overview

TTS hiện hard-code ElevenLabs (trả phí theo ký tự) trong `content-extractor/lib/tts.ts`. Thêm CapCut TTS (port TypeScript từ Python client [K07VN/capcut-tts-api](https://github.com/K07VN/capcut-tts-api) — API nội bộ reverse-engineered, free, có giọng Việt) qua provider abstraction; chọn provider per-project bằng dropdown UI, lưu vào `.mtvproj`.

**Thiết kế đã chốt:** `docs/brainstorms/2026-07-17-capcut-tts-provider.md` (đọc TRƯỚC khi cook — chứa quyết định + lý do).

Quyết định khóa (không tự đảo ngược): port TS thuần `node:crypto` (không Python runtime); KHÔNG auto-fallback khi CapCut lỗi; cache key ElevenLabs giữ nguyên (backward-compat, không đốt lại phí); scope chỉ TTS (STT để sau); `.mtvproj` cũ không cần migration.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Synth giọng Việt qua CapCut, free, cache HIT không gọi lại API | P1 |
| 2 | Provider abstraction — thêm provider tương lai = 1 file | P1 |
| 3 | Chọn provider per-project trong UI, lưu `.mtvproj`, file cũ vẫn mở được | P2 |
| 4 | Hành vi + cache ElevenLabs không đổi 100% sau refactor | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Capture CapCut Response](./phase-01-capture-capcut-response.md) | Done |
| 2 | [Provider Abstraction Refactor](./phase-02-provider-abstraction-refactor.md) | Done |
| 3 | [CapCut Provider](./phase-03-capcut-provider.md) — cần 1, 2 | Done |
| 4 | [Schema và UI chọn provider](./phase-04-schema-ui-chon-provider.md) — cần 2, song song được với 3 | Done |
| 5 | [Mock, verify và docs](./phase-05-mock-verify-docs.md) — cần 3, 4 | Done |

**Gate cứng:** Phase 1 phát hiện API chết → DỪNG plan, báo user (không port vô ích). → API **CÒN SỐNG**, đã tiếp tục.

## Kết quả thực thi (2026-07-17)

- Toàn bộ 5 phase hoàn tất. Gate offline pass: `pnpm lint` + `pnpm build` + `pnpm test:unit` (189 assert, gồm Test 9 CapCut mới) + e2e-video (`E2E_SCRIPT_VIDEO_ALL_PASS`, không hồi quy).
- Verify thực tế: CapCut synth ra mp3 tiếng Việt qua API thật (2.5s), cache HIT lần 2 không gọi mạng, lỗi kèm gợi ý đổi provider không lộ token. Cache key ElevenLabs y hệt công thức cũ.
- **Lệch plan cần biết:** lệnh verify thật là `pnpm test:script` / `pnpm test:unit` (KHÔNG phải `pnpm verify-script`).
- **Quyết định phạm vi (user chốt "giữ nguyên"):** `.mtvproj` (`ProjectFile`/`ProjectData`) KHÔNG lưu `renderConfig` — `tts.voiceId/model` cũ cũng vậy. Provider là state trang video, persist vào `bundle.zip` (`render-config.json`) lúc Export → CLI render honor đúng. Bỏ tiêu chí "lưu/khôi phục provider qua `.mtvproj`" (chưa từng có cho renderConfig); KHÔNG đổi format `.mtvproj`. Bundle cũ thiếu `provider` → fallback elevenlabs.
- Catalog: 8 giọng Việt verify được (2 giọng `*Neural` bị API từ chối, đã loại). Provider timing (poll interval/total timeout) đọc thêm từ `CAPCUT_POLL_INTERVAL_MS`/`CAPCUT_TIMEOUT_MS` để mock/test chạy nhanh offline.

## Success Criteria

- [x] Chọn CapCut trong UI → preview + CLI render ra mp3 tiếng Việt nghe được; lần 2 cache HIT không request mạng
- [x] `TTS_PROVIDER` rỗng/elevenlabs → verify-script (`test:script`) pass, cache key y hệt trước refactor
- [x] Bundle cũ (không có `tts.provider`) mở + render bình thường (fallback elevenlabs). *(`.mtvproj` không lưu renderConfig — xem quyết định phạm vi ở trên)*
- [x] CapCut lỗi → message tiếng Việt rõ + gợi ý `TTS_PROVIDER=elevenlabs`, không silent fallback
- [x] Full gate offline: `pnpm lint && pnpm build && pnpm test:unit` pass (nhớ `nvm use 24`)

## Môi trường (từ memory dự án)

- Node 24 qua Herd nvm: `nvm use 24` trước mọi lệnh build/verify.
- e2e: known-issue `parseScriptJSON HTTP 502` có trước 2026-07-09 — không phải hồi quy.
- pnpm 11: build scripts approve qua `allowBuilds` trong pnpm-workspace.yaml.

<!-- slug: capcut-tts-provider-tts-provider-abstraction -->
