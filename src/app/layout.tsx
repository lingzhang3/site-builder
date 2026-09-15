import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Site Builder",
  description: "Connect your data and build dashboards you can share.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
