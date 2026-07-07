// Mock OpenAI-compatible vision server cho e2e Stage 1.5 — không tốn API thật.
// Trả SceneContent cố định. Marker "luôn lỗi" (vision withRetry cạn lượt → item/beat
// mang lỗi thật sự, test cô lập lỗi): ảnh có mean luminance trong dải xám-giữa [110,145].
//   Vì sao mean-window: thuật toán band mới (gutter + gộp band non nội dung) không giữ
//   được band THUẦN màu (vùng solid = mọi hàng "an toàn" → bị cắt/gộp; band gần trắng bị
//   gộp mất). Fixture e2e dùng khối sọc dọc (mọi hàng "unsafe" → thành band riêng, đủ mực
//   nên không bị gộp): sọc 50% đen ≈ mean 127 (marker LỖI), sọc thưa 25-30% ≈ mean ~180-190
//   (trả scene). Mean-window nhắm đúng band sọc-đậm, không đụng band sọc-thưa/nền sáng.
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
        const stats = await sharp(img).stats();
        // mean luminance trung bình các kênh — band sọc 50% đen rơi vào [110,145].
        const mean = stats.channels.reduce((s, c) => s + c.mean, 0) / stats.channels.length;
        if (mean >= 110 && mean <= 145) {
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
