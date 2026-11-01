"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Doc } from "@/lib/types";
import type { FolderEntry } from "@/lib/folders";
import { formatBytes } from "@/lib/format";
import ViewModeToggle, {
  VIEW_STORAGE_KEY,
  type ViewMode,
} from "@/components/ViewModeToggle";
import { useTopBarSlot } from "@/components/TopBarSlot";
import DeleteFolderButton from "./DeleteFolderButton";

interface Props {
  crumbs: { name: string; path: string }[];
  subfolders: FolderEntry[];
  docs: Doc[];
}

const CARD =
  "rounded-xl border border-zinc-200 bg-white transition-colors hover:border-zinc-300 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:active:bg-zinc-800";

export default function BrowseView({ crumbs, subfolders, docs }: Props) {
  const [view, setView] = useState<ViewMode>("list");

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode | null;
    if (stored === "list" || stored === "grid" || stored === "gallery") {
      setView(stored);
    }
  }, []);

  function changeView(m: ViewMode) {
    setView(m);
    localStorage.setItem(VIEW_STORAGE_KEY, m);
  }

  const slot = useMemo(
    () => <ViewModeToggle value={view} onChange={changeView} />,
    [view],
  );
  useTopBarSlot(slot);

  const empty = subfolders.length === 0 && docs.length === 0;
  // Total descendant items at this folder = direct docs + sum of immediate
  // subfolder counts (which are themselves transitive).
  const totalItems =
    docs.length + subfolders.reduce((n, f) => n + f.doc_count, 0);
  // Only allow deleting actual folders, not the All view.
  const currentPath = crumbs.length > 1 ? crumbs[crumbs.length - 1].path : "";
  const title = currentPath ? crumbs[crumbs.length - 1].name : "All documents";

  const exportHref = currentPath
    ? `/api/export?path=${encodeURIComponent(currentPath)}`
    : "/api/export";

  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      {crumbs.length > 1 && <Breadcrumb crumbs={crumbs} />}
      <h1 className="mt-1 break-words text-2xl font-semibold">{title}</h1>
      {!empty && (
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          {itemsLabel(totalItems)}
        </p>
      )}

      {!empty && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Download navigation — the route streams a .zip attachment. */}
          <a
            href={exportHref}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-sm font-medium transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            style={{ minHeight: 44 }}
          >
            <ZipIcon />
            {currentPath ? "Download folder" : "Download everything"}
          </a>
          {currentPath && (
            <DeleteFolderButton path={currentPath} itemCount={totalItems} />
          )}
        </div>
      )}

      {empty ? (
        <EmptyState inFolder={Boolean(currentPath)} />
      ) : (
        <div className="mt-6 space-y-8">
          {subfolders.length > 0 && <FolderSection folders={subfolders} view={view} />}
          {docs.length > 0 && <DocSection docs={docs} view={view} />}
        </div>
      )}
    </div>
  );
}

function itemsLabel(n: number): string {
  return `${n} ${n === 1 ? "document" : "documents"}`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">{children}</h2>
  );
}

function FolderSection({ folders, view }: { folders: FolderEntry[]; view: ViewMode }) {
  return (
    <section>
      <SectionHeading>Folders</SectionHeading>
      {view === "list" && <FolderList folders={folders} />}
      {view === "grid" && <FolderGrid folders={folders} />}
      {view === "gallery" && <FolderGallery folders={folders} />}
    </section>
  );
}

function folderHref(f: FolderEntry) {
  return `/browse?path=${encodeURIComponent(f.path)}`;
}

function FolderList({ folders }: { folders: FolderEntry[] }) {
  return (
    <ul className="mt-2 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {folders.map((f) => (
        <li key={f.path}>
          <Link
            href={folderHref(f)}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800"
            style={{ minHeight: 60 }}
          >
            <FolderGlyph />
            <span className="flex-1 truncate font-medium">{f.name}</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">{itemsLabel(f.doc_count)}</span>
            <ChevronRight />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FolderGrid({ folders }: { folders: FolderEntry[] }) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {folders.map((f) => (
        <li key={f.path}>
          <Link href={folderHref(f)} className={`block p-4 ${CARD}`} style={{ minHeight: 88 }}>
            <div className="flex items-start gap-3">
              <FolderGlyph size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.name}</p>
                <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
                  {itemsLabel(f.doc_count)}
                </p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FolderGallery({ folders }: { folders: FolderEntry[] }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {folders.map((f) => (
        <li key={f.path}>
          <Link href={folderHref(f)} className={`block overflow-hidden ${CARD}`}>
            <div className="flex aspect-[4/3] items-center justify-center bg-amber-50 dark:bg-amber-500/10">
              <FolderGlyph size={44} />
            </div>
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium">{f.name}</p>
              <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                {itemsLabel(f.doc_count)}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DocSection({ docs, view }: { docs: Doc[]; view: ViewMode }) {
  return (
    <section>
      <SectionHeading>Documents</SectionHeading>
      {view === "list" && <DocList docs={docs} />}
      {view === "grid" && <DocGrid docs={docs} />}
      {view === "gallery" && <DocGallery docs={docs} />}
    </section>
  );
}

/** "Mother · 2024-06-01" — whatever is known, falling back to the size. */
function docMeta(d: Doc): string {
  const parts = [d.owner, d.doc_date].filter(Boolean);
  return parts.length ? parts.join(" · ") : formatBytes(d.size_bytes);
}

function DocList({ docs }: { docs: Doc[] }) {
  return (
    <ul className="mt-2 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {docs.map((d) => (
        <li key={d.id}>
          <Link
            href={`/browse/d/${d.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800"
            style={{ minHeight: 60 }}
          >
            <FileGlyph mime={d.mime} size={24} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{d.title}</p>
              <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">{docMeta(d)}</p>
            </div>
            <ChevronRight />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DocGrid({ docs }: { docs: Doc[] }) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {docs.map((d) => (
        <li key={d.id}>
          <Link href={`/browse/d/${d.id}`} className={`block p-4 ${CARD}`} style={{ minHeight: 88 }}>
            <div className="flex items-start gap-3">
              <FileGlyph mime={d.mime} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{d.title}</p>
                <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">{docMeta(d)}</p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DocGallery({ docs }: { docs: Doc[] }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {docs.map((d) => (
        <li key={d.id}>
          <Link href={`/browse/d/${d.id}`} className={`block overflow-hidden ${CARD}`}>
            <div className="flex aspect-[4/3] items-center justify-center bg-zinc-100 dark:bg-zinc-800">
              <FileGlyph mime={d.mime} size={40} />
            </div>
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium">{d.title}</p>
              <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">{docMeta(d)}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Breadcrumb({ crumbs }: { crumbs: { name: string; path: string }[] }) {
  // Only ancestors are links; the current folder is the page heading below.
  const ancestors = crumbs.slice(0, -1);
  return (
    <nav aria-label="Folder path" className="-ml-2">
      <ol className="flex flex-wrap items-center text-sm text-zinc-600 dark:text-zinc-400">
        {ancestors.map((c, i) => (
          <li key={c.path} className="flex items-center">
            {i > 0 && <span aria-hidden className="px-0.5 text-zinc-400 dark:text-zinc-600">/</span>}
            <Link
              href={`/browse${c.path ? `?path=${encodeURIComponent(c.path)}` : ""}`}
              className="flex items-center rounded-lg px-2 font-medium transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              style={{ minHeight: 44 }}
            >
              {i === 0 && <BackIcon />}
              {c.name === "All" ? "All documents" : c.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function EmptyState({ inFolder }: { inFolder: boolean }) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <FolderGlyph size={28} tone="current" />
      </span>
      <p className="mt-4 font-medium">
        {inFolder ? "This folder is empty" : "No documents yet"}
      </p>
      <p className="mt-1 max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
        Take a photo of a certificate or pick a PDF, and hermes will keep it safe here.
      </p>
      <Link
        href="/upload"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
        style={{ minHeight: 48 }}
      >
        <PlusIcon /> Add documents
      </Link>
    </div>
  );
}

function FolderGlyph({ size = 22, tone = "amber" }: { size?: number; tone?: "amber" | "current" }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      className={tone === "amber" ? "flex-none text-amber-600 dark:text-amber-400" : "flex-none"}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function FileGlyph({ mime, size = 28 }: { mime: string; size?: number }) {
  const isImage = mime.startsWith("image/");
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      className={`flex-none ${isImage ? "text-emerald-600 dark:text-emerald-400" : "text-sky-700 dark:text-sky-400"}`}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      {isImage ? <path d="m8 17 3-3 2 2 3-3" strokeLinecap="round" /> : <path d="M9 13h6M9 17h4" strokeLinecap="round" />}
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="flex-none text-zinc-400 dark:text-zinc-500">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="mr-1">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ZipIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
