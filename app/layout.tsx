import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Timekeeping",
  description: "Time entry and approval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
