import { CATEGORIES } from "@/lib/types";
import UploadForm from "./UploadForm";

export default function UploadPage() {
  return <UploadForm categories={[...CATEGORIES]} />;
}
