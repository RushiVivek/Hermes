import { CATEGORIES } from "@/lib/types";
import { geminiConfigured } from "@/lib/gemini";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <UploadForm categories={[...CATEGORIES]} aiAvailable={geminiConfigured()} />
  );
}
