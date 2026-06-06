"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  categories: string[];
}

export default function UploadForm({ categories }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState(categories[0]);
  const [subfolder, setSubfolder] = useState("");
  const [owner, setOwner] = useState("");
  const [docDate, setDocDate] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Whole-page drop target while dragging — desktop affordance.
  useEffect(() => {
    let depth = 0;
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragOver(true);
      e.preventDefault();
    }
    function onDragLeave() {
      depth--;
      if (depth <= 0) {
        depth = 0;
        setDragOver(false);
      }
    }
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
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
  }, []);

  function addFiles(incoming: File[]) {
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const fresh = incoming.filter((f) => !seen.has(`${f.name}-${f.size}`));
      return [...prev, ...fresh];
    });
  }

  function removeFile(idx: number) {
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
      fd.set("category", category);
      fd.set("subfolder", subfolder.trim());
      if (owner.trim()) fd.set("owner", owner.trim());
      if (docDate) fd.set("doc_date", docDate);
      if (tags.trim()) fd.set("tags", tags.trim());
      for (const f of files) fd.append("files", f);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data: {
        created?: { id: string; path: string }[];
        errors?: { filename: string; error: string }[];
        error?: string;
      } = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`);
        return;
      }

      const created = data.created ?? [];
      const errs = data.errors ?? [];
      if (errs.length > 0 && created.length === 0) {
        setError(errs.map((e) => `${e.filename}: ${e.error}`).join("\n"));
        return;
      }

      const path = created[0]?.path ?? (subfolder ? `${category}/${subfolder}` : category);
      const url = path
        ? `/browse?path=${encodeURIComponent(path)}`
        : "/browse";
      router.push(url);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Add documents</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Take a photo or pick files. You can add many at once; they all go into the
        same folder.
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
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
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

        <fieldset className="space-y-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Where to file these
          </legend>

          <label className="block">
            <span className="text-sm">Folder</span>
            <select
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
              style={{ minHeight: 48 }}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm">Sub-folder (optional)</span>
            <input
              type="text"
              value={subfolder}
              onChange={(e) => setSubfolder(e.target.value)}
              placeholder="e.g. Aarav/Marksheets"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-200"
              style={{ minHeight: 48 }}
            />
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
            ? `Uploading ${files.length}…`
            : files.length === 0
              ? "Pick files to upload"
              : `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`}
        </button>
      </form>
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
