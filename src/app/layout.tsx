import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PlanProvider } from "@/contexts/PlanContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "networth.online – Know Where Your Money Actually Goes",
    template: "%s | networth.online",
  },
  description:
    "Upload your bank statement PDF and instantly see your net worth, spending breakdown, savings rate, and AI-powered insights. No bank login. Any Canadian bank. Under 60 seconds.",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg", // replace with a 180×180 PNG when available
  },
  metadataBase: new URL("https://networth.online"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PlanProvider>
          {children}
        </PlanProvider>
      </body>
    </html>
  );
}
