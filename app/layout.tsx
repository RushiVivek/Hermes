import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import BottomNav from "@/components/BottomNav";
import TopBar from "@/components/TopBar";
import { TopBarSlotProvider } from "@/components/TopBarSlot";
import { themeBootstrapScript } from "@/lib/theme";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "hermes",
  description: "Family document vault",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Match the body bg in each scheme so mobile Chrome / Safari address-bar
  // tint doesn't visibly seam against the page background.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950">
        <TopBarSlotProvider>
          <TopBar />
          <main className="flex-1 pb-20">{children}</main>
        </TopBarSlotProvider>
        <BottomNav />
      </body>
    </html>
  );
}
