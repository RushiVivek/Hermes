export const CATEGORIES = [
  "Education",
  "ID & Government",
  "Medical",
  "Finance",
  "Property",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type DocStatus = "pending_confirm" | "active" | "deleted";

export interface Doc {
  id: string;
  path: string;
  title: string;
  category: Category;
  owner?: string;
  doc_date?: string;
  tags: string[];
  buzzheavier_id: string;
  buzzheavier_url: string;
  buzzheavier_account_id: string;
  mime: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by?: string;
  status: DocStatus;
}
