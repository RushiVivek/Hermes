// The file types hermes stores. Enforced server-side on upload: the client's
// `accept` filter is only a convenience. Anything else (notably SVG or HTML)
// could run script if a browser rendered it inline from our origin.

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function baseMime(mime: string): string {
  return (mime || "").split(";")[0].trim().toLowerCase();
}

export function isAllowedMime(mime: string): boolean {
  return baseMime(mime) in EXT_BY_MIME;
}

/** ".pdf", ".jpg", … or "" for an unknown type. */
export function extFromMime(mime: string): string {
  return EXT_BY_MIME[baseMime(mime)] ?? "";
}
