import type { Metadata } from "next";
import { LaunchPage } from "@/components/pages/LaunchPage";

export const metadata: Metadata = { title: "Launch" };

export default function Page() {
  return <LaunchPage />;
}
