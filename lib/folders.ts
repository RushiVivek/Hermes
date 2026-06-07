import type { Doc } from "./types";

export interface FolderEntry {
  name: string;
  path: string;
  doc_count: number;
}

export function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function joinPath(parts: string[]): string {
  return parts.join("/");
}

/** Strip leading/trailing/duplicate slashes so URL-shaped variants like
 * "/Education/", "Education//Aarav", "//Education" all canonicalize to the
 * same string the rest of the helpers expect. */
function normalize(path: string): string {
  return joinPath(splitPath(path));
}

export function isUnderPath(docPath: string, currentPath: string): boolean {
  const c = normalize(currentPath);
  if (c === "") return true;
  return docPath === c || docPath.startsWith(c + "/");
}

/**
 * Given the current folder `currentPath` and the full set of active docs,
 * return:
 *   - subfolders: immediate children of currentPath (with descendant doc counts)
 *   - docs: docs whose `path` is exactly currentPath
 */
export function listFolder(
  docs: Doc[],
  currentPath: string,
): { subfolders: FolderEntry[]; docs: Doc[] } {
  const currentParts = splitPath(currentPath);
  const subfolderCounts = new Map<string, number>();
  const directDocs: Doc[] = [];

  for (const d of docs) {
    if (!isUnderPath(d.path, currentPath)) continue;
    const parts = splitPath(d.path);
    if (parts.length === currentParts.length) {
      directDocs.push(d);
    } else {
      const childName = parts[currentParts.length];
      subfolderCounts.set(childName, (subfolderCounts.get(childName) ?? 0) + 1);
    }
  }

  const subfolders: FolderEntry[] = Array.from(subfolderCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, doc_count]) => ({
      name,
      path: joinPath([...currentParts, name]),
      doc_count,
    }));

  directDocs.sort((a, b) => a.title.localeCompare(b.title));
  return { subfolders, docs: directDocs };
}

export function breadcrumbs(currentPath: string): { name: string; path: string }[] {
  const parts = splitPath(currentPath);
  const crumbs: { name: string; path: string }[] = [{ name: "All", path: "" }];
  for (let i = 0; i < parts.length; i++) {
    crumbs.push({ name: parts[i], path: joinPath(parts.slice(0, i + 1)) });
  }
  return crumbs;
}
