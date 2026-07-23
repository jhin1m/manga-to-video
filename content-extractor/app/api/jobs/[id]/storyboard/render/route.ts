import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { NextResponse } from 'next/server';
import { assertSafeName } from '@/lib/bundle';
import { createNdjsonStream } from '@/lib/ndjson-stream';
import { clearRendering, isRendering, markRendering } from '@/lib/render-lock';
import type { RenderInput } from '@/lib/render';
import { renderVideo, renderWorkDir } from '@/lib/render';
import { buildBundle, collectAudio, parseRenderForm } from '@/lib/storyboard-render-input';

export const runtime = 'nodejs';

// Render MP4 in-app: đọc thẳng store RAM → renderVideo (engine dùng chung với CLI) chạy nền,
// stream progress NDJSON (các dòng RenderEvent), gói output.mp4 + .srt + .timeline.json thành
// results-<jobId>-<aspect>.zip, dòng cuối {done, downloads.zip}. Lock 1-render/job (409);
// client đóng kết nối → AbortController.abort() → kill ffmpeg + gỡ lock.
// GET results.zip qua ./output. Output ghi-đè cùng job+aspect (không TTL).

const RENDER_ROOT = '.render';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Chặn jobId lạ trước mọi thao tác file (defense-in-depth; buildBundle vốn 404 id không có store).
  try {
    assertSafeName(id, 'jobId');
  } catch {
    return NextResponse.json({ error: 'jobId không hợp lệ' }, { status: 400 });
  }
  if (isRendering(id)) {
    return NextResponse.json({ error: 'Đang render job này' }, { status: 409 });
  }

  // Giữ khóa NGAY (đồng bộ, trước mọi await) — mẫu script/route.ts: request thứ 2 racing trong
  // quãng await (parse/collect) phải thấy khóa → 409, không cùng chui vào workDir. handedOff = true
  // khi stream đã bàn giao cho vòng nền (vòng nền tự clearRendering ở finally); mọi lối thoát khác
  // gỡ khóa qua finally dưới đây (không kẹt khóa khi parse/buildBundle lỗi).
  const ac = new AbortController();
  markRendering(id, ac);
  let handedOff = false;
  try {
    // Parse multipart config + bgm (giống export-bundle POST).
    let config;
    let bgm: { filename: string; data: Buffer } | undefined;
    try {
      ({ config, bgm } = await parseRenderForm(req));
    } catch {
      return NextResponse.json(
        { error: 'Body phải là multipart form-data (config JSON + file bgm tuỳ chọn)' },
        { status: 400 },
      );
    }

    // Dựng RenderInput từ store (thiếu storyboard/script → 404, thiếu band → 400 — như export-bundle).
    const built = buildBundle(id, config, bgm);
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: built.status });
    const bundledAudio = await collectAudio(id, built.scriptManifest);
    const input: RenderInput = {
      jobId: id,
      segments: built.scriptManifest.segments,
      config: built.config,
      images: built.images,
      ...(bundledAudio ? { bundledAudio } : {}),
      ...(built.bgm ? { bgm: built.bgm } : {}),
    };

    const aspectSlug = built.config.aspect.replace(':', 'x');
    const outDir = path.join(RENDER_ROOT, `${id}-${aspectSlug}`);
    const outPath = path.join(outDir, 'output.mp4');

    const { response, write, close } = createNdjsonStream({ onCancel: () => ac.abort() });
    handedOff = true; // từ đây vòng nền sở hữu khóa + đóng stream

    void (async () => {
      try {
        await rm(outDir, { recursive: true, force: true }); // ghi-đè output cũ cùng job+aspect
        await mkdir(outDir, { recursive: true });
        const subsMode = built.config.subtitles.burnIn ? 'both' : 'srt';
        const res = await renderVideo(input, {
          outPath,
          subsMode,
          onProgress: write,
          signal: ac.signal,
        });
        // Gói MP4 + .srt + .timeline.json → results.zip (adm-zip đã là dependency), tải 1 cú.
        const zip = new AdmZip();
        zip.addLocalFile(res.outPath);
        zip.addLocalFile(res.srtPath);
        zip.addLocalFile(res.timelinePath);
        zip.writeZip(path.join(outDir, 'results.zip'));
        write({
          done: true,
          totalSec: res.totalSec,
          downloads: { zip: `/api/jobs/${id}/storyboard/render/output?file=zip&aspect=${aspectSlug}` },
        });
      } catch (err) {
        // Abort (người hủy) không phải lỗi — chỉ báo lỗi thật.
        if (!ac.signal.aborted) {
          write({ error: err instanceof Error ? err.message : 'Render lỗi' });
        }
      } finally {
        clearRendering(id);
        close();
        // renderVideo tự dọn workDir ở nhánh thành công; Cancel/lỗi thì để lại — dọn tại đây
        // (cùng process → cùng pid). rm force → no-op nếu đã dọn.
        await rm(renderWorkDir(id, built.config.aspect, RENDER_ROOT), {
          recursive: true,
          force: true,
        }).catch(() => {});
      }
    })();

    return response;
  } finally {
    // Mọi lối thoát TRƯỚC khi bàn giao (parse 400, buildBundle 404/400, lỗi bất ngờ) phải gỡ khóa.
    if (!handedOff) clearRendering(id);
  }
}
