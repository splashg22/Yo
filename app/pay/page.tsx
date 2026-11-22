import { NotInBuild } from "@/components/NotInBuild";
import type { Metadata } from "next";
import { PayPage } from "@/components/pages/PayPage";

export const metadata: Metadata = { title: "Pay links" };

export default function Page() {
  return (
    <NotInBuild feature="payLinks" name="Pay links">
      <PayPage />
    </NotInBuild>
  );
}
