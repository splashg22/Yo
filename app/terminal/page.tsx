import type { Metadata } from "next";
import { Board } from "@/components/terminal/Board";

export const metadata: Metadata = { title: "Terminal" };

export default function Page() {
  return <Board />;
}
