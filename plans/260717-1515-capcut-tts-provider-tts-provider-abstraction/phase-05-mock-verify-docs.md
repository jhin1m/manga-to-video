---
phase: 5
title: "Mock, verify và docs"
status: done
priority: P2
effort: "3h"
dependencies: [3, 4]
---

# Phase 5: Mock, verify và docs

## Overview
Mock server CapCut cho test offline, bổ sung case verify, cập nhật `.env.example`/README. Chốt chất lượng toàn feature.

## Requirements
- Functional: `scripts/mock-capcut.mjs` mô phỏng đủ flow new → query (queueing 1 nhịp rồi done) → audio, khớp shape JSON thật từ Phase 1.
- Non-functional: verify chạy offline hoàn toàn (CI-safe); tài liệu ENV đầy đủ văn phong tiếng Việt như file hiện có.

## Architecture
- `scripts/mock-capcut.mjs` theo mẫu `scripts/mock-elevenlabs.mjs`: HTTP server thuần node, port truyền qua argv/env. Trả JSON đúng shape capture Phase 1; audio trả mp3 tối thiểu hợp lệ (tái dùng cách mock-elevenlabs sinh mp3 để ffprobe đo được duration).
- `scripts/verify-script.mts` thêm nhóm case capcut (chạy với `CAPCUT_BASE_URL=http://127.0.0.1:<port>`):
  1. synth qua mock → có mp3, duration > 0
  2. lần 2 cùng text → `cached: true`, mock không nhận thêm request
  3. cache key capcut ≠ key elevenlabs cùng text/voice/model (prefix provider)
  4. text rỗng → không synth, duration 0 (hành vi chung giữ nguyên)
  5. task fail / query timeout → error message chứa gợi ý `TTS_PROVIDER=elevenlabs`

## Related Code Files
- Create: `content-extractor/scripts/mock-capcut.mjs`
- Modify: `content-extractor/scripts/verify-script.mts`, `content-extractor/.env.example` (rà lại block TTS tổng thể), `content-extractor/README.md` (mục TTS: 2 provider, cách chọn, cảnh báo CapCut unofficial)

## Implementation Steps
1. Viết mock (new/query/audio + chế độ lỗi bật qua header hoặc path riêng cho case 5).
2. Thêm case verify; giữ các case ElevenLabs nguyên vẹn.
3. Cập nhật `.env.example` + README (ghi rõ: CapCut là API unofficial, có thể ngừng hoạt động, ElevenLabs là đường lùi).
4. Chạy full gate: `nvm use 24 && pnpm lint && pnpm build && pnpm verify-script`; chạy e2e regression — LƯU Ý known-issue `parseScriptJSON HTTP 502` có từ trước 2026-07-09, không phải hồi quy của feature này.
5. Cân nhắc cập nhật `docs/` (system-architecture nếu có mục TTS) — chỉ khi tài liệu hiện có nhắc tới ElevenLabs như provider duy nhất.

## Success Criteria
- [ ] verify-script pass offline (cả nhóm elevenlabs cũ + capcut mới)
- [ ] lint + build pass
- [ ] e2e không hồi quy mới (ngoài known-issue 502 đã ghi nhận)
- [ ] `.env.example` + README mô tả đủ TTS_PROVIDER/CAPCUT_*, kèm cảnh báo unofficial

## Risk Assessment
- Mock lệch shape thật → mock viết SAU khi có capture Phase 1, copy nguyên mẫu JSON vào mock làm fixture.
- e2e chạy `next start :3105` với env mock (xem memory next16-e2e) — thêm `CAPCUT_BASE_URL` vào bộ env mock của script e2e nếu script đó synth capcut.
