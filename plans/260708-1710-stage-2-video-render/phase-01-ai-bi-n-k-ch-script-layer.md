---
phase: 1
title: "AI Biên kịch (script layer)"
status: completed
priority: P1
dependencies: []
effort: ""
---

# Phase 1: AI Biên kịch (script layer)

## Overview

Thêm tầng biên kịch: model text (`SCRIPT_MODEL`) đọc content đã trích của mọi band → viết kịch bản kể mạch lạc cả chương, **gộp/tách panel** thành `ScriptSegment[]` (1 narration → 1+ shot, tham chiếu **index band**, không pixel). Đây là hợp đồng mới `ScriptManifest`, nền cho các phase sau.

## Requirements

- **Functional:** gom content các band theo `order` → gọi `SCRIPT_MODEL` → trả `ScriptSegment[]` với `narration` mạch lạc + `shots[]` (chỉ định band index đã gộp/tách). Lỗi cô lập, không sập.
- **Non-functional:** provider-agnostic qua ENV; retry 429/5xx (mẫu `vision.ts:withRetry`); parse JSON chịu ```json fences (mẫu `parseSceneJSON`); additive vào `schema.ts` (không sửa v1).

## Architecture

**Types mới trong `lib/schema.ts`** (additive, không import Node):
```ts
export interface Shot { sourceIndex: number; region: BeatRegion | null; weight: number; }
export interface ScriptSegment {
  id: string; order: number;
  narration: string;
  shots: Shot[];                 // gộp = nhiều shot; tách = nhiều segment cùng sourceIndex
  sourceBeatIds?: string[];      // truy vết beat gốc
  durationHint?: number;
  edited?: boolean;              // người dùng đã duyệt/sửa
}
export interface ScriptManifest {
  version: number; jobId: string; createdAt: string;
  segmentCount: number; segments: ScriptSegment[];
}
export const SCRIPT_VERSION = 1;
export function toScriptManifest(s): ScriptManifest { /* sort order, clone shots, ước durationHint */ }
```

**`lib/script.ts`** (mẫu cấu trúc `lib/vision.ts`):
- `readScriptConfig()`: `SCRIPT_MODEL` (mặc định model text mạnh), reuse `OPENAI_API_KEY`/`OPENAI_BASE_URL`, cho phép override `SCRIPT_API_KEY`/`SCRIPT_BASE_URL` (dùng provider khác vision). `SCRIPT_DISABLE_THINKING` như vision.
- `generateScript(beats: Array<{ order, sourceIndex, beatId, content: SceneContent | null }>): Promise<ScriptSegment[]>`:
  - Prompt tiếng Việt: "Bạn là biên kịch video recap. Dưới đây là nội dung từng khung theo thứ tự đọc (index). Viết lời kể MẠCH LẠC, xâu chuỗi, thoại lồng dạng trích. Được GỘP các khung liền kề vào một đoạn kể, hoặc TÁCH một khung dày thành nhiều đoạn. Trả JSON: `{segments:[{narration, shotIndices:[int...]}]}` — shotIndices là các index khung mà đoạn kể này phủ, theo thứ tự."
  - Input = danh sách `{index, description, dialogue}`.
  - **Vision fallback (Validation S1):** band content `null` (Stage 1 chưa chạy/lỗi) → `cropRegion(working, cả band)` → `describeImage` lấy mô tả trước khi biên kịch; lỗi cô lập (band hỏng → mô tả rỗng, không sập). Reuse `cropRegion` (narration.ts) + `describeImage` (vision.ts). Chạy `p-limit` + pacer như `composeStoryboard` để chặn 429.
  - Reuse `withRetry` + json-extraction: **export `withRetry` từ `vision.ts`** (hiện private) + tách helper `extractJson(raw)` dùng chung với `parseSceneJSON` (DRY, tránh dup).
  - Map `shotIndices` → `Shot[]` (`region: null`, `weight: 1`, `sourceIndex = index`); gán `sourceBeatIds` từ beatId theo index; `order` tăng dần.
  - Validate: mọi `shotIndices` phải trong biên; index bị bỏ sót → cảnh báo (không tự chèn, để UI báo count lệch).

**Store:** thêm `script?: ScriptSegment[]` + setters vào `lib/storyboard-store.ts` (`setScript`, `getScript`, `updateSegment`, `deleteSegment`, `mergeSegments`, `splitSegment`) — treo trên cùng jobId. In-memory, mẫu beats.

**Route:** `POST /api/jobs/[id]/storyboard/script` (`app/api/jobs/[id]/storyboard/script/route.ts`, `runtime='nodejs'`): đọc storyboard beats + content tươi từ `getJob(id).items[sourceIndex].content` (mẫu `composeBeat`) → `generateScript` → `setScript` → trả `ScriptManifest`. `409` nếu đang compose; `404` nếu chưa có storyboard.

## Related Code Files

- Modify: `content-extractor/lib/schema.ts` (thêm Shot/ScriptSegment/ScriptManifest/SCRIPT_VERSION/toScriptManifest — additive)
- Modify: `content-extractor/lib/vision.ts` (export `withRetry`, tách `extractJson` dùng chung)
- Modify: `content-extractor/lib/storyboard-store.ts` (thêm `script` + setters/mutators)
- Create: `content-extractor/lib/script.ts` (import `cropRegion` từ narration.ts, `describeImage` từ vision.ts cho vision fallback)
- Create: `content-extractor/app/api/jobs/[id]/storyboard/script/route.ts`
- Modify: `content-extractor/.env.example` (`SCRIPT_MODEL`, optional `SCRIPT_BASE_URL`/`SCRIPT_API_KEY`/`SCRIPT_DISABLE_THINKING`)

## Implementation Steps

1. Thêm types + `SCRIPT_VERSION` + `toScriptManifest` vào `schema.ts` (additive; không đụng Beat/StoryboardManifest).
2. Refactor DRY: export `withRetry` + `extractJson` từ `vision.ts`; `parseSceneJSON` dùng lại `extractJson`.
3. `lib/script.ts`: `readScriptConfig`, prompt biên kịch, `generateScript` (gọi OpenAI client text, map shotIndices→shots, validate biên).
4. `storyboard-store.ts`: thêm `script` state + mutators (set/get/update/merge/split/delete segment, re-order).
5. Route `POST .../storyboard/script` → generate + store + trả manifest.
6. `.env.example`: khai báo biến SCRIPT_*.

## Success Criteria

<!-- Updated: Validation Session 1 - vision fallback cho band thiếu content Stage 1 -->
- [x] Band content `null` → vision fallback (`describeImage`) điền mô tả trước khi biên kịch; band vision-lỗi → mô tả rỗng, không sập.
- [x] `generateScript` trả `ScriptSegment[]` từ mock model (JSON hợp lệ) — gộp/tách phản ánh đúng shotIndices.
- [x] shotIndices ngoài biên → loại + cảnh báo, không văng.
- [x] `toScriptManifest` xuất shape đúng, `SCRIPT_VERSION=1`, shots clone (không rò tham chiếu).
- [x] Route trả `ScriptManifest`; `409` khi đang compose, `404` khi chưa có storyboard.
- [x] `schema.ts` v1 (Beat/StoryboardManifest) không đổi — test Stage 1.5 cũ vẫn xanh.

## Risk Assessment

- **AI trả JSON sai/thiếu index** → `extractJson` + validate biên + cô lập lỗi; UI (P2) báo count lệch.
- **Dup logic với vision.ts** → giảm bằng export `withRetry`/`extractJson` dùng chung (DRY).
- **SCRIPT_MODEL khác endpoint vision** → cho override `SCRIPT_BASE_URL`/`SCRIPT_API_KEY`; mặc định dùng chung `OPENAI_*`.
