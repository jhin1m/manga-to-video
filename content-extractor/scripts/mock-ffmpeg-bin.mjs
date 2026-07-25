// Bin ffmpeg cho các mock TTS — mock chạy standalone bằng `node` nên không import được
// resolver TS trong lib/ffmpeg.ts. Thứ tự rút gọn: env → bundled → PATH (mock chỉ sinh
// mp3 sine 1s, build nào cũng được; bundled đứng trước PATH để máy chưa cài ffmpeg —
// Windows clone sạch — vẫn chạy test được).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

export function mockFfmpegBin() {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return fromEnv;
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static');
    if (typeof bundled === 'string' && existsSync(bundled)) return bundled;
  } catch {
    // thiếu package (chạy ngoài repo) → rơi xuống PATH
  }
  return 'ffmpeg';
}
