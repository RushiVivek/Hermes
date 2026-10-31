export const CATEGORIES = [
  "Education",
  "ID & Government",
  "Medical",
  "Finance",
  "Property",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Per-upload-request limits, shared by the upload route and form. The route
 * holds the whole request in memory (2–3 copies while parsing), and Render's
 * free instance has 512 MB of RAM — so ~100 MB per batch is the safe ceiling. */
export const MAX_UPLOAD_FILES = 25;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export type DocStatus = "pending_confirm" | "active" | "deleted";

export interface Doc {
  id: string;
  path: string;
  title: string;
  category: Category;
  owner?: string;
  doc_date?: string;
  tags: string[];
  /** R2 object key (see lib/r2.ts storageKey). */
  storage_key: string;
  mime: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by?: string;
  status: DocStatus;
}
