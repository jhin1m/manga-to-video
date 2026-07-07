import { NextResponse } from 'next/server';
import { getJob, subscribe } from '@/lib/jobs';
import type { JobProgress } from '@/lib/schema';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Không tìm thấy job' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsub?.();
        try {
          controller.close();
        } catch {
          // controller đã đóng (client abort) — bỏ qua
        }
      };
      const send = (p: JobProgress) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`));
        } catch {
          // Stream đã chết (client rớt mà không kịp abort) — listener chạy đồng bộ trong
          // bus.emit từ pipeline, KHÔNG được để lỗi lan ngược vào setItemResult/setItemError.
          close();
          return;
        }
        if (p.phase === 'done' || p.phase === 'failed') close();
      };

      unsub = subscribe(id, send);
      req.signal.addEventListener('abort', close);
      // Snapshot ngay khi kết nối — client vào muộn (job đã xong) vẫn nhận trạng thái cuối rồi đóng.
      send(job.progress);
    },
    cancel() {
      closed = true;
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
