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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void search(q);
  }

  async function search(raw: string) {
    const query = raw.trim();
    if (!query || busy) return;
    setQ(query);
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
        setError(data.error ?? `Search failed (${res.status}). Please try again.`);
        return;
      }
      setResp(data);
    } catch {
      setError("Couldn't reach hermes. Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-3xl flex-col px-4 py-6">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold">Find a document</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Ask in plain words, like you would ask a person.
        </p>

        {/* Tappable examples: a starting point for anyone unsure what to type. */}
        {!resp && !busy && (
          <div className="mt-5">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Try one of these</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    onClick={() => void search(ex)}
                    className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 transition-colors hover:border-primary hover:bg-primary-soft active:bg-primary-soft dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    style={{ minHeight: 44 }}
                  >
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {busy && <ResultsSkeleton />}

        {resp && !busy && (
          <div className="mt-5">
            {/* Gemini was unreachable, so the server did a plain keyword match:
                every word must appear in the document's name, owner, folder or
                tags. Say so, or a miss looks like the document isn't there. */}
            {!resp.usedAI && (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-medium">Smart search is unavailable right now.</span>{" "}
                Only exact words are matched, so use words from the document&apos;s name, owner or
                folder, like &ldquo;Mother passport&rdquo;.
              </p>
            )}
            {resp.results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p role="status" className="text-zinc-700 dark:text-zinc-300">
                  Nothing matched. {resp.explain}
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Try fewer words, or look through the folders.
                </p>
                <Link
                  href="/browse"
                  className="mt-4 inline-flex items-center rounded-xl border border-zinc-300 px-4 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  style={{ minHeight: 44 }}
                >
                  Browse all folders
                </Link>
              </div>
            ) : (
              <>
                <p role="status" className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {resp.truncated
                    ? `Showing first ${resp.results.length} of ${resp.total}`
                    : `${resp.results.length} ${resp.results.length === 1 ? "result" : "results"}`}
                </p>
                <ul className="mt-2 space-y-3 pb-4">
                  {resp.results.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/browse/d/${d.id}`}
                        className="block rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:active:bg-zinc-800"
                      >
                        <p className="truncate font-medium">{d.title}</p>
                        <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
                          {d.path}
                          {d.owner ? ` · ${d.owner}` : ""}
                          {d.doc_date ? ` · ${d.doc_date}` : ""}
                        </p>
                        {d.tags.length > 0 && (
                          <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
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
      <form
        onSubmit={onSubmit}
        role="search"
        className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] mt-4"
      >
        <div className="flex gap-2">
          <label htmlFor="find" className="sr-only">
            What are you looking for?
          </label>
          <input
            id="find"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Grandpa's pension papers"
            enterKeyHint="search"
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
            style={{ minHeight: 52 }}
          />
          <button
            type="submit"
            disabled={busy || q.trim() === ""}
            aria-busy={busy}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
            style={{ minHeight: 52 }}
          >
            {busy ? "Looking…" : "Find"}
          </button>
        </div>
      </form>
    </div>
  );
}

const EXAMPLES = ["Our passports", "10th marksheet", "Health insurance", "Property papers"];

function ResultsSkeleton() {
  return (
    <div className="mt-5 space-y-3" aria-busy="true" aria-label="Searching">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[76px] animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        />
      ))}
    </div>
  );
}
