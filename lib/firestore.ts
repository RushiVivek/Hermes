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
  } catch {
    // Don't echo the parse error message — V8 quotes the offending input,
    // which here is the service-account JSON (private key included).
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is not valid JSON. If your value spans " +
        "multiple lines or contains '#'/spaces unquoted, dotenv has truncated " +
        "it. Single-quote the value or use base64.",
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

// settings() can be called only once per Firestore instance, and only before
// any read/write. Apply it the first time getDb() runs; cache the instance so
// subsequent callers reuse it.
const SETTINGS_TAG = "__hermesFirestoreSettingsApplied";
type Tagged = { [SETTINGS_TAG]?: boolean };

let cachedDb: FirebaseFirestore.Firestore | null = null;

/** Lazy Firestore accessor — called at request time, not at module import.
 * This keeps `next build` from blowing up on env-less static analysis and
 * prevents one Firestore-using route from poisoning unrelated routes. */
export function getDb(): FirebaseFirestore.Firestore {
  if (cachedDb) return cachedDb;
  const d = getFirestore(getApp());
  if (!(d as unknown as Tagged)[SETTINGS_TAG]) {
    try {
      // Drop undefined fields instead of throwing — optional doc fields like
      // `owner` and `doc_date` arrive as undefined from form data.
      d.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Tolerate races where another import touched the instance first.
    }
    (d as unknown as Tagged)[SETTINGS_TAG] = true;
  }
  cachedDb = d;
  return d;
}

export function docsCol(): FirebaseFirestore.CollectionReference {
  return getDb().collection("docs");
}

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
    storage_key: data.storage_key,
    mime: data.mime,
    size_bytes: data.size_bytes,
    uploaded_at: uploadedAt,
    uploaded_by: data.uploaded_by ?? undefined,
    status: data.status,
  };
}
