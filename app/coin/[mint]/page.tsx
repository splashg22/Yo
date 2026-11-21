import type { Metadata } from "next";
import { CoinPage } from "@/components/pages/CoinPage";

export const metadata: Metadata = { title: "Coin" };

export default async function Page({ params }: { params: Promise<{ mint: string }> }) {
  return <CoinPage mint={(await params).mint} />;
}
