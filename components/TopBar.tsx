"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SignOutButton from "./SignOutButton";
import ThemeToggle from "./ThemeToggle";
import { useTopBarSlotContent } from "./TopBarSlot";
import BrandMark from "./BrandMark";

export default function TopBar() {
  const pathname = usePathname();
  const slot = useTopBarSlotContent();
  if (pathname === "/login") return null;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-zinc-50/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2">
        <Link
          href="/browse"
          aria-label="hermes — go to all documents"
          className="mr-auto flex items-center gap-2 rounded-lg py-1 pr-2"
          style={{ minHeight: 44 }}
        >
          <BrandMark size={28} />
          {/* With a page control in the bar (browse's view toggle), the wordmark
              only shows where there's room for both. */}
          <span
            className={`font-display text-lg font-semibold tracking-tight ${
              slot ? "hidden min-[440px]:inline" : ""
            }`}
          >
            hermes
          </span>
        </Link>
        {slot}
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}
