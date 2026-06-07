import { NextResponse } from "next/server";
import { docsCol, fromFirestore } from "@/lib/firestore";

export async function GET() {
  const snap = await docsCol().where("status", "==", "active").get();
  const docs = snap.docs.map((d) => fromFirestore(d.id, d.data()));
  return NextResponse.json({ docs });
}
