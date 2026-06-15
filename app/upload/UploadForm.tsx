"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/format";

interface Props {
  categories: string[];
  aiAvailable: boolean;
}

interface Suggestion {
  title: string;
  category: string;
  subfolder: string;
  owner: string;
  doc_date: string;
  tags: string[];
}

interface PendingDoc {
  id: string;
  // editable fields, seeded from the server's suggestion
  title: string;
  category: string;
  subfolder: string;
  owner: string;
  doc_date: string;
  tags: string; // comma-joined for the input
}

export default function UploadForm({ categories, aiAvailable }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [autoOrganize, setAutoOrganize] = useState(aiAvailable);
  const [category, setCategory] = useState(categories[0]);
  const [subfolder, setSubfolder] = useState("");
  const [owner, setOwner] = useState("");
  const [docDate, setDocDate] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // When an auto-organize upload returns, we switch to the confirm phase.
  const [pending, setPending] = useState<PendingDoc[] | null>(null);

  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Whole-page drop target while dragging — desktop affordance. Disabled in
  // the confirm phase (files are already uploaded).
  useEffect(() => {
    if (pending) return;
    let depth = 0;
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      if (busyRef.current) return;
      depth++;
      setDragOver(true);
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    }
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      depth = 0;
      setDragOver(false);
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [pending]);

  function addFiles(incoming: File[]) {
    if (busyRef.current) return;
    setFiles((prev) => {
      const key = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;
      const seen = new Set(prev.map(key));
      const fresh = incoming.filter((f) => !seen.has(key(f)));
      return [...prev, ...fresh];
    });
  }

  function pickFromInput(input: HTMLInputElement | null) {
    if (!input) return;
    if (input.files) addFiles(Array.from(input.files));
    input.value = "";
  }

  function removeFile(idx: number) {
    if (busyRef.current) return;
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (files.length === 0) {
      setError("Pick at least one file.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      if (autoOrganize) {
        fd.set("autoOrganize", "1");
      } else {
        fd.set("category", category);
        fd.set("subfolder", subfolder.trim());
        if (owner.trim()) fd.set("owner", owner.trim());
        if (docDate) fd.set("doc_date", docDate);
        if (tags.trim()) fd.set("tags", tags.trim());
      }
      for (const f of files) fd.append("files", f);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data: {
        created?: {
          index: number;
          id: string;
          path: string;
          suggestion?: Suggestion;
          pending?: boolean;
        }[];
        errors?: { index: number; filename: string; error: string }[];
        autoOrganize?: boolean;
        error?: string;
      } = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`);
        setBusy(false);
        return;
      }

      const created = data.created ?? [];
      const errs = data.errors ?? [];

      if (errs.length > 0 && created.length === 0) {
        setError(errs.map((x) => `${x.filename}: ${x.error}`).join("\n"));
        setBusy(false);
        return;
      }

      // Auto-organize: move to the confirm phase with editable per-file rows.
      if (data.autoOrganize) {
        const rows: PendingDoc[] = created.map((c) => ({
          id: c.id,
          title: c.suggestion?.title ?? "",
          category: c.suggestion?.category ?? categories[0],
          subfolder: c.suggestion?.subfolder ?? "",
          owner: c.suggestion?.owner ?? "",
          doc_date: c.suggestion?.doc_date ?? "",
          tags: (c.suggestion?.tags ?? []).join(", "),
        }));
        setPending(rows);
        setFiles([]);
        setBusy(false);
        if (errs.length > 0) {
          setError(
            `${errs.length} file(s) failed to upload and are not shown below:\n` +
              errs.map((x) => `${x.filename}: ${x.error}`).join("\n"),
          );
        }
        return;
      }

      // Manual mode: handle partial failure, else navigate to the folder.
      if (errs.length > 0) {
        const failedIndices = new Set(errs.map((x) => x.index));
        setFiles((prev) => prev.filter((_, i) => failedIndices.has(i)));
        setError(
          `Uploaded ${created.length} of ${created.length + errs.length}. ` +
            `Failed:\n` +
            errs.map((x) => `${x.filename}: ${x.error}`).join("\n"),
        );
        setBusy(false);
        return;
      }

      const path =
        created[0]?.path ?? (subfolder ? `${category}/${subfolder}` : category);
      router.push(path ? `/browse?path=${encodeURIComponent(path)}` : "/browse");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <ConfirmPhase
        categories={categories}
        rows={pending}
        setRows={setPending}
        error={error}
        setError={setError}
        onDone={(path) => {
          router.push(path ? `/browse?path=${encodeURIComponent(path)}` : "/browse");
          router.refresh();
        }}
        onCancelToPick={() => {
          setPending(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Add documents</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Take a photo or pick files. You can add many at once.
      </p>

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40">
          <div className="rounded-2xl border-4 border-dashed border-white/80 bg-white/10 p-10 text-center text-lg font-medium text-white">
            Drop files to add
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-4 font-medium active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
            style={{ minHeight: 56 }}
          >
            <CameraIcon /> Take photo
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-4 font-medium active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
            style={{ minHeight: 56 }}
          >
            <FileIcon /> Choose files
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => pickFromInput(e.target)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => pickFromInput(e.target)}
        />

        {files.length > 0 && (
          <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-200 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <span className="text-xs text-zinc-500">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="rounded p-2 text-zinc-500 active:bg-zinc-100 dark:active:bg-zinc-800"
                  aria-label="Remove"
                >
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
        )}

        {aiAvailable && (
          <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <input
              type="checkbox"
              checked={autoOrganize}
              onChange={(e) => setAutoOrganize(e.target.checked)}
              className="h-5 w-5"
            />
            <span className="flex-1 text-sm">
              <span className="font-medium">Auto-organize with AI</span>
              <span className="block text-xs text-zinc-500">
                Reads each file and suggests a title, folder, owner & date for you
                to review before saving.
              </span>
            </span>
          </label>
        )}

        {!autoOrganize && (
          <fieldset className="space-y-4">
            <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Where to file these
            </legend>

            <label className="block">
              <span className="text-sm">Folder</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
                style={{ minHeight: 48 }}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm">Sub-folder (optional)</span>
              <input
                type="text"
                value={subfolder}
                onChange={(e) => setSubfolder(e.target.value)}
                placeholder="e.g. Aarav/Marksheets/2024"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
                style={{ minHeight: 48 }}
              />
              <span className="mt-1 block text-xs text-zinc-500">
                Use “/” to nest folders as deep as you like.
              </span>
            </label>

            <label className="block">
              <span className="text-sm">Who it belongs to (optional)</span>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. Mom"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
                style={{ minHeight: 48 }}
              />
            </label>

            <label className="block">
              <span className="text-sm">Date on document (optional)</span>
              <input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
                style={{ minHeight: 48 }}
              />
            </label>

            <label className="block">
              <span className="text-sm">Tags (optional, comma-separated)</span>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g. passport, id"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
                style={{ minHeight: 48 }}
              />
            </label>
          </fieldset>
        )}

        {error && (
          <pre className="whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </pre>
        )}

        <button
          type="submit"
          disabled={busy || files.length === 0}
          className="w-full rounded-xl bg-zinc-950 py-4 text-base font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
          style={{ minHeight: 56 }}
        >
          {busy
            ? autoOrganize
              ? `Reading ${files.length}…`
              : `Uploading ${files.length}…`
            : files.length === 0
              ? "Pick files to upload"
              : autoOrganize
                ? `Upload & organize ${files.length} ${files.length === 1 ? "file" : "files"}`
                : `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ConfirmProps {
  categories: string[];
  rows: PendingDoc[];
  setRows: (r: PendingDoc[]) => void;
  error: string | null;
  setError: (e: string | null) => void;
  onDone: (firstPath: string) => void;
  onCancelToPick: () => void;
}

function ConfirmPhase({
  categories,
  rows,
  setRows,
  error,
  setError,
  onDone,
  onCancelToPick,
}: ConfirmProps) {
  const [busy, setBusy] = useState(false);

  function patch(id: string, field: keyof PendingDoc, value: string) {
    setRows(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const items = rows.map((r) => ({
        id: r.id,
        title: r.title.trim(),
        category: r.category,
        subfolder: r.subfolder.trim(),
        owner: r.owner.trim(),
        doc_date: r.doc_date.trim(),
        tags: r.tags.split(",").map((t) => t.trim()).filter(Boolean),
      }));
      const missingTitle = items.find((i) => !i.title);
      if (missingTitle) {
        setError("Every document needs a title.");
        setBusy(false);
        return;
      }
      const res = await fetch("/api/docs/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data: {
        confirmed?: string[];
        skipped?: { id: string; reason: string }[];
        error?: string;
      } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status})`);
        setBusy(false);
        return;
      }
      // Some rows may have been skipped server-side (validation, or the doc is
      // no longer pending). Keep only the still-unsaved rows and surface why,
      // rather than navigating away as if everything saved.
      const skipped = data.skipped ?? [];
      if (skipped.length > 0) {
        const skippedIds = new Set(skipped.map((s) => s.id));
        setRows(rows.filter((r) => skippedIds.has(r.id)));
        setError(
          `Saved ${data.confirmed?.length ?? 0}. Couldn't save ${skipped.length}:\n` +
            skipped.map((s) => `• ${s.reason}`).join("\n"),
        );
        setBusy(false);
        return;
      }
      const first = items[0];
      const path = first.subfolder
        ? `${first.category}/${first.subfolder}`
        : first.category;
      onDone(path);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function discardAll() {
    if (!window.confirm("Discard these uploads? They won't be saved.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/docs/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: rows.map((r) => r.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          (data as { error?: string }).error ??
            `Couldn't discard (${res.status}). The drafts are still there — try again.`,
        );
        setBusy(false);
        return;
      }
      onCancelToPick();
    } catch (e) {
      setError(`Couldn't discard: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Review &amp; save</h1>
      <p className="mt-1 text-sm text-zinc-500">
        AI suggested these. Edit anything that&apos;s off, then save.
      </p>

      {error && (
        <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </pre>
      )}

      <div className="mt-5 space-y-4">
        {rows.map((r) => (
          <div
            key={r.id}
            className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <label className="block">
              <span className="text-xs text-zinc-500">Title</span>
              <input
                value={r.title}
                onChange={(e) => patch(r.id, "title", e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
                style={{ minHeight: 44 }}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-zinc-500">Folder</span>
                <select
                  value={r.category}
                  onChange={(e) => patch(r.id, "category", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2.5 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
                  style={{ minHeight: 44 }}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">Sub-folder</span>
                <input
                  value={r.subfolder}
                  onChange={(e) => patch(r.id, "subfolder", e.target.value)}
                  placeholder="optional"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
                  style={{ minHeight: 44 }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-zinc-500">Who it belongs to</span>
                <input
                  value={r.owner}
                  onChange={(e) => patch(r.id, "owner", e.target.value)}
                  placeholder="optional"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
                  style={{ minHeight: 44 }}
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">Date on document</span>
                <input
                  type="date"
                  value={r.doc_date}
                  onChange={(e) => patch(r.id, "doc_date", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
                  style={{ minHeight: 44 }}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-zinc-500">Tags (comma-separated)</span>
              <input
                value={r.tags}
                onChange={(e) => patch(r.id, "tags", e.target.value)}
                placeholder="optional"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
                style={{ minHeight: 44 }}
              />
            </label>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={discardAll}
          disabled={busy}
          className="flex-1 rounded-xl border border-zinc-300 py-3.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          style={{ minHeight: 52 }}
        >
          Discard
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex-[2] rounded-xl bg-zinc-950 py-3.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
          style={{ minHeight: 52 }}
        >
          {busy ? "Saving…" : `Save ${rows.length} ${rows.length === 1 ? "document" : "documents"}`}
        </button>
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M3 7h3l2-2h8l2 2h3v12H3V7Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
