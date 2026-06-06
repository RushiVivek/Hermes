"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Slot = React.ReactNode;

interface SlotState {
  node: Slot;
  setNode: (n: Slot) => void;
}

const Ctx = createContext<SlotState | null>(null);

export function TopBarSlotProvider({ children }: { children: React.ReactNode }) {
  const [node, setNode] = useState<Slot>(null);
  return <Ctx.Provider value={{ node, setNode }}>{children}</Ctx.Provider>;
}

/**
 * Render `node` into the global top bar slot for the lifetime of the caller.
 */
export function useTopBarSlot(node: Slot) {
  const ctx = useContext(Ctx);
  useEffect(() => {
    ctx?.setNode(node);
    return () => ctx?.setNode(null);
  }, [ctx, node]);
}

export function useTopBarSlotContent(): Slot {
  return useContext(Ctx)?.node ?? null;
}
