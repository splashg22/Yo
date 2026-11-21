"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { NATIVE } from "@/lib/constants";
import type { CoinView } from "@/lib/contract";
import { shortAddress } from "@/lib/format";

export interface Coins {
  /** Null while the first answer is on its way. */
  coins: CoinView[] | null;
  /** Set when the last attempt failed; the previous list, if any, is kept on screen. */
  problem: string | null;
  refresh: () => Promise<void>;
  symbol: (mint: string) => string;
}

/** The coins launched here, refreshed on a timer and paused while the tab is hidden. */
export function useCoins(everyMs = 8000): Coins {
  const [coins, setCoins] = useState<CoinView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setCoins((await api("explore")).coins);
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [refresh, everyMs]);
  const symbol = useCallback((mint: string) => (mint === NATIVE ? "SOL" : (coins?.find((coin) => coin.mint === mint)?.symbol ?? shortAddress(mint))), [coins]);
  return { coins, problem, refresh, symbol };
}
