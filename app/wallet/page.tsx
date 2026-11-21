import type { Metadata } from "next";
import { WalletPage } from "@/components/pages/WalletPage";

export const metadata: Metadata = { title: "Ring wallet" };

export default function Page() {
  return <WalletPage />;
}
