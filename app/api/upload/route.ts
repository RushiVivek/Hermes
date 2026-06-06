import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { docsCol } from "@/lib/firestore";
import { uploadFile, deleteFile } from "@/lib/buzzheavier";
import { CATEGORIES, type Category } from "@/lib/types";

export const runtime = "nodejs";

interface UploadResultItem {
  id: string;
  title: string;
  path: string;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  }

  const category = String(form.get("category") ?? "").trim();
  if (!CATEGORIES.includes(category as Category)) {
    return NextResponse.json(
      { error: `Invalid category. Must be one of: ${CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  const subfolder = String(form.get("subfolder") ?? "").trim().replace(/^\/+|\/+$/g, "");
  const owner = String(form.get("owner") ?? "").trim() || undefined;
  const docDate = String(form.get("doc_date") ?? "").trim() || undefined;
  const tagsRaw = String(form.get("tags") ?? "").trim();
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const path = subfolder ? `${category}/${subfolder}` : category;

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const created: UploadResultItem[] = [];
  const errors: { filename: string; error: string }[] = [];

  for (const file of files) {
    const filename = file.name || "untitled";
    let blob: { buzzheavier_id: string; buzzheavier_url: string; buzzheavier_account_id: string };
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      blob = await uploadFile({
        bytes: buf,
        filename,
        mime: file.type || "application/octet-stream",
      });
    } catch (e) {
      errors.push({ filename, error: (e as Error).message });
      continue;
    }

    try {
      const ref = docsCol.doc();
      const title = stripExtension(filename);
      await ref.set({
        path,
        title,
        category,
        owner,
        doc_date: docDate,
        tags,
        buzzheavier_id: blob.buzzheavier_id,
        buzzheavier_url: blob.buzzheavier_url,
        buzzheavier_account_id: blob.buzzheavier_account_id,
        mime: file.type || "application/octet-stream",
        size_bytes: file.size,
        uploaded_at: Timestamp.now(),
        status: "active",
      });
      created.push({ id: ref.id, title, path });
    } catch (e) {
      // Best-effort: clean up the orphaned blob so storage doesn't drift.
      void deleteFile({
        buzzheavier_id: blob.buzzheavier_id,
        buzzheavier_account_id: blob.buzzheavier_account_id,
      }).catch(() => {});
      errors.push({ filename, error: `Firestore write failed: ${(e as Error).message}` });
    }
  }

  return NextResponse.json({ created, errors });
}

function stripExtension(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0) return name;
  return name.slice(0, i);
}
