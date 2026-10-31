"use client";

import { useState } from "react";
import Link from "next/link";
import { formatBytes } from "@/lib/format";
import type { Doc } from "@/lib/types";

interface ChatResponse {
  results: Doc[];
  explain: string;
  usedAI: boolean;
  total?: number;
  truncated?: boolean;
  error?: string;
}

export default function ChatView() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = haven't searched yet; otherwise the last response.
  const [resp, setResp] = useState<ChatResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      const data: ChatResponse = await res.json().catch(() => ({
        results: [],
        explain: "",
        usedAI: false,
      }));
      if (!res.ok) {
        setError(data.error ?? `Search failed (${res.status})`);
        return;
      }
      setResp(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-3xl flex-col px-4 py-6">
      <div className="flex-1">
        <h1 className="text-xl font-semibold">Find a document</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Ask in plain words — e.g. “10th marksheet” or “our passports”.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {resp && (
          <div className="mt-5">
            {resp.results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Nothing matched. {resp.explain}
                </p>
                <Link
                  href="/browse"
                  className="mt-3 inline-block rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
                >
                  Browse all folders
                </Link>
              </div>
            ) : (
              <>
                <p className="px-1 text-xs text-zinc-500">
                  {resp.truncated
                    ? `Showing first ${resp.results.length} of ${resp.total}`
                    : `${resp.results.length} ${resp.results.length === 1 ? "result" : "results"}`}
                </p>
                <ul className="mt-2 space-y-3 pb-4">
                  {resp.results.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/browse/d/${d.id}`}
                        className="block rounded-xl border border-zinc-200 bg-white p-4 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
                      >
                        <p className="truncate font-medium">{d.title}</p>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {d.path}
                          {d.owner ? ` · ${d.owner}` : ""}
                          {d.doc_date ? ` · ${d.doc_date}` : ""}
                        </p>
                        {d.tags.length > 0 && (
                          <p className="mt-1 truncate text-xs text-zinc-400">
                            {d.tags.map((t) => `#${t}`).join(" ")}
                          </p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {/* Query box pinned at the bottom, above the keyboard / bottom nav. */}
      <form onSubmit={onSubmit} className="sticky bottom-20 mt-4">
        <div className="flex gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask for a document…"
            enterKeyHint="search"
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
            style={{ minHeight: 48 }}
          />
          <button
            type="submit"
            disabled={busy || q.trim() === ""}
            className="rounded-xl bg-zinc-950 px-5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
            style={{ minHeight: 48 }}
          >
            {busy ? "…" : "Find"}
          </button>
        </div>
      </form>
    </div>
  );
}
