// Server-only Gemini client for auto-organizing uploaded documents.
//
// Given the raw file bytes (image or PDF), an optional user hint, and the
// known owners/folders already in the vault, ask Gemini 2.5 Flash to propose
// the metadata fields the confirm screen pre-fills. This is a *suggestion* —
// the user always reviews before the doc is saved, so a wrong guess is a
// minor edit, not a data-integrity problem.

import { GoogleGenAI, Type } from "@google/genai";
import { CATEGORIES, type Category } from "./types";

const MODEL = "gemini-2.5-flash";
// Cap input we send to Gemini. Above this, classification accuracy doesn't
// improve and we'd just burn quota / latency. The blob itself is already on
// Buzzheavier at full size; this only limits what we send the model.
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

export interface DocSuggestion {
  title: string;
  category: Category;
  subfolder: string;
  owner: string;
  doc_date: string; // "" or YYYY-MM-DD
  tags: string[];
}

export interface ExtractInput {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  hint?: string;
  knownOwners?: string[];
  knownPaths?: string[];
}

/** Is auto-organize configured? Lets callers skip the whole path cleanly. */
export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
  client = new GoogleGenAI({ apiKey });
  return client;
}

// Gemini can read PDFs and common image types inline. Anything else (e.g. a
// random binary) we don't send — the caller falls back to a blank confirm.
function isGeminiReadable(mime: string): boolean {
  const m = mime.split(";")[0].trim().toLowerCase();
  return (
    m === "application/pdf" ||
    m === "image/jpeg" ||
    m === "image/png" ||
    m === "image/webp" ||
    m === "image/heic" ||
    m === "image/heif"
  );
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description:
        "Short human title, e.g. 'Aarav 10th Board Marksheet 2023'. No file extension.",
    },
    category: {
      type: Type.STRING,
      enum: [...CATEGORIES],
      description: "Best-fit top-level category from the allowed list.",
    },
    subfolder: {
      type: Type.STRING,
      description:
        "Optional nested folder under the category, e.g. 'Aarav/Marksheets'. Empty string if none. Never include the category itself.",
    },
    owner: {
      type: Type.STRING,
      description:
        "Whose document this is (a person's name), if evident. Empty string if unknown. Prefer reusing a known owner name when it clearly matches.",
    },
    doc_date: {
      type: Type.STRING,
      description:
        "The date printed on the document in YYYY-MM-DD form, or empty string if none is visible. This is the document's own date, not today.",
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Up to 5 short lowercase keywords for search.",
    },
  },
  required: ["title", "category", "subfolder", "owner", "doc_date", "tags"],
};

function buildPrompt(input: ExtractInput): string {
  const owners = input.knownOwners?.filter(Boolean) ?? [];
  const paths = input.knownPaths?.filter(Boolean) ?? [];
  return [
    "You are organizing a family's document vault. Look at the attached file and propose how to file it.",
    `Allowed categories (pick exactly one): ${CATEGORIES.join(", ")}.`,
    owners.length
      ? `People already in this vault (reuse a name if it clearly matches): ${owners.join(", ")}.`
      : "",
    paths.length
      ? `Existing folders (reuse a matching sub-folder path when sensible): ${paths.slice(0, 40).join(", ")}.`
      : "",
    input.hint ? `The person uploading said: "${input.hint}".` : "",
    `Original file name: "${input.filename}".`,
    "Respond with the structured JSON only. Use empty strings for fields you cannot determine — do not guess wildly.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Coerce + clamp Gemini's raw object into a safe DocSuggestion. */
function sanitize(raw: unknown, filename: string): DocSuggestion {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  let category = str(o.category) as Category;
  if (!CATEGORIES.includes(category)) category = "Other";

  // Strip a leading category from subfolder if the model included it.
  let subfolder = str(o.subfolder).replace(/^\/+|\/+$/g, "");
  if (subfolder.toLowerCase().startsWith(category.toLowerCase() + "/")) {
    subfolder = subfolder.slice(category.length + 1);
  }

  const docDate = str(o.doc_date);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(docDate) ? docDate : "";

  const tags = Array.isArray(o.tags)
    ? Array.from(
        new Set(
          o.tags
            .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
            .filter(Boolean),
        ),
      ).slice(0, 5)
    : [];

  const title = str(o.title) || stripExt(filename);

  return {
    title,
    category,
    subfolder,
    owner: str(o.owner),
    doc_date: validDate,
    tags,
  };
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * Ask Gemini to propose metadata for one file. Returns null if auto-organize
 * isn't usable for this input (no key, unreadable mime, too large, or the API
 * failed) — the caller then shows a blank confirm screen instead.
 */
export async function extractDocMeta(
  input: ExtractInput,
): Promise<DocSuggestion | null> {
  if (!geminiConfigured()) return null;
  if (!isGeminiReadable(input.mime)) return null;
  if (input.bytes.byteLength > MAX_INLINE_BYTES) return null;

  try {
    const ai = getClient();
    const base64 = Buffer.from(input.bytes).toString("base64");
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: buildPrompt(input) },
            { inlineData: { data: base64, mimeType: input.mime } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const text = res.text;
    if (!text) return null;
    return sanitize(JSON.parse(text), input.filename);
  } catch (e) {
    console.warn(`[gemini] extractDocMeta failed: ${(e as Error).message}`);
    return null;
  }
}
