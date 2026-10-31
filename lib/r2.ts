// Server-only Cloudflare R2 client (S3-compatible API).
//
// Every blob lives at  docs/{firestoreDocId}  in a single private bucket. The
// key never contains the user's filename, so there's nothing to sanitize and
// no path-traversal surface. The bucket is never public: single-file
// downloads redirect to a short-lived signed URL minted by an authed route,
// and ZIP export reads blobs server-side.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** R2's free tier is 10 GB-month of storage. Uploads are refused past 9 GB so
 * the vault can never start billing. Usage is the sum of `size_bytes` over
 * active + pending_confirm docs in Firestore (see app/api/upload/route.ts). */
export const STORAGE_CAP_BYTES = 9 * 1000 * 1000 * 1000;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} env var is required (Cloudflare R2).`);
  return v;
}

let client: S3Client | null = null;

/** Lazy, like getDb() — so `next build` doesn't need real credentials. */
function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto", // required by the SDK, ignored by R2
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

function bucket(): string {
  return requireEnv("R2_BUCKET");
}

export function storageKey(docId: string): string {
  return `docs/${docId}`;
}

export async function putObject(
  key: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: bytes,
      ContentType: mime || "application/octet-stream",
    }),
  );
}

/** How long a signed download link works. Short: it's minted per click, and
 * anyone holding the URL can use it until then. */
const SIGNED_URL_TTL_SECONDS = 5 * 60;

/** A short-lived signed GET link, so the browser downloads straight from R2
 * (free egress, no trip through our server). The response headers are fixed
 * by the signature, so the caller decides the served type and disposition. */
export async function signedDownloadUrl(
  key: string,
  opts: { contentType: string; contentDisposition: string },
): Promise<string> {
  return await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: opts.contentDisposition,
    }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  if (!res.Body) throw new Error(`R2 object ${key} has no body.`);
  return await res.Body.transformToByteArray();
}

/** Idempotent: R2 returns success for a key that doesn't exist. Throws on a
 * real failure (auth, network) so callers can report it. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
