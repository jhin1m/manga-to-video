import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-to-img (pdfjs + @napi-rs/canvas) vỡ khi bị bundle vào server chunk
  // (module evaluation đọc path/font lúc import) — giữ ở node_modules, require lúc runtime.
  // ffmpeg-static/@ffprobe-installer tính đường dẫn binary từ __dirname trong node_modules
  // — bundle vào server chunk sẽ trỏ sai path.
  serverExternalPackages: ['pdf-to-img', 'ffmpeg-static', '@ffprobe-installer/ffprobe'],
};

export default nextConfig;
