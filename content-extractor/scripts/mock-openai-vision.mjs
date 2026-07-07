// Mock OpenAI-compatible vision server cho e2e Stage 1.5 — không tốn API thật.
// Trả SceneContent cố định. Marker "luôn lỗi" (vision withRetry cạn lượt → item/beat
// mang lỗi thật sự, test cô lập lỗi):
//   - width === 601px, HOẶC
//   - ảnh gần đen tuyền (mean < 5) — dùng được sau khi ingest gộp+chia band, vì band
//     kế thừa bề rộng canvas nên marker theo width không còn nhắm được 1 band riêng.
// Chạy từ thư mục content-extractor để resolve được sharp.
import http from 'node:http';
import sharp from 'sharp';

const PORT = Number(process.env.MOCK_PORT ?? 3106);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const dataUrl = parsed.messages?.[0]?.content?.find((p) => p.type === 'image_url')
          ?.image_url?.url;
        const b64 = String(dataUrl ?? '').split(',')[1] ?? '';
        const img = Buffer.from(b64, 'base64');
        const meta = await sharp(img).metadata();
        const stats = await sharp(img).stats();
        const nearlyBlack = stats.channels.every((c) => c.mean < 5);
        if (meta.width === 601 || nearlyBlack) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'mock: ảnh marker luôn lỗi' } }));
          return;
        }
      } catch {
        // body lạ → cứ trả scene mặc định
      }
      const scene = { description: 'Cảnh mock.', dialogue: ['Thoại mock.'], note: '' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(scene) } }],
          usage: { total_tokens: 42 },
        }),
      );
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`MOCK_READY ${PORT}`));
