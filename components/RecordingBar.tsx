"use client";

/**
 * Shown on every page while the server plays back a recorded stretch of the chain instead of following it.
 * It cannot be dismissed: nothing recorded is to be mistaken for now.
 */
import { formatTime } from "@/lib/format";
import { useWallet } from "./wallet/WalletProvider";

export function RecordingBar() {
  const { config } = useWallet();
  if (config === null || config === "offline" || !config.recording) return null;
  const { from, to } = config.recording;
  return (
    <p className="recording-bar" role="status" data-recording>
      <b>Recording, not live.</b> Real Solana mainnet trades recorded from {formatTime(from)} to {formatTime(to)}, played back. Ages and &quot;the last
      hour&quot; are measured on the recording&apos;s clock. Nothing here can be traded.
    </p>
  );
}
