import type { Metadata, Viewport } from "next";
import { Lexend, Source_Sans_3 } from "next/font/google";
import BottomNav from "@/components/BottomNav";
import TopBar from "@/components/TopBar";
import { TopBarSlotProvider } from "@/components/TopBarSlot";
import { themeBootstrapScript } from "@/lib/theme";
import "./globals.css";

// Lexend for headings (designed for reading ease) + Source Sans 3 for body
// text. next/font self-hosts them at build time — no runtime Google request.
const lexend = Lexend({ variable: "--font-lexend", subsets: ["latin"], display: "swap" });
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "hermes",
  description: "Family document vault",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled: family members zoom into scanned documents and
  // small print. "cover" lets the bottom nav pad itself clear of the iPhone
  // home indicator via env(safe-area-inset-bottom).
  viewportFit: "cover",
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
    <html lang="en" className={`${lexend.variable} ${sourceSans.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 font-sans text-[17px] leading-relaxed dark:bg-zinc-950">
        <TopBarSlotProvider>
          <TopBar />
          {/* Bottom padding clears the fixed nav plus the iPhone home indicator. */}
          <main id="main" className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
            {children}
          </main>
        </TopBarSlotProvider>
        <BottomNav />
      </body>
    </html>
  );
}
