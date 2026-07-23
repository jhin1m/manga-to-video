// Helper NDJSON phía client: parse dòng JSON tăng dần từ response POST đang stream.
// Hai đường vào (Phase 2 dùng XHR để lấy upload-bytes; Phase 3 dùng fetch reader) chia sẻ
// chung bộ tách dòng theo '\n'. Chỉ chạy ở trình duyệt (import từ 'use client' component).

function makeLineSplitter(onLine: (obj: unknown) => void) {
  let buf = '';
  const emit = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onLine(JSON.parse(trimmed));
    } catch {
      // Dòng rác/chưa trọn — splitter chỉ emit dòng đã trọn nên hiếm khi tới đây; bỏ qua.
    }
  };
  return {
    push(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        emit(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    },
    flush() {
      emit(buf);
      buf = '';
    },
  };
}

// XHR: responseText tích luỹ dần → theo dõi offset đã đọc, chỉ đẩy phần MỚI vào splitter.
// (XHR cần thiết cho Phase 2 vì chỉ XHR expose upload.onprogress cho pha-1.)
export function readNdjson(xhr: XMLHttpRequest, onLine: (obj: unknown) => void): void {
  const splitter = makeLineSplitter(onLine);
  let offset = 0;
  const pump = () => {
    const text = xhr.responseText;
    if (text.length > offset) {
      splitter.push(text.slice(offset));
      offset = text.length;
    }
  };
  xhr.addEventListener('progress', pump);
  xhr.addEventListener('load', () => {
    pump();
    splitter.flush();
  });
}

// fetch: đọc ReadableStream body theo chunk (đã là phần mới, không tích luỹ) → decode → splitter.
// Dùng khi KHÔNG cần upload-bytes progress (Phase 3 tạo kịch bản).
export async function readNdjsonBody(
  body: ReadableStream<Uint8Array>,
  onLine: (obj: unknown) => void,
): Promise<void> {
  const splitter = makeLineSplitter(onLine);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) splitter.push(decoder.decode(value, { stream: true }));
  }
  splitter.push(decoder.decode());
  splitter.flush();
}
