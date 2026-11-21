"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * One choice out of a few (a tab), kept in the address after the #. A reload, a bookmark or
 * a shared link then opens on the same tab. An unknown or missing name falls back to the first.
 */
export function useHashChoice<Choice extends string>(choices: readonly Choice[]): [Choice, (next: Choice) => void] {
  const [choice, setChoice] = useState<Choice>(choices[0]!);
  useEffect(() => {
    const read = () => {
      const named = window.location.hash.slice(1);
      setChoice(choices.find((candidate) => candidate === named) ?? choices[0]!);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [choices]);
  const choose = useCallback((next: Choice) => {
    // Replaced, not pushed: switching tabs should not fill the Back button's history.
    window.history.replaceState(null, "", `#${next}`);
    setChoice(next);
  }, []);
  return [choice, choose];
}
