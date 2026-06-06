"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteButton({
  docId,
  parentPath,
  title,
}: {
  docId: string;
  parentPath: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? `Delete failed (${res.status})`);
        return;
      }
      const url = parentPath
        ? `/browse?path=${encodeURIComponent(parentPath)}`
        : "/browse";
      router.push(url);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 active:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:active:bg-red-950"
        style={{ minHeight: 44 }}
      >
        <TrashIcon /> {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="m6 6 1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </svg>
  );
}
