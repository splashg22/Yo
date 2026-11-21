import type { Metadata } from "next";
import { TerminalPage } from "@/components/pages/TerminalPage";

export const metadata: Metadata = { title: "Terminal" };

export default function Page() {
  return <TerminalPage />;
}
