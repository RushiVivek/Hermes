import { docsCol, db } from "@/lib/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { Doc } from "@/lib/types";

type Seed = Omit<Doc, "id" | "uploaded_at"> & { uploaded_at?: string };

const FAKE_ACCOUNT = "demo-account";
const FAKE_BLOB = (slug: string) =>
  `https://buzzheavier.com/seed-${slug}`;

const seeds: Seed[] = [
  {
    path: "Education/Aarav/Marksheets",
    title: "Aarav 10th Board Marksheet 2023",
    category: "Education",
    owner: "Aarav",
    doc_date: "2023-05-30",
    tags: ["marksheet", "10th", "cbse"],
    buzzheavier_id: "seed-aarav-10th",
    buzzheavier_url: FAKE_BLOB("aarav-10th"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 184_320,
    uploaded_by: "from Mom's phone",
    status: "active",
  },
  {
    path: "Education/Aarav/Marksheets",
    title: "Aarav 12th Board Marksheet 2025",
    category: "Education",
    owner: "Aarav",
    doc_date: "2025-06-12",
    tags: ["marksheet", "12th", "cbse"],
    buzzheavier_id: "seed-aarav-12th",
    buzzheavier_url: FAKE_BLOB("aarav-12th"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 201_932,
    status: "active",
  },
  {
    path: "Education/Aarav/Certificates",
    title: "Aarav Coding Camp Certificate",
    category: "Education",
    owner: "Aarav",
    doc_date: "2024-12-15",
    tags: ["certificate", "extracurricular"],
    buzzheavier_id: "seed-aarav-cert",
    buzzheavier_url: FAKE_BLOB("aarav-cert"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "image/jpeg",
    size_bytes: 1_124_000,
    status: "active",
  },
  {
    path: "ID & Government/Passports",
    title: "Aarav Passport",
    category: "ID & Government",
    owner: "Aarav",
    doc_date: "2022-03-04",
    tags: ["passport", "id"],
    buzzheavier_id: "seed-aarav-pp",
    buzzheavier_url: FAKE_BLOB("aarav-pp"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 412_990,
    status: "active",
  },
  {
    path: "ID & Government/Passports",
    title: "Mom Passport",
    category: "ID & Government",
    owner: "Mom",
    doc_date: "2020-09-22",
    tags: ["passport", "id"],
    buzzheavier_id: "seed-mom-pp",
    buzzheavier_url: FAKE_BLOB("mom-pp"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 401_233,
    status: "active",
  },
  {
    path: "ID & Government/Aadhaar",
    title: "Mom Aadhaar Card",
    category: "ID & Government",
    owner: "Mom",
    tags: ["aadhaar", "id"],
    buzzheavier_id: "seed-mom-aadhaar",
    buzzheavier_url: FAKE_BLOB("mom-aadhaar"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 88_120,
    status: "active",
  },
  {
    path: "Medical/Insurance",
    title: "Family Health Insurance Policy 2026",
    category: "Medical",
    doc_date: "2026-01-01",
    tags: ["insurance", "health", "policy"],
    buzzheavier_id: "seed-health-2026",
    buzzheavier_url: FAKE_BLOB("health-2026"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 312_010,
    status: "active",
  },
  {
    path: "Medical/Reports",
    title: "Dad Cardio Checkup Report",
    category: "Medical",
    owner: "Dad",
    doc_date: "2026-02-18",
    tags: ["medical", "report"],
    buzzheavier_id: "seed-dad-cardio",
    buzzheavier_url: FAKE_BLOB("dad-cardio"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 422_900,
    status: "active",
  },
  {
    path: "Finance/Tax",
    title: "ITR Acknowledgment FY 2024-25",
    category: "Finance",
    doc_date: "2025-07-31",
    tags: ["tax", "itr"],
    buzzheavier_id: "seed-itr-24",
    buzzheavier_url: FAKE_BLOB("itr-24"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 92_800,
    status: "active",
  },
  {
    path: "Property",
    title: "Apartment Sale Deed",
    category: "Property",
    doc_date: "2019-11-08",
    tags: ["property", "deed"],
    buzzheavier_id: "seed-deed",
    buzzheavier_url: FAKE_BLOB("deed"),
    buzzheavier_account_id: FAKE_ACCOUNT,
    mime: "application/pdf",
    size_bytes: 1_902_400,
    status: "active",
  },
];

async function main() {
  const existing = await docsCol.where("buzzheavier_account_id", "==", FAKE_ACCOUNT).get();
  if (!existing.empty) {
    console.log(`Deleting ${existing.size} existing seed docs…`);
    const batch = db.batch();
    existing.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  const batch = db.batch();
  for (const s of seeds) {
    const ref = docsCol.doc();
    batch.set(ref, { ...s, uploaded_at: Timestamp.now() });
  }
  await batch.commit();
  console.log(`Inserted ${seeds.length} seed docs.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
