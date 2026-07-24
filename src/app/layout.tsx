import type { Metadata } from "next";
import SiteFrame from "./components/SiteFrame";
import "./globals.css";

export const metadata: Metadata = {
  title: "LongGrind",
  description: "德州扑克牌局记录、统计、资金曲线和手牌复盘工具。",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
