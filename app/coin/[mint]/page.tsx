import type { Metadata } from "next";
import { CoinScreen } from "@/components/terminal/CoinScreen";

export const metadata: Metadata = { title: "Coin" };

export default async function Page({ params }: { params: Promise<{ mint: string }> }) {
  return <CoinScreen mint={(await params).mint} />;
}
