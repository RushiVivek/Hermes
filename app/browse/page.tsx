import { docsCol, fromFirestore } from "@/lib/firestore";
import { listFolder, breadcrumbs } from "@/lib/folders";
import BrowseView from "./BrowseView";

export const dynamic = "force-dynamic";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const { path = "" } = await searchParams;
  const snap = await docsCol.where("status", "==", "active").get();
  const docs = snap.docs.map((d) => fromFirestore(d.id, d.data()));
  const { subfolders, docs: directDocs } = listFolder(docs, path);
  const crumbs = breadcrumbs(path);

  return <BrowseView crumbs={crumbs} subfolders={subfolders} docs={directDocs} />;
}
