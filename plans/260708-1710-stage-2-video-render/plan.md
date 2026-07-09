---
title: "Stage 2: Storyboard → Kịch bản AI → Video (render MP4)"
description: "Từ StoryboardManifest → AI Biên kịch (gộp/tách panel) → Preview UI tinh chỉnh → CLI ffmpeg render MP4 + .srt + timeline"
status: completed
priority: P2
branch: "main"
tags: [stage-2, video, tts, ffmpeg, script-gen]
blockedBy: []
blocks: []
created: "2026-07-08T10:11:10.083Z"
createdBy: "ck:plan"
source: skill
---

# Stage 2: Storyboard → Kịch bản AI → Video (render MP4)

## Overview

Biến `StoryboardManifest` (Stage 1.5) thành **file MP4 xem được**. Ba khối:
1. **AI Biên kịch** — model text (`SCRIPT_MODEL`) đọc content mọi band → viết kịch bản kể mạch lạc, được **gộp/tách panel** thành `ScriptSegment[]` (1 narration → 1+ shot), người duyệt tay.
2. **Preview UI** (`/video/[jobId]`) — phát duyệt Ken Burns (CSS xấp xỉ), tinh chỉnh phụ đề (font/size/màu/vị trí) + BGM + khung hình live → export **bundle.zip** + `render-config.json`.
3. **CLI render cuối** (`scripts/render-video.mts`, ffmpeg) — nguồn chân lý: TTS ElevenLabs (cache đĩa) → phân bổ audio cho shots → Ken Burns per shot → concat + mux + BGM duck → `MP4 + .srt + timeline.json`.

**Bất biến sync:** audio TTS là nhạc trưởng. Narration khớp cứng với **segment**; audio segment phân bổ cho các shot của nó → `timeline.json ≡ timeline video`. `durationHint` chỉ dùng cho preview im lặng.

Nguồn thiết kế: `docs/brainstorms/2026-07-08-stage-2-video-render.md` (đã chốt mọi quyết định).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [AI Biên kịch (script layer)](./phase-01-ai-bi-n-k-ch-script-layer.md) | Completed |
| 2 | [UI duyệt kịch bản](./phase-02-ui-duy-t-k-ch-b-n.md) | Completed |
| 3 | [Bundle + render-config + TTS](./phase-03-bundle-render-config-tts.md) | Completed |
| 4 | [Preview UI video](./phase-04-preview-ui-video.md) | Completed |
| 5 | [CLI render lõi](./phase-05-cli-render-l-i.md) | Completed |
| 6 | [CLI ghép cuối](./phase-06-cli-gh-p-cu-i.md) | Completed |
| 7 | [Verify + docs](./phase-07-verify-docs.md) | Completed |

## Phase dependency graph

```
P1 (script contract) ──┬─► P2 (UI duyệt) ──┐
                       │                    ├─► P4 (Preview UI) ──┐
P1 ────────────────────┴─► P3 (bundle+TTS) ─┤                    ├─► P7 (verify+docs)
                                            └─► P5 (CLI lõi) ─► P6 (CLI ghép) ─┘
```
- P3 chỉ cần P1 (schema ScriptManifest) → làm song song P2.
- P5 chỉ cần P3 (bundle/tts/config) → làm song song P4.

## Nguyên tắc chung (áp cho mọi phase)

- **Giữ nguyên Stage 1/1.5 core**: không sửa `StoryboardManifest`/`Beat` v1, chỉ đọc. Types mới (`ScriptManifest`, `RenderConfig`) **thêm** vào `schema.ts` (additive, versioned độc lập — mẫu `MANIFEST_VERSION`/`STORYBOARD_VERSION` đã cùng tồn tại).
- **Provider-agnostic qua ENV** (mẫu `readVisionConfig`): `SCRIPT_MODEL`, `ELEVENLABS_*` khai báo `.env.example`, đổi nhà cung cấp không sửa code.
- **Lỗi cô lập** (mẫu `composeStoryboard`/`processChapter`): 1 segment/1 shot lỗi không sập cả job.
- **Node 24** (`.nvmrc`): mọi lệnh build/test chạy sau `nvm use 24`.
- **ffmpeg/ffprobe** là system dep — CLI kiểm tra tồn tại, báo lỗi rõ (prerequisite: `brew install ffmpeg`).

## Acceptance criteria (toàn plan)

- [x] "Tạo kịch bản AI" → `ScriptSegment[]` mạch lạc, gộp/tách index-based, người duyệt/sửa được.
- [x] Export bundle = `ScriptManifest` + `band-*.jpg` + `render-config.json` (+ `audio/seg-*.mp3` nếu preview đã synth).
- [x] Preview UI phát duyệt + chỉnh phụ đề/BGM/aspect live; 2 chế độ (im lặng free / có audio).
- [x] `render-video.mts <bundle.zip> --aspect 9:16 --out out.mp4` → MP4 phát được; tổng thời lượng ≈ Σ dur_seg.
- [x] Luôn xuất `.srt` (caption **tách theo câu/mốc thời gian** trong segment); `burnIn=true` → chữ cháy đúng font/size/màu/vị trí.
- [x] `timeline.json` khớp timing video; aspect 9:16↔16:9 từ cùng bundle đều chạy.
- [x] TTS **cache hit**: preview synth 1 lần → CLI không gọi lại ElevenLabs; `--dry-run` không gọi API.
- [x] BGM ducking dưới narration.
- [x] `npm run test:unit` + `test:script` + `test:render` xanh (mock ElevenLabs + mock SCRIPT_MODEL).

## Dependencies

- **Xây trên** Stage 1.5 (`plans/260706-2239-storyboard-narration-stage-1-5`, đã `completed`) — đọc `StoryboardManifest`/working images. Không blocking (đã xong).
- Không có plan đang mở nào chồng lấn (các plan trước đều `completed`).

## Ngoài scope (vòng sau)

Transition giữa shot · multi-voice · nhạc theo cảm xúc · batch cả bộ · preview render-accurate (WebGL) · nhiều track BGM · AI tự chọn nhạc.

## Validation Log

### Verification Results (Session 1)
- Claims checked: file paths, deps, symbols, prerequisite ffmpeg — Tier: Full (7 phase).
- **Verified: all | Failed: 0 | Unverified: 0.**
- ffmpeg 8.1.2 + ffprobe có sẵn (`/opt/homebrew/bin`); `adm-zip`/`p-limit`/`openai`/`sharp`/`pdf-to-img` đủ; working image route + storyboard route dir khớp; `parseSceneJSON`/`classifyError` exported, `withRetry` private (P1 sẽ export).

### Decisions confirmed (Session 1)
1. **Phụ đề — tách theo câu/mốc thời gian** (không phải 1 caption/segment). → Ảnh hưởng P5 (`toSrt` sub-split trong segment, canh giờ theo tỉ lệ ký tự; tuỳ chọn ElevenLabs with-timestamps để chính xác) + P4 (overlay hiện caption ngắn theo câu).
2. **Khung 16:9 từ band dọc — blur-fill nền** (giữ như plan). → P5 `kenburns.ts` không đổi.
3. **ElevenLabs — cho phép cả 3 tier qua ENV** (`ELEVENLABS_MODEL`): `eleven_multilingual_v2` (mặc định, chất lượng), `eleven_turbo_v2_5` (rẻ ~50%), `eleven_flash_v2_5` (nhanh/nháp). → P3 `.env.example` liệt kê cả 3, mặc định multilingual_v2.
4. **Band thiếu content Stage 1 — vision fallback**: band content null → crop → `describeImage` trước khi biên kịch (lỗi cô lập). → P1 input builder + import `cropRegion`/`describeImage`.

### Whole-Plan Consistency Sweep (Session 1)
- Thuật ngữ segment/shot/ScriptManifest/RenderConfig/bundle/blur-fill nhất quán mọi phase.
- Đã đổi mọi chỗ "1 caption/segment" → "caption tách theo câu" (plan.md, P5, P4).
- Không mâu thuẫn tồn đọng. **Đủ điều kiện triển khai** (Failed: 0).

### Implementation Results (Session 2 — 2026-07-08)

Toàn bộ 7 phase đã implement + verify trong một phiên (cook auto, không dừng):

- **Gates:** `tsc` sạch · `eslint` sạch · `next build` OK · `test:unit` 4 suite ALL_PASS (132 assert, gồm `verify-script`) · `test:render` RENDER_ALL_PASS (mock ElevenLabs, MP4 9:16 + 16:9 + BGM + dry-run) · `test:e2e` E2E_ALL_PASS (regression Stage 1/1.5) · `test:e2e-video` ALL_PASS (34 assert route Stage 2 — script/duyệt/tts-cache/export-bundle).
- **Bổ sung ngoài plan:** `scripts/e2e-script-video.mts` (e2e tầng route Stage 2) + script `test:e2e-video`.
- **Code review (subagent):** DONE_WITH_CONCERNS → đã fix toàn bộ: H1 sanitize jobId/segId/bgm trong `readBundle` + workDir per-run (chống traversal/`rm -rf` từ bundle lạ + render song song); M1 chốt text trước await ở route TTS; M3 identity-check (so dims) trước khi ưu tiên content tươi ở route script; M4 clamp `segmentOverrides` ≥ audio+pad (giữ bất biến sync); L1–L7 hardening (font sanitize, validate aspect/fps, cache key NUL, tmp unique, fetch timeout, giữ draft khi PATCH lỗi, cảnh báo shotIndex lặp, guard sourceBeatIds khi split).
- **Caveat môi trường:** ffmpeg máy này (bottle slim 8.1.2) thiếu libass → burn-in degrade có cảnh báo + giữ `.srt` rời (test thích ứng theo `hasFilter('subtitles')`); mapping style burn (font/size/màu/vị trí → force_style ASS) đã implement, cần máy có libass để verify hình ảnh cuối.
- **Chưa commit** — thay đổi nằm ở working tree, chờ lệnh commit.
