"use client";

import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { useTopBarSlotContent } from "./TopBarSlot";

export default function TopBar() {
  const pathname = usePathname();
  const slot = useTopBarSlotContent();
  if (pathname === "/login") return null;

  return (
    <div className="sticky top-0 z-30 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-3xl items-center justify-end gap-2 px-4 py-2">
        {slot}
        <ThemeToggle />
      </div>
    </div>
  );
}
