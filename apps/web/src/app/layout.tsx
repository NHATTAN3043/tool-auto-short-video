import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Shorts Studio",
  description: "Dựng video dọc cho TikTok, YouTube Shorts và Facebook Reels",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="flex h-14 items-center justify-between px-4 lg:px-6">
            <Link href="/" className="font-semibold">
              Shorts Studio
            </Link>
            <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
              Ngân sách
            </Link>
          </div>
        </header>
        {/* Pages own their width: list and form pages centre a column, the project workspace uses the full width. */}
        <main>{children}</main>
      </body>
    </html>
  );
}
