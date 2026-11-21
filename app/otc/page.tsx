import type { Metadata } from "next";
import { OtcPage } from "@/components/pages/OtcPage";

export const metadata: Metadata = { title: "OTC" };

export default function Page() {
  return <OtcPage />;
}
