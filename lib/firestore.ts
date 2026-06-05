import {
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { Doc } from "./types";

function loadServiceAccount(): ServiceAccount {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT env var is required. Paste the entire " +
        "service-account JSON as the value (single-quote it in .env.local " +
        "so dotenv doesn't truncate at spaces or '#').",
    );
  }
  // Tolerate base64-encoded values (handy for Vercel — paste without escaping
  // worries). We sniff: a JSON value always starts with `{`; if not, try base64.
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    try {
      raw = Buffer.from(trimmed, "base64").toString("utf8");
    } catch {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT must be either the JSON object or a " +
          "base64-encoded JSON object.",
      );
    }
  } else {
    raw = trimmed;
  }

  let parsed: { project_id: string; client_email: string; private_key: string };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${(e as Error).message}. ` +
        `If your value spans multiple lines or contains '#'/spaces unquoted, ` +
        `dotenv has truncated it. Single-quote the value or use base64.`,
    );
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email, or private_key.",
    );
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

function getApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({ credential: cert(loadServiceAccount()) });
}

export const db = getFirestore(getApp());
export const docsCol = db.collection("docs");

export function fromFirestore(id: string, data: FirebaseFirestore.DocumentData): Doc {
  const uploadedAt =
    data.uploaded_at instanceof Timestamp
      ? data.uploaded_at.toDate().toISOString()
      : (data.uploaded_at ?? new Date(0).toISOString());
  return {
    id,
    path: data.path,
    title: data.title,
    category: data.category,
    owner: data.owner ?? undefined,
    doc_date: data.doc_date ?? undefined,
    tags: data.tags ?? [],
    buzzheavier_id: data.buzzheavier_id,
    buzzheavier_url: data.buzzheavier_url,
    buzzheavier_account_id: data.buzzheavier_account_id,
    mime: data.mime,
    size_bytes: data.size_bytes,
    uploaded_at: uploadedAt,
    uploaded_by: data.uploaded_by ?? undefined,
    status: data.status,
  };
}
