---
phase: 1
title: "Schema & Store"
status: completed
priority: P1
dependencies: []
---

# Phase 1: Schema & Store

<!-- Updated: Validation Session 1 - region-only manifest; sourceIndex trỏ "working image" (canvas stitch cho strip / trang cho manga) -->

## Overview

Định nghĩa hợp đồng dữ liệu Stage 1.5 (`Beat`, `StoryboardManifest`) và store in-memory cho storyboard,
gắn vào một `jobId` sẵn có (session) hoặc bootstrap từ manifest nạp lại. Nền cho mọi phase sau.

**Lưu ý toạ độ:** `Beat.sourceIndex` trỏ **working image** *sau* ingest/stitch (Phase 2) — với strip là **canvas
đã gộp**, với manga là **trang**. `Beat.region` là bbox trên working image đó. Manifest **region-only** (không field pan/zoom).

## Requirements

- Functional: kiểu `Beat`, `BeatRegion`, `StoryboardManifest`, `StoryboardState`; helper `emptyBeat()`, `toStoryboardManifest()`; store CRUD beats theo jobId; phân loại nguồn `sourceKind: 'pages' | 'strip'`.
- Non-functional: `lib/schema.ts` KHÔNG import kiểu Node (Buffer nằm ở lib store) — giữ nguyên ràng buộc Stage 1. Versioned (`STORYBOARD_VERSION = 1`).

## Architecture

Kế thừa mẫu Stage 1: DTO không chứa buffer, buffer sống ở store. Storyboard treo trên Job hiện có
(cùng session, tái dùng buffer đã downscale) hoặc một `StoryboardState` độc lập khi nạp lại từ manifest.

```ts
// lib/schema.ts (thêm)
export interface BeatRegion { x: number; y: number; w: number; h: number } // px trên ảnh source
export interface Beat {
  id: string;
  order: number;
  sourceIndex: number;              // trỏ item/trang gốc
  region: BeatRegion | null;        // null = cả trang
  narration: string;                // lời đọc cuối
  sourceDialogue?: string[];        // truy vết
  durationHint?: number;            // giây, ước lượng từ độ dài narration
}
export type SourceKind = 'pages' | 'strip';
export interface StoryboardManifest {
  version: number; jobId: string; createdAt: string;
  sourceKind: SourceKind; beatCount: number; beats: Beat[];
}
export const STORYBOARD_VERSION = 1;
export function toStoryboardManifest(s: {
  jobId: string; createdAt: string; sourceKind: SourceKind; beats: Beat[];
}): StoryboardManifest { /* map thuần, giống toManifest() */ }
```

Store (`lib/jobs.ts` hoặc `lib/storyboard-store.ts`): `Map<jobId, StoryboardState>` trên `globalThis`
(sống HMR như Stage 1). `StoryboardState` giữ `beats: Beat[]`, `sourceKind`, và tham chiếu buffer ảnh
source (tái dùng buffer Job cùng session; giữ buffer riêng khi nạp lại). Event bus tiến độ dùng lại
mẫu bus Stage 1 cho bước compose (Phase 3).

## Related Code Files

- Modify: `content-extractor/lib/schema.ts` — thêm Beat/Region/StoryboardManifest + helpers.
- Modify/Create: `content-extractor/lib/jobs.ts` (thêm storyboard state) **hoặc** `content-extractor/lib/storyboard-store.ts` (Map riêng + bus). KISS: ưu tiên file riêng để không phình jobs.ts.
- Reference: `content-extractor/lib/schema.ts` (mẫu `toManifest`, `emptyContent`), `lib/jobs.ts` (mẫu globalThis Map + bus).

## Implementation Steps

1. Thêm kiểu + hằng + helper vào `lib/schema.ts` (thuần TS, không Buffer).
2. `durationHint`: hàm ước lượng `estimateSeconds(narration)` — vd `ceil(chars / 15)` (TTS tiếng Việt ~15 ký tự/giây), tinh chỉnh sau. Đặt cạnh helper schema (thuần).
3. Tạo `lib/storyboard-store.ts`: Map trên globalThis, API `createStoryboard(jobId, sourceKind, beats)`, `getStoryboard(jobId)`, `updateBeat(jobId, beatId, patch)`, `reorder/split/merge` (stub ký hiệu, logic ở Phase 4), `setBeats`. Bus tiến độ compose.
4. Định nghĩa nguồn buffer source: interface tối thiểu để store lấy buffer theo `sourceIndex` (tái dùng Job buffer khi cùng session; slot buffer riêng khi nạp lại).

## Success Criteria

- [x] `tsc --noEmit` sạch; `lib/schema.ts` không import kiểu Node.
- [x] Tạo được `StoryboardState` cho một jobId, thêm/sửa Beat, đọc lại đúng.
- [x] `toStoryboardManifest()` cho ra shape versioned đúng.
- [x] Store sống qua HMR (globalThis singleton).

## Risk Assessment

- Trộn state Job (Stage 1) và Storyboard dễ rối vòng đời buffer → tách `storyboard-store.ts`, chỉ **tham chiếu** buffer Job, không copy. Nạp lại thì cấp buffer riêng.
