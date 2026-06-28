import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANSEM Airdrop Tracker",
  description: "Track Solana airdrop recipients and wallet behavior after distribution."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
