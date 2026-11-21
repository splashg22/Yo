import { Operator } from "@/components/Operator";
import type { Metadata } from "next";
import { site } from "@/site.config";

export const metadata: Metadata = { title: "Terms" };

export default function Page() {
  return (
    <div className="page">
      <div className="wrap">
        <span className="label">Draft. Not yet reviewed by a lawyer.</span>
        <h1 className="h2">Terms</h1>
        <Operator />
        <div className="prose">
          <p>These terms cover your use of {site.name}. The project is a pre-release. It runs on a test chain, where coins have no value.</p>
          <h2>What {site.name} is</h2>
          <p>Software that helps you build and sign Solana transactions. It never holds your keys. You sign every transaction yourself.</p>
          <p>
            In this pre-release, Ring balances are simulated: coins you deposit on the test chain are held by a stand-in run by this site. That arrangement
            exists only on a test chain and will not be used with coins of value.
          </p>
          <h2>What it is not</h2>
          <ul>
            <li>It is not a broker, an exchange or a custodian, and it gives no financial advice.</li>
            <li>It is not affiliated with Helius or pump.fun, whose programs it calls.</li>
            <li>It does not make you or your wallet hidden. Read the Docs page for what stays public.</li>
          </ul>
          <h2>Your responsibility</h2>
          <ul>
            <li>You keep your own keys and backups. A lost key cannot be recovered by anyone.</li>
            <li>You follow the law where you live, including tax and sanctions law.</li>
            <li>Transactions on a blockchain cannot be reversed.</li>
          </ul>
          <h2>No warranty</h2>
          <p>The software is provided as it is, without warranty. It depends on alpha software from third parties and may fail or change.</p>
        </div>
      </div>
    </div>
  );
}
