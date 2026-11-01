import { describe, expect, it } from "vitest";
import { applyFilters, matchesText, rankAndTrim, tokenize } from "./chat-search";
import type { Doc } from "./types";

function doc(p: Partial<Doc>): Doc {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    path: p.path ?? "Other",
    title: p.title ?? "Untitled",
    category: p.category ?? "Other",
    owner: p.owner,
    doc_date: p.doc_date,
    tags: p.tags ?? [],
    storage_key: "docs/x",
    mime: "application/pdf",
    size_bytes: 1,
    uploaded_at: "2026-01-01T00:00:00.000Z",
    status: "active",
  };
}

describe("tokenize", () => {
  it("splits possessive 's into a separate dropped token", () => {
    expect(tokenize("Sister's passport")).toEqual(["sister", "passport"]);
  });
  it("drops 1-char tokens and punctuation", () => {
    expect(tokenize("a, the - 10th!")).toEqual(["the", "10th"]);
  });
  it("lowercases and splits on non-alphanumerics", () => {
    expect(tokenize("ID & Government/Passports")).toEqual([
      "id",
      "government",
      "passports",
    ]);
  });
});

describe("matchesText", () => {
  const d = doc({
    title: "Sister 10th Board Marksheet",
    owner: "Sister",
    path: "Education/Sister/Marksheets",
    tags: ["marksheet", "cbse"],
  });
  it("matches a possessive query against the owner", () => {
    expect(matchesText(d, "Sister's marksheet")).toBe(true);
  });
  it("requires all words (AND)", () => {
    expect(matchesText(d, "Sister passport")).toBe(false);
  });
  it("matches across tags", () => {
    expect(matchesText(d, "cbse")).toBe(true);
  });
});

describe("applyFilters", () => {
  const docs = [
    doc({ id: "1", category: "ID & Government", owner: "Sister", tags: ["passport"], title: "Sister Passport", path: "ID & Government/Passports" }),
    doc({ id: "2", category: "ID & Government", owner: "Mother", tags: ["passport"], title: "Mother Passport", path: "ID & Government/Passports" }),
    doc({ id: "3", category: "Education", owner: "Sister", tags: ["marksheet"], title: "Sister Marksheet", path: "Education/Sister" }),
    doc({ id: "4", category: "Medical", title: "Cardio Report", doc_date: "2026-02-18", tags: ["report"], path: "Medical/Reports" }),
  ];

  it("structured owner+tag with empty free_text returns the whole pinned set (no text gate)", () => {
    // "Sister's passports" → owner=Sister, tag=passport, free_text=""
    const out = applyFilters(docs, { owner: "Sister", tag: "passport", free_text: "" }, "Sister's passports");
    expect(out.map((d) => d.id)).toEqual(["1"]);
  });

  it("owner filter alone (no tag) returns all of that owner's docs", () => {
    const out = applyFilters(docs, { owner: "Sister" }, "Sister's documents");
    expect(out.map((d) => d.id).sort()).toEqual(["1", "3"]);
  });

  it("category + leftover free_text requires the text to match", () => {
    const out = applyFilters(docs, { category: "Medical", free_text: "report" }, "medical report");
    expect(out.map((d) => d.id)).toEqual(["4"]);
  });

  it("category + free_text: the words decide, the guessed category doesn't hide matches", () => {
    const out = applyFilters(docs, { category: "Medical", free_text: "passport" }, "medical passport");
    expect(out.map((d) => d.id).sort()).toEqual(["1", "2"]);
  });

  it("category + free_text that matches nothing returns empty", () => {
    const out = applyFilters(docs, { category: "Medical", free_text: "pension" }, "medical pension");
    expect(out).toEqual([]);
  });

  it("no-Gemini fallback (raw query as free_text) AND-matches", () => {
    const out = applyFilters(docs, { free_text: "Sister's passport" }, "Sister's passport");
    expect(out.map((d) => d.id)).toEqual(["1"]);
  });

  it("empty filters never dumps the whole vault — falls back to raw query match", () => {
    const out = applyFilters(docs, {}, "cardio");
    expect(out.map((d) => d.id)).toEqual(["4"]);
  });

  it("path_prefix matches the folder and below, not sibling prefixes", () => {
    const out = applyFilters(docs, { path_prefix: "ID & Government/Passports" }, "");
    expect(out.map((d) => d.id).sort()).toEqual(["1", "2"]);
  });

  it("date range excludes docs without a date", () => {
    const out = applyFilters(docs, { date_from: "2026-01-01", date_to: "2026-12-31" }, "");
    expect(out.map((d) => d.id)).toEqual(["4"]);
  });

  it("falls back to raw-query keyword search when a structured filter yields zero (owner mismatch)", () => {
    // Gemini guessed owner="Mum" but the vault stores "Mother" — structured pass
    // finds nothing, so the safety net retries "Mother passport" as free text.
    const out = applyFilters(
      docs,
      { owner: "Mum", tag: "passport", free_text: "" },
      "Mother passport",
    );
    expect(out.map((d) => d.id)).toEqual(["2"]);
  });

  it("does NOT fall back when a structured filter legitimately returns matches", () => {
    // owner=Mother matches doc 2; no spurious widening to other docs.
    const out = applyFilters(docs, { owner: "Mother" }, "Mother passport");
    expect(out.map((d) => d.id)).toEqual(["2"]);
  });

  it("a content-less query (all short tokens) returns nothing, not the whole vault", () => {
    // "a a a" tokenizes to [] — must not match every doc.
    const out = applyFilters(docs, { free_text: "a a a" }, "a a a");
    expect(out).toEqual([]);
  });

  it("content-less raw query with a bogus structured filter doesn't dump the vault", () => {
    const out = applyFilters(docs, { owner: "Nobody", free_text: "" }, "of of");
    expect(out).toEqual([]);
  });
});

describe("request filler words", () => {
  const d = doc({ title: "ID Card", owner: "Rushi", path: "Education/College", category: "Education" });
  it.each(["Find rushi's id", "Search for rushi's id", "show me rushi id", "Rushi's id", "rushi id"])(
    "%s matches on the meaningful words only",
    (q) => {
      expect(matchesText(d, q)).toBe(true);
      expect(applyFilters([d], { free_text: q }, q)).toHaveLength(1);
    },
  );
  it("wrong AI category falls back to keywords without the filler words", () => {
    const q = "Find rushi's id";
    expect(applyFilters([d], { category: "ID & Government", owner: "Rushi" }, q)).toHaveLength(1);
  });
  it("a guessed category doesn't hide matching docs filed elsewhere", () => {
    const aadhaar = doc({ title: "Aadhaar Card", owner: "Rushi", path: "ID & Government/Aadhaar", category: "ID & Government" });
    const res = applyFilters([d, aadhaar], { category: "ID & Government", owner: "Rushi", free_text: "id" }, "Find rushi's id");
    expect(res.map((x) => x.title).sort()).toEqual(["Aadhaar Card", "ID Card"]);
  });
  it("a category with no leftover words still filters by category", () => {
    const aadhaar = doc({ title: "Aadhaar Card", owner: "Rushi", category: "ID & Government" });
    expect(applyFilters([d, aadhaar], { category: "Education", owner: "Rushi" }, "Rushi's education documents")).toEqual([d]);
  });
  it("a query of only filler words matches nothing", () => {
    expect(matchesText(d, "find me all")).toBe(false);
  });
});

describe("matchesText empty-needle guard", () => {
  it("returns false when the query has no usable tokens", () => {
    expect(matchesText(doc({ title: "Anything" }), "a , . -")).toBe(false);
  });
});

describe("rankAndTrim", () => {
  it("ranks title hits above tag-only hits", () => {
    const docs = [
      doc({ id: "tagonly", title: "Random", tags: ["passport"] }),
      doc({ id: "titlehit", title: "Passport copy", tags: [] }),
    ];
    const out = rankAndTrim(docs, "passport");
    expect(out[0].id).toBe("titlehit");
  });

  it("caps at MAX_RESULTS", () => {
    const docs = Array.from({ length: 60 }, (_, i) =>
      doc({ id: String(i), title: `Doc ${i}` }),
    );
    expect(rankAndTrim(docs, "doc").length).toBe(50);
  });
});
