import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-to-img (pdfjs + @napi-rs/canvas) vỡ khi bị bundle vào server chunk
  // (module evaluation đọc path/font lúc import) — giữ ở node_modules, require lúc runtime.
  serverExternalPackages: ['pdf-to-img'],
};

export default nextConfig;
