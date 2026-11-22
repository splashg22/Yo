import type { Metadata } from "next";
import { Portfolio } from "@/components/terminal/Portfolio";

export const metadata: Metadata = { title: "Portfolio" };

export default function Page() {
  return <Portfolio />;
}
