---
title: "Render video in-app tại stage video"
description: "Bấm 1 nút ở /video/[jobId] render MP4 server-side (bỏ vòng export zip → CLI thủ công), stream progress NDJSON, tự tải file, có Cancel + lock."
status: completed
priority: P1
effort: "1-2d"
tags: [video, render, ffmpeg, ndjson, dry-refactor]
created: 2026-07-23
---

# Render video in-app tại stage video

## Overview

Hiện render MP4 phải: `/video/[jobId]` → "Export để render" tải `bundle-<jobId>.zip` → chạy tay `npm run render -- bundle.zip`. Mục tiêu: nút **"Render MP4"** ở stage video chạy engine ffmpeg **server-side** đọc thẳng store RAM, stream progress theo shot qua NDJSON, tự tải `output.mp4` + `.srt` + `.timeline.json`. Có **Hủy** (kill ffmpeg) + **lock 1-render/job** (409). Zip export + CLI vẫn còn nhưng lùi xuống "nâng cao".

Engine render ĐÃ là code Node server-side (`lib/ffmpeg.ts` spawn ffmpeg, `lib/kenburns.ts`/`timeline.ts`/`tts.ts` thuần Node) — "chỉ CLI" chỉ vì `render-video.mts` đọc từ zip còn route đọc từ store. Cốt lõi: **tách orchestration thành `lib/render.ts` dùng chung** (DRY), CLI + route mới đều là client mỏng của cùng hàm.

Nguồn: brainstorm `plans/reports/brainstorm-260723-1525-render-in-app-video-stage-report.md` (đã duyệt, Approach A).

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Render MP4 tại stage video không chạm terminal, MP4 == kết quả CLI (cùng engine) | P1 |
| 2 | DRY: CLI + route render chung `lib/render.ts`, không nhân đôi orchestration | P1 |
| 3 | Progress theo shot (i/N) + phase qua NDJSON; Cancel kill ffmpeg; lock 1-render/job | P1 |
| 4 | Zip export + CLI giữ nguyên (lùi "nâng cao"); không thêm dependency | P2 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Shared render engine + CLI refactor](./phase-01-shared-render-engine-cli-refactor.md) | Completed |
| 2 | [Phase 2: Render API route + output + lock](./phase-02-render-api-route-output-lock.md) | Completed |
| 3 | [Phase 3: Video page UI + docs](./phase-03-video-page-ui-docs.md) | Completed |

## Dependencies

- P2 phụ thuộc P1 (route gọi `renderVideo` + `AbortSignal` từ `lib/render.ts`/`ffmpeg.ts`).
- P3 phụ thuộc P2 (UI gọi route render + output).
- Không blocking plan khác (mọi plan trước đã completed).

## Architecture (tóm tắt)

```
POST /storyboard/render (multipart config+bgm)
  route: đọc store (getStoryboard/getWorkingImage/getSegmentAudio) → RenderInput
       → createNdjsonStream() → trả ngay, chạy nền:
         renderVideo(input,{onProgress:write, signal})   ← lib/render.ts (dùng chung CLI)
           TTS(cache)→buildTimeline→renderShot×N→concat→buildAudioTrack→duckBgm→burnSubs→mux
           ghi .render/<jobId>-<aspect>/output.{mp4,srt,timeline.json}
           → gói MP4+.srt+.timeline.json thành results-<jobId>-<aspect>.zip (adm-zip)
       → final NDJSON {done,totalSec,downloads:{zip}}
client readNdjsonBody → <Progress> + "shot i/N" → done: tự tải results.zip (1 cú)
GET /storyboard/render/output?file=zip → serve results.zip
```

`lib/render.ts` là source-agnostic: CLI dựng `RenderInput` từ `readBundle`, route dựng từ store. `lib/ffmpeg.ts` nhận `AbortSignal` → kill child khi abort.

## Success Criteria

- [x] Bấm Render → `results-<jobId>-<aspect>.zip` (chứa MP4+.srt+.timeline) tự tải về, KHÔNG chạm terminal. *(verify UI thật + GET output 200)*
- [x] `npm run test:render` + `npm run test:e2e-video` vẫn xanh sau refactor (bằng chứng engine không đổi hành vi).
- [x] MP4 in-app khớp MP4 CLI trên 1 mẫu (test:render khớp baseline 9:16=6.00s; engine chung `lib/render.ts`).
- [x] Bấm Hủy giữa chừng → ffmpeg process biến mất (`pgrep ffmpeg` sạch), UI về nghỉ, không toast lỗi giả.
- [x] Render lần 2 khi đang chạy → 409 + nút disable (kể cả 2 POST đồng thời — H1 race đã vá).
- [x] `npm run lint` sạch; không thêm dependency mới (`npm run build` + `tsc --noEmit` cũng sạch).

## Open Questions

- None (đã chốt ở Validation Session 1 — xem `## Validation Log`).

## Validation Log

### Session 1 — 2026-07-23 (validate, Standard tier)

**Verification Results**
- Claims checked: 14 · Verified: 14 · Failed: 0 · Unverified: 0 · Tier: Standard
- Xác nhận có thật: `readBundle` shape `{scriptManifest,config,images,audio?,bgm?}`; `storyboard-store` exports `getStoryboard/getWorkingImage/getSegmentAudio`; types `WorkingImage.buffer`, `SegmentAudio.mp3Path/text`; `schema` `ScriptManifest/toScriptManifest/defaultRenderConfig/Aspect/RenderConfig`; `export-bundle/route.ts` có `buildBundle/collectAudio/parseConfig`; `lib/ndjson-stream.ts`/`ndjson-client.ts`; `components/ui/progress.tsx` + `dropdown-menu.tsx`; `adm-zip` đã là dependency; `.render/` đã gitignored (output không bẩn git).

**Decisions**
1. **`.render` cleanup:** ghi-đè cùng job+aspect, không TTL. Giữ file để tải lại đến khi render lại. (khớp đề xuất P2)
2. **Giao 3 file:** gói MP4+.srt+.timeline.json thành **`results-<jobId>-<aspect>.zip`** (adm-zip), tự tải 1 cú. → THAY đổi phương án cũ (auto MP4 + nút tay). Propagate P2 (output route serve zip) + P3 (auto-download zip, bỏ nút .srt/.timeline).
3. **Lock scope:** per-job (khóa bằng jobId); đổi aspect phải đợi. (khớp đề xuất P2)

### Whole-Plan Consistency Sweep
- Đã rà `plan.md` + 3 phase sau propagate. Thống nhất "giao kết quả = results.zip qua `?file=zip`" ở mọi nơi (kiến trúc, P2 route/output/success, P3 UI/success). Không còn tham chiếu "auto MP4 + nút .srt/.timeline" hay `?file=mp4|srt|timeline`. Không mâu thuẫn tồn đọng.

## Implementation Log

### 2026-07-23 — Cook (3 phase, hoàn tất)

**Files.** Create: `lib/render.ts` (renderVideo + RenderEvent + renderWorkDir), `lib/storyboard-render-input.ts` (buildBundle/collectAudio/parseConfig/parseRenderForm DRY), `lib/render-lock.ts`, `app/api/jobs/[id]/storyboard/render/route.ts` + `render/output/route.ts`. Modify: `lib/ffmpeg.ts` (AbortSignal optional, giữ chữ ký cũ), `scripts/render-video.mts` (client mỏng + fmt), `lib/ndjson-stream.ts` (onCancel), `export-bundle/route.ts` (dùng helper chung), `app/video/[jobId]/page.tsx` (nút Render MP4 + progress + Hủy + auto-download + dropdown Nâng cao), `README.md`.

**Verify.** `test:render` khớp baseline (9:16=6.00s); `test:e2e-video` xanh (export-bundle 34 assert không hồi quy); smoke test route (NDJSON/409/Cancel-pgrep-sạch/path-traversal/404); **UI thật** (agent-browser): progress theo shot, Hủy về nghỉ, auto-download results.zip; lint + tsc + build sạch.

**Code review (code-reviewer subagent) → đã vá:**
- **H1 (High, TOCTOU race lock):** `isRendering` check ở đầu nhưng `markRendering` sau 2 `await` → 2 POST đồng thời cùng job cùng lọt (lệch mẫu `script/route.ts` set cờ đồng bộ). Vá: giữ khóa NGAY sau check trước mọi await + cờ `handedOff`/finally gỡ khóa mọi early-return. Verify: 2 POST đồng thời → đúng 1×200 + 1×409.
- **M1 (Med, workDir leak khi Cancel/lỗi):** `renderVideo` chỉ rm workDir ở nhánh thành công. Vá: export `renderWorkDir()`, route dọn ở `finally` vòng nền (cùng process → cùng pid); giữ NGUYÊN hành vi CLI (CLI không truyền signal). Verify: workDir dọn sau cả success lẫn Cancel.
- **L3 (Low, defense-in-depth):** `assertSafeName(id)` đầu route render.
- L1 (cancel latency mid-TTS)/L2 (error message → toast)/L4 (không TTL) — tradeoff/quyết định plan đã chốt, giữ nguyên.

<!-- slug: render-video-in-app-tai-stage-video -->
