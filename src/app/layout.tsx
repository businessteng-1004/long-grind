import type { Metadata } from "next";
import SiteFrame from "./components/SiteFrame";
import "./globals.css";

export const metadata: Metadata = {
  title: "LongGrind",
  description: "A poker field journal for bankroll, videos, travel logs, and review notes.",
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
