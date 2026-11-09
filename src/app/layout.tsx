import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AppFooter from "@/components/shared/app-footer";
import InputBehavior from "@/components/shared/input-behavior";
import PwaControls from "@/components/shared/pwa-controls";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hirad Accounting",
  description: "سیستم مدیریت مالی و حسابداری",
  applicationName: "Hirad Accounting",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Hirad Accounting",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <InputBehavior>
          <PwaControls />
          {children}
          <AppFooter />
        </InputBehavior>
      </body>
    </html>
  );
}
