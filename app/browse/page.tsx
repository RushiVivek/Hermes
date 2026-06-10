import { docsCol, fromFirestore } from "@/lib/firestore";
import { listFolder, breadcrumbs } from "@/lib/folders";
import { listFolderPaths } from "@/lib/folder-store";
import BrowseView from "./BrowseView";

export const dynamic = "force-dynamic";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string | string[] }>;
}) {
  const sp = await searchParams;
  // Repeated `?path=a&path=b` resolves to an array — coerce to the last entry
  // so listFolder/breadcrumbs (which call .split) don't crash.
  const path = Array.isArray(sp.path) ? (sp.path.at(-1) ?? "") : (sp.path ?? "");
  const [snap, folderPaths] = await Promise.all([
    docsCol().where("status", "==", "active").get(),
    listFolderPaths(),
  ]);
  const docs = snap.docs.map((d) => fromFirestore(d.id, d.data()));
  // folderPaths keeps emptied folders visible (folders are otherwise derived
  // purely from doc paths and would vanish when the last doc is deleted).
  const { subfolders, docs: directDocs } = listFolder(docs, path, folderPaths);
  const crumbs = breadcrumbs(path);

  return <BrowseView crumbs={crumbs} subfolders={subfolders} docs={directDocs} />;
}
