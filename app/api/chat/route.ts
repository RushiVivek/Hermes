import { NextResponse } from "next/server";
import { docsCol, fromFirestore } from "@/lib/firestore";
import { parseQuery } from "@/lib/gemini";
import { applyFilters, rankAndTrim } from "@/lib/chat-search";
import type { Doc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/chat — natural-language retrieval over document metadata.
 * Body: { q: string }.
 *
 * Pipeline: Gemini turns the query into structured filters → we load active
 * docs → apply filters + free-text substring in memory → rank → return cards.
 * If Gemini is unavailable, we fall back to a plain substring search over the
 * whole query string so the box still works.
 */
export async function POST(req: Request) {
  let body: { q?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (!q) {
    return NextResponse.json({ error: "Empty query." }, { status: 400 });
  }

  // Load active docs once (family-scale: low hundreds, one cheap read).
  const snap = await docsCol().where("status", "==", "active").get();
  const docs = snap.docs.map((d) => fromFirestore(d.id, d.data()));

  // Context for the parser: distinct owners + paths help it map names/folders.
  const owners = new Set<string>();
  const paths = new Set<string>();
  for (const d of docs) {
    if (d.owner) owners.add(d.owner);
    if (d.path) paths.add(d.path);
  }

  const parsed = await parseQuery(q, {
    owners: [...owners],
    paths: [...paths],
  });

  let results: Doc[];
  let explain: string;
  const usedAI = parsed !== null;

  if (parsed) {
    results = applyFilters(docs, parsed.filters, q);
    explain = parsed.explain;
  } else {
    results = applyFilters(docs, { free_text: q }, q);
    explain = `Searched for "${q}".`;
  }

  const matchedCount = results.length;
  results = rankAndTrim(results, parsed?.filters.free_text ?? q);

  // `truncated` lets the UI tell the user we capped the list rather than
  // silently dropping matches past MAX_RESULTS.
  return NextResponse.json({
    results,
    explain,
    usedAI,
    total: matchedCount,
    truncated: matchedCount > results.length,
  });
}
