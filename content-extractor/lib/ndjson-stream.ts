// Helper NDJSON stream phía server: một request POST vừa trả kết quả cuối vừa phát tiến trình
// dần theo từng dòng JSON (`{...}\n`). Khác SSE ở chỗ chạy trên chính response POST nên client
// đọc bằng XHR/fetch-reader (Phase 2 dùng XHR để lấy thêm upload-bytes; Phase 3 dùng fetch).
//
// Cách dùng ở route:
//   const { response, write, close } = createNdjsonStream();
//   void (async () => { try { write({...}); ... } finally { close(); } })();
//   return response;   // trả NGAY để client bắt đầu đọc; công việc chạy nền, ghi dần vào stream.

export interface NdjsonStream {
  response: Response;
  write: (obj: unknown) => void;
  close: () => void;
}

// onCancel: gọi khi client đóng kết nối (fetch abort / đóng tab) → route render dùng để
// AbortController.abort() kill ffmpeg + gỡ lock. Tùy chọn, giữ chữ ký cũ tương thích.
export function createNdjsonStream(opts?: { onCancel?: () => void }): NdjsonStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      // Client abort → dừng ghi tiếp (write thành no-op) + báo route để hủy công việc nền.
      closed = true;
      opts?.onCancel?.();
    },
  });

  const write = (obj: unknown) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
    } catch {
      // Stream chết giữa chừng (client ngắt) — nuốt lỗi, đánh dấu đóng để khỏi ghi tiếp.
      closed = true;
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      controller?.close();
    } catch {
      // đã đóng — bỏ qua
    }
  };

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });

  return { response, write, close };
}
