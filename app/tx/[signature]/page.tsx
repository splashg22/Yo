import type { Metadata } from "next";
import { TransactionPage } from "@/components/pages/TransactionPage";

export const metadata: Metadata = { title: "Receipt" };

export default async function Page({ params }: { params: Promise<{ signature: string }> }) {
  return <TransactionPage signature={(await params).signature} />;
}
