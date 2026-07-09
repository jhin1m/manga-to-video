// Mock model biên kịch (OpenAI-compatible) cho test Stage 2 — không tốn API thật.
// POST /v1/chat/completions → JSON {segments:[...]} bọc trong ```json fence (đi qua đúng
// đường extractJson). Kịch bản cố định cho fixture 3 band:
//   - đoạn 1 GỘP band 0+1, đoạn 2 band 2 → phủ đủ 3 band
//   - đoạn 3 trỏ index 99 NGOÀI BIÊN → generateScript phải loại (đoạn rỗng shot bị bỏ)
// Chạy đứng riêng: node scripts/mock-script-model.mjs (MOCK_PORT, mặc định 3108)
// hoặc import { createMockScriptModel } trong verify script (port 0 = tự chọn).
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const SCRIPT_RESPONSE = {
  segments: [
    { narration: 'Mở đầu, hai nhân vật chạm mặt. "Dừng lại!"', shotIndices: [0, 1] },
    { narration: 'Trận chiến bùng nổ. Kết cục bất ngờ.', shotIndices: [2] },
    { narration: 'Đoạn lạc trôi ngoài biên.', shotIndices: [99] },
  ],
};

export function createMockScriptModel(port = 0) {
  let count = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/__count') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ count }));
      return;
    }
    if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        count++;
        const content = '```json\n' + JSON.stringify(SCRIPT_RESPONSE) + '\n```';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { total_tokens: 99 },
          }),
        );
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(port, () =>
      resolve({
        port: server.address().port,
        requestCount: () => count,
        close: () => new Promise((r) => server.close(r)),
      }),
    );
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mock = await createMockScriptModel(Number(process.env.MOCK_PORT ?? 3108));
  console.log(`MOCK_READY ${mock.port}`);
}
