---
phase: 3
title: "Narration Pipeline"
status: completed
priority: P1
dependencies: [2]
---

# Phase 3: Beats & Narration (template)

## Overview

Từ band/trang (Phase 2) → sinh `Beat[]` có `narration`. **v1 KHÔNG dùng LLM soạn**: narration = **template**
ghép từ `description` + `dialogue` (sửa tay ở Phase 4). Nội dung mỗi band lấy theo nguồn: strip → **2A**
(re-extract vision từng band); manga trang → dùng lại content Stage 1.

## Requirements

- Functional: `buildBeats(...)` sinh beats theo nguồn; `fillNarration(scene)` ghép template narration (không model); gán `region`, `sourceIndex`, `sourceDialogue`, `durationHint`.
- Non-functional: chỉ 1 loại model call = **vision `describeImage`** (cho 2A); concurrency `p-limit`; cô lập lỗi/beat + retry; ENV-driven như Stage 1. **Không thêm model text/`NARRATION_MODEL`.**

## Architecture

**2A — strip (re-extract per band):** với mỗi `region` band, crop từ canvas làm việc
(`sharp(canvasBuf).extract({left,top,width,height})`) → `describeImage(bandBuf)` (tái dùng `lib/vision.ts`, đã export)
→ `SceneContent` cho band → `fillNarration`. Band do smart-split (Phase 2), toạ độ tin 0% từ model.

**Manga trang:** dùng `SceneContent` trang đã có ở Stage 1 → `fillNarration` → 1 Beat (`region` = null / cả-trang).

**fillNarration (template, `lib/narration.ts`):** thuần chuỗi, không gọi mạng:
```
narration = [description, ...dialogue.map(d => `"${d}"`)].filter(Boolean).join('\n')
```
(mô tả trước, mỗi thoại một dòng trong ngoặc kép — người biên tập ở Phase 4). `durationHint = estimateSeconds(narration)`
(helper Phase 1). *Ghi chú:* nút "LLM chau chuốt" là mở rộng tương lai — **ngoài scope v1**, chỉ chừa điểm cắm.

```ts
// lib/narration.ts
export function fillNarration(scene: SceneContent): string   // template, không async
export async function buildBeats(args: {
  sourceKind: SourceKind;
  working: Array<{ sourceIndex: number; buffer: Buffer; content: SceneContent | null; bands: BeatRegion[] }>;
}): Promise<Beat[]>
```

Tiến độ 2A qua bus (Phase 1) → SSE Phase 4. Beat lỗi (band re-extract fail) mang cờ `error` (mẫu Stage 1), retry được.

## Related Code Files

- Create: `content-extractor/lib/narration.ts` — `fillNarration` (template) + `buildBeats`.
- Reference: `lib/vision.ts` (`describeImage` — đã export, dùng trực tiếp cho 2A), `lib/pipeline.ts` (mẫu `p-limit`), `lib/smart-split.ts` + `lib/stitch.ts` (Phase 2), `lib/schema.ts` (`estimateSeconds`).
- **Không tạo** client LLM text mới; **không** thêm `NARRATION_MODEL`.

## Implementation Steps

1. `fillNarration`: ghép template (không async, không mạng).
2. `buildBeats`:
   - `strip` → mỗi band: crop → `describeImage(bandBuf)` → `fillNarration` → Beat với `region` = band.
   - `pages` → mỗi trang: `fillNarration(content Stage 1)` → 1 Beat (`region` = null).
3. Gán `order` tăng dần toàn cục, `sourceIndex`, `sourceDialogue`, `durationHint`.
4. Concurrency `p-limit` (`VISION_CONCURRENCY`) cho 2A; cô lập lỗi/beat + đường retry 1 beat.
5. Phát tiến độ qua bus; lưu beats vào store (Phase 1).

## Success Criteria

- [x] Strip (band tổng hợp) → mỗi band 1 Beat, `narration` template khác rỗng, `region` đúng dải y.
- [x] Manga pages → mỗi trang 1 Beat, `narration` = mô tả + thoại ghép template.
- [x] Lỗi 1 band 2A không sập job; retry beat phục hồi.
- [x] KHÔNG có model call nào ngoài `describeImage` (vision); không phụ thuộc `NARRATION_MODEL`.
- [x] `durationHint` tỉ lệ độ dài narration.

## Risk Assessment

- **2A tốn vision** → chỉ áp cho strip; `p-limit`; cân nhắc cache theo band-hash để retry không gọi lại thừa.
- **Template narration cứng** → chấp nhận cho v1 (sửa tay Phase 4 là chốt); LLM polish để pha sau, đã chừa điểm cắm.
- **Content Stage 1 rỗng (item lỗi/chưa retry)** → beat mang `error`, narration để trống chờ người điền.
