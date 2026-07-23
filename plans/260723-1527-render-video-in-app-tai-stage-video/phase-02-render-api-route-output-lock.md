---
phase: 2
title: "Render API route + output + lock"
status: completed
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 2: Render API route + output + lock

## Overview

Route streaming `POST /storyboard/render` đọc thẳng store RAM → dựng `RenderInput` → chạy `renderVideo` nền, stream progress NDJSON, ghi output ra `.render/<jobId>-<aspect>/`. Route `GET /storyboard/render/output` serve file. Lock 1-render/job (409) + Cancel qua AbortController.

## Requirements

- Functional: `POST /api/jobs/[id]/storyboard/render` (multipart: `config` JSON + file `bgm` tùy chọn) → NDJSON stream các dòng `RenderEvent` → dòng cuối `{done, downloads:{zip}}`.
- Functional: đọc store y hệt `export-bundle/route.ts` (`buildBundle`-tương đương + `collectAudio`) → `RenderInput{segments,config,images,bundledAudio,bgm}`. Tái dùng helper thay vì chép.
- Functional: sau khi `renderVideo` xong (3 file trong `.render/<jobId>-<aspect>/`), **gói thành `results.zip`** (adm-zip — đã là dependency) chứa `output.mp4` + `output.srt` + `output.timeline.json`.
- Functional: `GET /api/jobs/[id]/storyboard/render/output?file=zip&aspect=<slug>` → trả `results.zip` từ `.render/<jobId>-<aspect>/` với `Content-Type: application/zip` + Content-Disposition `attachment; filename="results-<jobId>-<aspect>.zip"`.
- Functional: lock — đang render job này → `POST` trả **409**. Client đóng kết nối (stream cancel) → `AbortController.abort()` → kill ffmpeg + gỡ lock.
- Non-functional: `runtime = 'nodejs'`. Không thêm dependency. Ghi-đè `.render/<jobId>-<aspect>/` cũ khi render lại (không TTL).

## Architecture

**Tái dùng đọc store:** `export-bundle/route.ts` đã có `buildBundle(id, config, bgm)` (trả `{scriptManifest, images, config, bgm}`) + `collectAudio(id, scriptManifest)` + `parseConfig`. Trích 3 hàm này ra `lib/storyboard-render-input.ts` (hoặc export từ chỗ hiện tại) để cả export-bundle và render route dùng chung → dựng `RenderInput`:

```ts
// segments = scriptManifest.segments; bundledAudio = collectAudio(...)
const input: RenderInput = { jobId: id, segments: sm.segments, config, images, bundledAudio, bgm };
```

**Route render (mới) `app/api/jobs/[id]/storyboard/render/route.ts`:**

```ts
export const runtime = 'nodejs';
export async function POST(req, { params }) {
  const { id } = await params;
  if (isRendering(id)) return NextResponse.json({ error: 'Đang render job này' }, { status: 409 });
  // parse multipart (giống export-bundle POST): config + bgm
  // dựng RenderInput từ store; thiếu storyboard/script → 404, thiếu band → 400 (như export-bundle)
  const aspectSlug = input.config.aspect.replace(':', 'x');
  const outDir = path.join('.render', `${id}-${aspectSlug}`);
  await rm(outDir, { recursive: true, force: true });               // ghi-đè cũ
  const outPath = path.join(outDir, 'output.mp4');
  const ac = new AbortController();
  const { response, write, close } = createNdjsonStream();
  // stream cancel (client đóng) → abort. createNdjsonStream cần expose onCancel/abort hook.
  markRendering(id, ac);
  void (async () => {
    try {
      const subsMode = input.config.subtitles.burnIn ? 'both' : 'srt';
      const res = await renderVideo(input, { outPath, subsMode, onProgress: write, signal: ac.signal });
      // gói 3 file → results.zip (adm-zip) trong outDir
      const zip = new AdmZip();
      zip.addLocalFile(res.outPath); zip.addLocalFile(res.srtPath); zip.addLocalFile(res.timelinePath);
      zip.writeZip(path.join(outDir, 'results.zip'));
      write({ done: true, totalSec: res.totalSec,
        downloads: { zip: `/api/jobs/${id}/storyboard/render/output?file=zip&aspect=${aspectSlug}` } });
    } catch (err) {
      if (!ac.signal.aborted) write({ error: err instanceof Error ? err.message : 'Render lỗi' });
    } finally { clearRendering(id); close(); }
  })();
  return response;
}
```

**Lock module `lib/render-lock.ts` (mới, nhỏ):** `Map<jobId, AbortController>` trên globalThis (sống qua HMR như jobs store). `isRendering/markRendering/clearRendering`. `markRendering` lưu AC để (tùy chọn) có endpoint hủy chủ động; v1 hủy chính bằng stream cancel.

**`lib/ndjson-stream.ts` (sửa nhỏ):** thêm callback `onCancel` để route bắt sự kiện client đóng kết nối → `ac.abort()`. Hiện `cancel()` chỉ set `closed=true`; cần cho phép route đăng ký hook.

**Route output (mới) `.../render/output/route.ts`:**
- `GET` — validate `file === 'zip'` + `aspect` (regex `^\d+x\d+$`), đọc `.render/<jobId>-<aspect>/results.zip`, 404 nếu thiếu. `Content-Type: application/zip`; Content-Disposition `attachment; filename="results-<jobId>-<aspect>.zip"`. **Chặn path traversal:** jobId (uuid) + aspect qua regex whitelist; resolve path rồi assert nằm trong thư mục `.render/` (từ chối nếu thoát ra ngoài).

## Related Code Files

- Create: `content-extractor/app/api/jobs/[id]/storyboard/render/route.ts` (import `AdmZip` từ `adm-zip` — đã là dependency — để gói results.zip)
- Create: `content-extractor/app/api/jobs/[id]/storyboard/render/output/route.ts`
- Create: `content-extractor/lib/render-lock.ts`
- Create/Refactor: `content-extractor/lib/storyboard-render-input.ts` (trích buildBundle/collectAudio/parseConfig từ export-bundle để DRY)
- Modify: `content-extractor/lib/ndjson-stream.ts` (hook onCancel)
- Modify: `content-extractor/app/api/jobs/[id]/storyboard/export-bundle/route.ts` (dùng helper trích ra, không đổi hành vi)

## Implementation Steps

1. Trích `buildBundle`/`collectAudio`/`parseConfig` từ `export-bundle/route.ts` → `lib/storyboard-render-input.ts`; export-bundle import lại. Chạy `test:e2e-video` xác nhận export-bundle không đổi.
2. Thêm `onCancel` hook vào `createNdjsonStream`.
3. Viết `lib/render-lock.ts`.
4. Viết `render/route.ts` (POST streaming) + `render/output/route.ts` (GET serve).
5. Test thủ công qua `curl -N` (stream) + tải file; kiểm 404/400/409; kiểm Cancel (đóng curl giữa chừng → `pgrep ffmpeg` sạch trong ~1s).

## Success Criteria

- [ ] `POST .../render` stream các dòng NDJSON progress → dòng `done` có `downloads.zip`.
- [ ] `GET .../render/output?file=zip` tải được `results.zip` (giải nén ra MP4+.srt+.timeline); file/aspect sai → 404.
- [ ] Thiếu storyboard/script → 404; thiếu band → 400 (khớp export-bundle).
- [ ] Render lần 2 khi đang chạy → 409.
- [ ] Đóng kết nối giữa chừng → ffmpeg bị kill (`pgrep ffmpeg` sạch), lock được gỡ.
- [ ] `test:e2e-video` vẫn xanh (export-bundle không hồi quy). `npm run lint` sạch.

## Risk Assessment

- **Stream cancel không lan tới ffmpeg:** nếu `onCancel` không nối AC, ffmpeg chạy tiếp sau khi client bỏ. *Mitigation:* test Cancel bằng đóng curl + `pgrep`.
- **Path traversal ở output route:** `file`/`aspect`/`id` chưa validate → đọc file ngoài. *Mitigation:* whitelist cứng file enum + regex aspect + jobId uuid; resolve rồi assert nằm trong `.render/`.
- **DRY export-bundle:** trích helper làm hồi quy export. *Mitigation:* `test:e2e-video` bao export-bundle (34 assert) chạy sau bước 1.
- **Next 16 route conventions:** đọc `node_modules/next/dist/docs/` nếu API route stream/multipart khác bản cũ (theo AGENTS.md repo).

<!-- Updated: Validation Session 1 — giao kết quả = results.zip (adm-zip) qua ?file=zip; lock per-job (jobId); .render ghi-đè không TTL -->

