import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Intake",
  description: "Secure provider intake and staff workflow.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
