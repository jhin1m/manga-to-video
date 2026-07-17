---
phase: 4
title: "Schema và UI chọn provider"
status: done
priority: P2
effort: "3h"
dependencies: [2]
---

# Phase 4: Schema và UI chọn provider

## Overview
Cho phép chọn TTS provider per-project: thêm trường `provider` vào `renderConfig.tts` trong schema `.mtvproj` + dropdown ở trang video. Có thể làm song song Phase 3 (chỉ phụ thuộc khung Phase 2).

## Requirements
- Functional: dropdown provider ở trang video (`Theo ENV` / `ElevenLabs` / `CapCut`); chọn CapCut → ô voiceId thành dropdown catalog giọng Việt, ô model ẩn; lựa chọn lưu vào `.mtvproj`, mở lại giữ nguyên.
- Non-functional: file `.mtvproj` cũ (không có trường `provider`) mở và render bình thường — KHÔNG migration.

## Architecture
- `lib/schema.ts:250`: `tts: { provider: string; voiceId: string; model: string }` — default `provider: ''` (rỗng = lấy ENV `TTS_PROVIDER` lúc synth, cùng semantics với voiceId/model rỗng hiện tại). Parse file cũ: field thiếu → gán default (theo cơ chế merge default sẵn có của schema — kiểm tra lại cơ chế này khi implement).
- `app/video/[jobId]/page.tsx`:
  - Dropdown provider cạnh ô voiceId/model hiện tại (shadcn Select theo UI đã unified): options build từ registry (`getTtsProviders()` — thêm hàm liệt kê) + option đầu "Theo ENV".
  - `provider === 'capcut'` → voiceId render Select từ `provider.voices` (label tiếng Việt), ẩn ô model. Provider khác/rỗng → giữ 2 ô text như hiện tại.
  - Request body synth (`page.tsx:200`) thêm `provider` khi khác rỗng.
- Registry là module server-safe (không import node:crypto ở top-level types) — nếu import client gặp vấn đề, tách catalog voices sang const thuần data để page import.

## Related Code Files
- Modify: `content-extractor/lib/schema.ts`, `content-extractor/app/video/[jobId]/page.tsx`, `content-extractor/lib/tts-providers/index.ts` (hàm liệt kê provider cho UI)
- Kiểm tra (không sửa nếu Phase 2 đã xong): `app/api/jobs/[id]/storyboard/tts/route.ts`, `scripts/render-video.mts`

## Implementation Steps
1. Schema: thêm field + default; kiểm tra chỗ tạo default config (`lib/schema.ts:273`) và mọi chỗ đọc `config.tts`.
2. Kiểm tra import/export `.mtvproj` (lib/project.ts) không strip field mới.
3. UI dropdown + logic ẩn/hiện theo provider; giữ convention UI shadcn hiện có.
4. Truyền provider vào body API + CLI path.
5. Test tay: tạo project → chọn CapCut → save → reload → còn nguyên; mở `.mtvproj` cũ → hoạt động như trước.

## Success Criteria
- [ ] `.mtvproj` cũ mở + render không lỗi, provider hiển thị "Theo ENV"
- [ ] Chọn provider lưu/khôi phục đúng qua save/load project
- [ ] CapCut: voice dropdown hiện catalog, model ẩn; ElevenLabs: 2 ô text như cũ
- [ ] `pnpm lint` + `pnpm build` pass

## Risk Assessment
- Lint mới cấm setState-trong-effect (xem memory shadcn-cli4): viết state provider theo pattern đã dùng ở page video, không effect-sync.
- Import registry vào client component kéo theo node builtin → tách data catalog khỏi code synth nếu đụng lỗi bundle.
