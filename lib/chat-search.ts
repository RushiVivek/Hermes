// Pure search logic for chat retrieval. Kept out of the route handler so it's
// unit-testable without spinning up Next or Firestore. The route loads active
// docs + parses the query, then hands both here.

import { isUnderPath } from "./folders";
import type { Doc } from "./types";
import type { QueryFilters } from "./gemini";

export const MAX_RESULTS = 50;

/** Tokenize for matching: lowercase, split on anything that isn't a letter or
 * digit (so the possessive in "Sister's" splits into "sister" + "s"), then drop
 * 1-char tokens (kills the stray "s", articles, punctuation noise). This makes
 * "Sister's passport" → ["sister","passport"], matching owner "Sister". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

export function matchesText(d: Doc, text: string): boolean {
  const needles = tokenize(text);
  // No usable search words (e.g. "a a a", punctuation only) → matches nothing.
  // matchesText is only called as a *gate* in filterOnce, so returning false
  // here prevents a content-less query from dumping the whole vault.
  if (needles.length === 0) return false;
  const haystack = tokenize(
    [
      d.title,
      d.owner ?? "",
      d.path,
      d.category,
      d.tags.join(" "),
      d.doc_date ?? "",
    ].join(" "),
  ).join(" ");
  // All words must appear somewhere (AND semantics).
  return needles.every((n) => haystack.includes(n));
}

function filterOnce(docs: Doc[], f: QueryFilters, rawQuery: string): Doc[] {
  // If the parser produced no usable free_text, fall back to the raw query so
  // we never return the whole vault on a content-less filter set.
  const freeText = (f.free_text ?? "").trim() || rawQuery.trim();
  const hasStructured = Boolean(
    f.category || f.owner || f.path_prefix || f.tag || f.date_from || f.date_to,
  );
  // Skip the text gate only when structured filters pinned the set AND the
  // parser left no leftover free_text of its own — e.g. "all of Sister's
  // passports" → owner+tag, return the whole set without also keyword-gating.
  const skipTextGate = hasStructured && !(f.free_text ?? "").trim();

  return docs.filter((d) => {
    if (f.category && d.category !== f.category) return false;
    if (f.owner && (d.owner ?? "").toLowerCase() !== f.owner.toLowerCase())
      return false;
    if (f.path_prefix && !isUnderPath(d.path, f.path_prefix)) return false;
    if (f.tag && !d.tags.some((t) => t.toLowerCase() === f.tag)) return false;
    if (f.date_from && (!d.doc_date || d.doc_date < f.date_from)) return false;
    if (f.date_to && (!d.doc_date || d.doc_date > f.date_to)) return false;

    if (freeText && !skipTextGate) {
      if (!matchesText(d, freeText)) return false;
    }
    return true;
  });
}

export function applyFilters(
  docs: Doc[],
  f: QueryFilters,
  rawQuery: string,
): Doc[] {
  const out = filterOnce(docs, f, rawQuery);
  // Safety net: structured filters come from Gemini and can be slightly off
  // (e.g. owner "Mum" when the vault has "Mother"), which would silently return
  // zero. If a structured query finds nothing, retry as a plain keyword search
  // over the raw query so the user still gets the obvious matches.
  const hadStructured = Boolean(
    f.category || f.owner || f.path_prefix || f.tag || f.date_from || f.date_to,
  );
  if (out.length === 0 && hadStructured && rawQuery.trim()) {
    return filterOnce(docs, { free_text: rawQuery }, rawQuery);
  }
  return out;
}

export function rankAndTrim(docs: Doc[], freeText: string): Doc[] {
  const needles = tokenize(freeText);
  const score = (d: Doc) => {
    const title = d.title.toLowerCase();
    let s = 0;
    for (const n of needles) {
      if (title.includes(n)) s += 2; // title hits weigh more
      if (d.tags.some((t) => t.toLowerCase().includes(n))) s += 1;
    }
    return s;
  };
  return [...docs]
    .sort((a, b) => {
      const d = score(b) - score(a);
      if (d !== 0) return d;
      // Stable tiebreak: most recent doc_date, then title.
      const ad = a.doc_date ?? "";
      const bd = b.doc_date ?? "";
      if (ad !== bd) return bd.localeCompare(ad);
      return a.title.localeCompare(b.title);
    })
    .slice(0, MAX_RESULTS);
}
