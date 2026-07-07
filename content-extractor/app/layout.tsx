import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manga Content Extractor",
  description:
    "Trích xuất nội dung từng cảnh (mô tả + thoại) từ chapter manga bằng vision LLM.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
