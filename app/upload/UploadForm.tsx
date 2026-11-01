"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/format";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "@/lib/types";

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
  // A short, dismissable note about what got skipped on the last add (wrong
  // type, etc.) — distinct from the hard `error` (which blocks the form).
  const [notice, setNotice] = useState<string | null>(null);

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
    async function onDrop(e: DragEvent) {
      depth = 0;
      setDragOver(false);
      if (!e.dataTransfer) return;
      e.preventDefault();
      if (busyRef.current) return;
      // Prefer the entry API so dropped *folders* are walked recursively;
      // fall back to the flat file list when entries aren't exposed.
      const items = e.dataTransfer.items;
      let collected: File[];
      if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
        collected = await filesFromDataTransferItems(items);
      } else {
        collected = Array.from(e.dataTransfer.files);
      }
      addFiles(collected);
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

  // Paste-to-upload: a copied screenshot / image lands straight in the list.
  useEffect(() => {
    if (pending) return;
    function onPaste(e: ClipboardEvent) {
      if (busyRef.current) return;
      // Don't hijack a paste aimed at a text field (sub-folder / owner / tags).
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            // Pasted images often have no name — give them one.
            const ext = f.type.split("/")[1] || "png";
            imgs.push(
              f.name
                ? f
                : new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type }),
            );
          }
        }
      }
      if (imgs.length) {
        e.preventDefault();
        addFiles(imgs);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pending]);

  function addFiles(incoming: File[]) {
    if (busyRef.current) return;
    // Only images + PDFs are storable; the picker's `accept` doesn't gate
    // drops/pastes, so filter here and tell the user what we skipped.
    const accepted = incoming.filter(isAcceptedFile);
    const rejected = incoming.length - accepted.length;
    setNotice(
      rejected > 0
        ? `Skipped ${rejected} file${rejected === 1 ? "" : "s"} — only images and PDFs can be added.`
        : null,
    );
    if (accepted.length === 0) return;
    setFiles((prev) => {
      const key = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;
      const seen = new Set(prev.map(key));
      const fresh = accepted.filter((f) => !seen.has(key(f)));
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
    // Same limits the server enforces — checked here so an oversized batch
    // fails instantly instead of after the whole upload.
    if (files.length > MAX_UPLOAD_FILES) {
      setError(`That's ${files.length} files — upload at most ${MAX_UPLOAD_FILES} at a time.`);
      return;
    }
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    if (totalBytes > MAX_UPLOAD_BYTES) {
      setError(
        `These files add up to ${formatBytes(totalBytes)} — upload at most ` +
          `${formatBytes(MAX_UPLOAD_BYTES)} at a time. Remove some and try again.`,
      );
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
      <h1 className="text-2xl font-semibold">Add documents</h1>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        Take a photo, pick files, drag a file or folder in, or paste an image.
      </p>

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-4 border-dashed border-white/80 bg-white/10 px-12 py-10 text-center text-white">
            <DropIcon />
            <span className="text-lg font-medium">Drop to add</span>
            <span className="text-sm text-white/80">Images, PDFs, or a whole folder</span>
          </div>
        </div>
      )}

      {notice && (
        <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {notice}
        </p>
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
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 py-1.5 pl-4 pr-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  aria-label={`Remove ${f.name}`}
                >
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length > 0 && <BatchSize files={files} />}

        {aiAvailable && (
          <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <input
              type="checkbox"
              checked={autoOrganize}
              onChange={(e) => setAutoOrganize(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
            <span className="flex-1 text-sm">
              <span className="font-medium">Auto-organize with AI</span>
              <span className="block text-sm text-zinc-600 dark:text-zinc-400">
                Reads each file and suggests a title, folder, owner & date for you
                to review before saving.
              </span>
            </span>
          </label>
        )}

        {!autoOrganize && (
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Where to file these
            </legend>

            <label className="block">
              <span className="text-sm">Folder</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
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
                placeholder="e.g. Marksheets/2024"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
                style={{ minHeight: 48 }}
              />
              <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">
                Use “/” to nest folders as deep as you like.
              </span>
            </label>

            <label className="block">
              <span className="text-sm">Who it belongs to (optional)</span>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. Mother"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
                style={{ minHeight: 48 }}
              />
            </label>

            <label className="block">
              <span className="text-sm">Date on document (optional)</span>
              <input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
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
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-900"
                style={{ minHeight: 48 }}
              />
            </label>
          </fieldset>
        )}

        {error && (
          <pre role="alert" className="whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </pre>
        )}

        <button
          type="submit"
          disabled={busy || files.length === 0}
          className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
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
      <h1 className="text-2xl font-semibold">Review &amp; save</h1>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        AI suggested these. Edit anything that&apos;s off, then save.
      </p>

      {error && (
        <pre role="alert" className="mt-4 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
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
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Title</span>
              <input
                value={r.title}
                onChange={(e) => patch(r.id, "title", e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950"
                style={{ minHeight: 48 }}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Folder</span>
                <select
                  value={r.category}
                  onChange={(e) => patch(r.id, "category", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2.5 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950"
                  style={{ minHeight: 48 }}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-folder</span>
                <input
                  value={r.subfolder}
                  onChange={(e) => patch(r.id, "subfolder", e.target.value)}
                  placeholder="optional"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950"
                  style={{ minHeight: 48 }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Who it belongs to</span>
                <input
                  value={r.owner}
                  onChange={(e) => patch(r.id, "owner", e.target.value)}
                  placeholder="optional"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950"
                  style={{ minHeight: 48 }}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Date on document</span>
                <input
                  type="date"
                  value={r.doc_date}
                  onChange={(e) => patch(r.id, "doc_date", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950"
                  style={{ minHeight: 48 }}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags (comma-separated)</span>
              <input
                value={r.tags}
                onChange={(e) => patch(r.id, "tags", e.target.value)}
                placeholder="optional"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950"
                style={{ minHeight: 48 }}
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
          className="flex-[2] rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
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
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M3 7h3l2-2h8l2 2h3v12H3V7Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function DropIcon() {
  return (
    <svg aria-hidden width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 13V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

// --- drop helpers -----------------------------------------------------------

const ACCEPT_EXT = /\.(jpe?g|png|webp|heic|heif|gif|pdf)$/i;
function isAcceptedFile(f: File): boolean {
  const t = (f.type || "").toLowerCase();
  if (t === "application/pdf" || t.startsWith("image/")) return true;
  // Some browsers leave type empty for certain drops; fall back to extension.
  if (t === "") return ACCEPT_EXT.test(f.name);
  return false;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FileSystemEntryLike[]) => void, err: (e: unknown) => void) => void;
  };
}

/** Recursively collect File objects from a DataTransferItemList, walking into
 * dropped directories via the (webkit) entry API. */
async function filesFromDataTransferItems(
  items: DataTransferItemList,
): Promise<File[]> {
  const roots: FileSystemEntryLike[] = [];
  // Snapshot entries synchronously — the list is invalidated after the event.
  for (const it of items) {
    const entry = (it as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  const out: File[] = [];
  async function walk(entry: FileSystemEntryLike): Promise<void> {
    if (entry.isFile && entry.file) {
      const f = await new Promise<File | null>((resolve) =>
        entry.file!((file) => resolve(file), () => resolve(null)),
      );
      if (f) out.push(f);
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      // readEntries returns at most 100 per call — loop until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntryLike[]>((resolve) =>
          reader.readEntries((e) => resolve(e), () => resolve([])),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const r of roots) await walk(r);
  return out;
}

/** Running total against the per-upload limit, so a too-big batch is
 * visible before pressing Upload (the submit check explains the fix). */
function BatchSize({ files }: { files: File[] }) {
  const total = files.reduce((n, f) => n + f.size, 0);
  const over = total > MAX_UPLOAD_BYTES || files.length > MAX_UPLOAD_FILES;
  return (
    <p
      className={`-mt-2 px-1 text-sm ${over ? "font-medium text-red-700 dark:text-red-300" : "text-zinc-600 dark:text-zinc-400"}`}
    >
      {files.length} {files.length === 1 ? "file" : "files"} · {formatBytes(total)} of{" "}
      {formatBytes(MAX_UPLOAD_BYTES)} per upload
      {over && " — remove some to continue"}
    </p>
  );
}
