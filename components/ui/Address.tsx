"use client";

import { useState } from "react";
import { shortAddress } from "@/lib/format";

/** An address in its real case, with a copy control. Addresses are case-sensitive, so this is never upper-cased. */
export function Address({ value, short }: { value: string; short?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () => {
    navigator.clipboard.writeText(value).then(
      () => setState("copied"),
      () => setState("failed"), // no clipboard permission: the address is on screen and can be selected
    );
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <span className="addr">
      <span className="address" title={value}>
        {short ? shortAddress(value) : value}
      </span>
      <button className="link" type="button" onClick={copy} aria-label={`Copy address ${value}`}>
        {state === "copied" ? "Copied" : state === "failed" ? "Select it to copy" : "Copy"}
      </button>
    </span>
  );
}
