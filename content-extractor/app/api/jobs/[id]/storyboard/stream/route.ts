import { NextResponse } from 'next/server';
import { getStoryboard, subscribeStoryboard } from '@/lib/storyboard-store';
import type { JobProgress } from '@/lib/schema';

export const runtime = 'nodejs';

// SSE tiến độ compose storyboard — cùng khuôn stream Stage 1: snapshot khi nối,
// guard enqueue sau close, tự đóng khi done/failed.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStoryboard(id);
  if (!state) {
    return NextResponse.json({ error: 'Chưa có storyboard cho job này' }, { status: 404 });
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
          // Stream chết giữa emit đồng bộ từ compose — không để lỗi lan ngược vào store.
          close();
          return;
        }
        if (p.phase === 'done' || p.phase === 'failed') close();
      };

      unsub = subscribeStoryboard(id, send);
      req.signal.addEventListener('abort', close);
      // Snapshot ngay khi kết nối — client vào muộn vẫn nhận trạng thái cuối rồi đóng.
      send(state.progress);
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
