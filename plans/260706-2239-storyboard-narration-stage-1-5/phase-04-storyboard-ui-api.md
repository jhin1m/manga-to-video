---
phase: 4
title: "Storyboard UI & API"
status: completed
priority: P1
dependencies: [1, 3]
---

# Phase 4: Storyboard UI & API

## Overview

API + UI cho stage Storyboard: tạo storyboard từ session (hoặc nạp lại từ manifest+ảnh), xem/sửa từng Beat
(narration, vùng band), gộp/tách/đổi thứ tự nhịp, theo dõi tiến độ compose. Đây là nơi người vận hành chốt kịch bản.

## Requirements

- Functional: route tạo/đọc/sửa storyboard + beat; điều chỉnh `region` (kéo/handle hoặc nhập y-range); split/merge/reorder beat; SSE tiến độ compose; đường nạp lại (upload manifest JSON + ảnh).
- Non-functional: mẫu route Node runtime + SSE + poll fallback như Stage 1; UI 1 trang, tiếng Việt; ảnh từ store in-memory (`<img>` thẳng, không next/image — như Stage 1).

## Architecture

**API** (nested dưới job — KISS), `app/api/jobs/[id]/storyboard/...`:

| Method | Route | Chức năng |
|--------|-------|-----------|
| POST | `/api/jobs/{id}/storyboard` | tạo storyboard từ job session (chạy Phase 2+3 nền) → trả state |
| GET | `/api/jobs/{id}/storyboard` | state + beats |
| GET | `/api/jobs/{id}/storyboard/stream` | SSE tiến độ compose (snapshot khi nối, tự đóng) |
| PATCH | `/api/jobs/{id}/storyboard/beats/{beatId}` | sửa `{narration?, region?, order?}` |
| POST | `/api/jobs/{id}/storyboard/beats/{beatId}/retry` | chạy lại compose 1 beat |
| POST | `/api/jobs/{id}/storyboard/beats/split` \| `/merge` \| `/reorder` | thao tác nhịp |
| GET | `/api/jobs/{id}/storyboard/beats/{beatId}/crop` | ảnh crop theo `region` (preview) |
| POST | `/api/storyboard/import` | nạp lại: manifest JSON + ảnh → job mới + storyboard |

**UI** — thêm view "Storyboard" (mở rộng `app/page.tsx` sau bảng trích xuất, hoặc route `app/storyboard/[jobId]/page.tsx`).
<!-- Updated: Validation Session 1 - nút "Tạo storyboard" chạy stitch+smart-split (strip) rồi 2A + template narration; không có bước LLM -->

Mỗi Beat: preview crop (region trên working image/canvas) | textarea `narration` sửa được (đã pre-fill template) |
control chỉnh band (kéo mép trên canvas cao, hoặc nhập số y1/y2) | nút split/merge/▲▼/retry. Header: chọn `sourceKind`
(override pages⇄strip), nút "Tạo storyboard" (chạy Phase 2 stitch+smart-split rồi Phase 3 2A+template), "Export".
Overlay band trên canvas dải dọc để chỉnh trực quan. **Không có nút gọi LLM ở v1.**

## Related Code Files

- Create: `content-extractor/app/api/jobs/[id]/storyboard/route.ts` (+ subroutes: `stream`, `beats/[beatId]`, `beats/[beatId]/retry`, `beats/[beatId]/crop`, `beats/split|merge|reorder`).
- Create: `content-extractor/app/api/storyboard/import/route.ts` — nạp lại từ manifest+ảnh.
- Modify/Create: UI — `app/page.tsx` (thêm view) hoặc `app/storyboard/[jobId]/page.tsx`.
- Modify: `lib/storyboard-store.ts` — cài logic split/merge/reorder (stub từ Phase 1).
- Reference: `app/page.tsx` (mẫu SSE + poll fallback + edit inline), `app/api/jobs/[id]/**` (mẫu route + async params).

## Implementation Steps

1. Route POST tạo storyboard: chạy banding (Phase 2) + buildBeats (Phase 3) nền, phát bus; GET đọc state; SSE stream (guard enqueue + tự đóng như Stage 1 M2 fix).
2. PATCH beat: validate `narration`/`region` (region trong biên ảnh); cập nhật `durationHint` khi narration đổi.
3. split/merge/reorder trong store: giữ `order` liền mạch; split cắt đôi region theo y; merge nối region + narration.
4. Route crop preview: `sharp.extract(region)` từ buffer source → JPEG (mẫu route thumbnail Stage 1).
5. UI view: danh sách beat, sửa inline, chỉnh band (handle kéo trên ảnh cao + input số), poll fallback 2s.
6. Import: nhận manifest JSON + ảnh → dựng job + storyboard (cấp buffer riêng vào store).

## Success Criteria

- [x] Từ session Stage 1 bấm "Soạn narration" → ra storyboard, tiến độ SSE chạy, poll fallback khi đứt.
- [x] Sửa `narration` và `region`, Lưu → PATCH cập nhật, `durationHint` đổi theo.
- [x] Split/merge/reorder giữ thứ tự đúng, region hợp lệ.
- [x] Crop preview khớp band đang chọn.
- [x] Import manifest+ảnh (session mới) → dựng lại storyboard chạy được.

## Risk Assessment

- **Kéo handle trên ảnh 12000px** → hiển thị ảnh scale + map toạ độ về pixel gốc; hoặc dùng input số y1/y2 làm phương án chắc.
- **SSE đứt giữa compose dài** → poll fallback (mẫu Stage 1 M3).
- **Import không kèm đủ ảnh** → validate `sourceIndex` ↔ ảnh; báo lỗi rõ tiếng Việt, không dựng storyboard nửa vời.
