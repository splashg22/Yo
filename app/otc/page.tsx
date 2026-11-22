import { NotInBuild } from "@/components/NotInBuild";
import type { Metadata } from "next";
import { OtcPage } from "@/components/pages/OtcPage";

export const metadata: Metadata = { title: "OTC" };

export default function Page() {
  return (
    <NotInBuild feature="otc" name="OTC">
      <OtcPage />
    </NotInBuild>
  );
}
