import type { Metadata } from "next";
import "./fonts/fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "VidSnap - AI 视频理解助手",
  description: "粘贴 YouTube、Bilibili 或抖音视频链接，AI 替你看完并回答问题。视频总结、关键信息提取、跨语言翻译。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
