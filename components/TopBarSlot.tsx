"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Slot = React.ReactNode;

interface SlotState {
  node: Slot;
  setNode: (n: Slot) => void;
}

const Ctx = createContext<SlotState | null>(null);

export function TopBarSlotProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = useState<Slot>(null);
  // Stable value; setNode from useState is already stable, so memoizing on
  // [node] alone is enough to avoid re-rendering consumers when nothing changed.
  const value = useMemo(() => ({ node, setNode }), [node]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Render `node` into the global top bar slot for the lifetime of the caller.
 */
export function useTopBarSlot(node: Slot) {
  const ctx = useContext(Ctx);
  // Depending on `ctx` would re-fire this effect on every Provider render,
  // which combined with the cleanup `setNode(null)` produces an infinite
  // loop. We only need to react to `node` changes; `ctx.setNode` is stable.
  useEffect(() => {
    ctx?.setNode(node);
    return () => ctx?.setNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
}

export function useTopBarSlotContent(): Slot {
  return useContext(Ctx)?.node ?? null;
}
