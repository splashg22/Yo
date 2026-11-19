/**
 * The proof page's logic, kept apart from the page so it can be unit-tested
 * (test/proof.test.ts) and read on its own. Plain JavaScript, no build step.
 *
 * Everything here works from what the chain returns: a transaction as
 * `getTransaction` encodes it with `jsonParsed`, and account data from
 * `getAccountInfo`. Nothing is taken from the bot's own files.
 */

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const VENUES = { [PUMP_PROGRAM]: "pump", [PUMP_AMM_PROGRAM]: "pump pool", [JUPITER_PROGRAM]: "Jupiter" };
export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---- Amounts ----------------------------------------------------------------

/** Base units -> "1,234.5678" (cut to `places`, never rounded up, no "-0"). */
export function fmt(amount, decimals, places = 4) {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  const text = `${whole}${frac ? "." + frac : ""}`;
  return neg && text !== "0" ? `-${text}` : text;
}

/** "1234.5" in whole tokens -> base units. */
export function toBase(text, decimals) {
  const [whole = "0", frac = ""] = String(text).trim().split(".");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac.slice(0, decimals) || "").padEnd(decimals, "0") || "0");
}

// ---- Addresses -------------------------------------------------------------
// Free public RPCs refuse "indexed" lookups such as getTokenAccountsByOwner,
// so the page derives a wallet's associated token account itself and reads
// that one account, which every RPC allows.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58decode(text) {
  let n = 0n;
  for (const c of text) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  let zeros = 0;
  for (const c of text) { if (c !== "1") break; zeros++; }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

const P = (1n << 255n) - 19n;
function modpow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
const D = (P - (121665n * modpow(121666n, P - 2n, P)) % P) % P; // ed25519's d = -121665/121666

/** True when 32 bytes decompress to a point on ed25519, i.e. a key a wallet can sign for. */
export function onCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 + P - 1n) % P;
  const v = (D * y2 + 1n) % P;
  if (u === 0n) return true;
  const x2 = (u * modpow(v, P - 2n, P)) % P;
  return modpow(x2, (P - 1n) / 2n, P) === 1n;
}

async function sha256(bytes) {
  const subtle = globalThis.crypto?.subtle;
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

/** A program-derived address, like web3.js findProgramAddress. Seeds are byte arrays or strings. */
export async function pda(seeds, program) {
  const parts = seeds.map((s) => (typeof s === "string" ? new TextEncoder().encode(s) : s));
  const tail = new TextEncoder().encode("ProgramDerivedAddress");
  const programBytes = b58decode(program);
  const length = parts.reduce((a, p) => a + p.length, 0);
  for (let bump = 255; bump >= 0; bump--) {
    const data = new Uint8Array(length + 1 + 32 + tail.length);
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; }
    data[o++] = bump;
    data.set(programBytes, o); o += 32;
    data.set(tail, o);
    const hash = await sha256(data);
    if (!onCurve(hash)) return b58encode(hash);
  }
  throw new Error("no program address");
}

/** The associated token account of `owner` for `mint` under `tokenProgram`. */
export function ata(owner, mint, tokenProgram) {
  return pda([b58decode(owner), b58decode(tokenProgram), b58decode(mint)], ATA_PROGRAM);
}

/** The two vaults pump sweeps a creator's fees into (bonding curve and pump pool). */
export async function creatorVaults(creator) {
  return Promise.all([pda(["creator-vault", b58decode(creator)], PUMP_PROGRAM), pda(["creator_vault", b58decode(creator)], PUMP_AMM_PROGRAM)]);
}

// ---- Transactions ------------------------------------------------------------

const rows = (list) => list || [];
const amountOf = (info) => BigInt(info.tokenAmount ? info.tokenAmount.amount : info.amount);

/**
 * Classifies one of the treasury's transactions from its on-chain record.
 * `cfg` needs treasury, burnMint, strategyMint and (ideally) quoteMint; `t`
 * is the `getTransaction` result with `jsonParsed` encoding.
 *
 * Two coins get bought and burned: the burn coin (DCTY) and the strategy coin
 * itself (a buyback). A row's `coin` says which: "burn" or "self".
 */
export function classify(cfg, sig, blockTime, t) {
  const meta = t.meta || {};
  const msg = t.transaction.message;
  const keys = msg.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const treasury = cfg.treasury;
  const selfMint = cfg.strategyMint || null;
  const selfName = cfg.strategySymbol || "the coin";
  const balances = rows(meta.postTokenBalances).concat(rows(meta.preTokenBalances));
  const owned = (list, mint) => rows(list).filter((r) => r.owner === treasury && r.mint === mint).reduce((a, r) => a + BigInt(r.uiTokenAmount.amount), 0n);
  const decimalsOf = (mint) => balances.find((x) => x.mint === mint)?.uiTokenAmount.decimals ?? null;
  const ownerOfIndex = (i) => balances.find((x) => x.accountIndex === i)?.owner ?? null;
  const mintOfIndex = (i) => balances.find((x) => x.accountIndex === i)?.mint ?? null;

  const instructions = [...(msg.instructions || [])];
  for (const inner of meta.innerInstructions || []) instructions.push(...(inner.instructions || []));
  const programs = new Set(instructions.map((ix) => ix.programId).filter(Boolean));
  const venues = [...programs].map((p) => VENUES[p]).filter(Boolean);

  let burned = 0n, selfBurned = 0n;
  const payouts = new Map();
  let payoutMint = null;
  for (const ix of instructions) {
    const p = ix.parsed;
    if (!p || !p.info) continue;
    const info = p.info;
    const authority = info.authority || info.multisigAuthority;
    if ((p.type === "burn" || p.type === "burnChecked") && authority === treasury) {
      const mint = info.mint || mintOfIndex(keys.indexOf(info.account));
      if (selfMint && mint === selfMint) selfBurned += amountOf(info);
      else if (!mint || mint === cfg.burnMint) burned += amountOf(info);
    }
    if ((p.type === "transfer" || p.type === "transferChecked") && authority === treasury && info.destination) {
      const index = keys.indexOf(info.destination);
      const mint = info.mint || mintOfIndex(index);
      if (mint === cfg.burnMint || (selfMint && mint === selfMint)) continue;
      const to = ownerOfIndex(index);
      if (!to || to === treasury) continue;
      payoutMint = mint;
      payouts.set(to, (payouts.get(to) || 0n) + amountOf(info));
    }
  }

  const quoteMint = cfg.quoteMint || payoutMint || null;
  const quoteDelta = quoteMint ? owned(meta.postTokenBalances, quoteMint) - owned(meta.preTokenBalances, quoteMint) : 0n;
  const burnDelta = owned(meta.postTokenBalances, cfg.burnMint) - owned(meta.preTokenBalances, cfg.burnMint);
  const selfDelta = selfMint ? owned(meta.postTokenBalances, selfMint) - owned(meta.preTokenBalances, selfMint) : 0n;
  const lamports = meta.postBalances && meta.preBalances ? BigInt(meta.postBalances[0]) - BigInt(meta.preBalances[0]) : 0n;
  const paid = [...payouts.values()].reduce((a, b) => a + b, 0n);
  const qd = quoteMint ? decimalsOf(quoteMint) : null;
  const bd = decimalsOf(cfg.burnMint);
  const sd = selfMint ? decimalsOf(selfMint) : null;
  const touchesPump = programs.has(PUMP_PROGRAM) || programs.has(PUMP_AMM_PROGRAM);
  const signed = (delta, decimals, places, unit) => (delta ? `${delta > 0n ? "+" : "-"}${fmt(delta < 0n ? -delta : delta, decimals, places)} ${unit}` : "");

  let kind = "other", coin = null, text = "", amount = "", sign = 0;
  if (selfBurned > 0n) {
    kind = "burn"; coin = "self"; text = `${selfName} bought back and destroyed for good`; amount = `${fmt(selfBurned, sd ?? 6, 2)} ${selfName}`; sign = -1;
  } else if (burned > 0n) {
    kind = "burn"; coin = "burn"; text = "DCTY destroyed for good"; amount = `${fmt(burned, bd ?? 6, 2)} DCTY`; sign = -1;
  } else if (burnDelta > 0n && quoteDelta < 0n) {
    kind = "buy"; coin = "burn"; text = `Bought DCTY with TTWO${venues.length ? ` on ${venues.join(" + ")}` : ""}`;
    amount = `${fmt(-quoteDelta, qd ?? 0)} TTWO → ${fmt(burnDelta, bd ?? 6, 2)} DCTY`; sign = 0;
  } else if (selfDelta > 0n && quoteDelta < 0n) {
    kind = "buy"; coin = "self"; text = `Bought ${selfName} back with TTWO${venues.length ? ` on ${venues.join(" + ")}` : ""}`;
    amount = `${fmt(-quoteDelta, qd ?? 0)} TTWO → ${fmt(selfDelta, sd ?? 6, 2)} ${selfName}`; sign = 0;
  } else if (payouts.size > 0) {
    kind = "payout";
    text = `${payouts.size} holder${payouts.size === 1 ? "" : "s"} paid${touchesPump ? ", fees claimed in the same transaction" : ""}`;
    amount = `${fmt(paid, qd ?? 0)} TTWO`; sign = -1;
  } else if (quoteDelta > 0n && touchesPump) {
    kind = "claim"; text = "Creator fees claimed into the treasury"; amount = `${fmt(quoteDelta, qd ?? 0)} TTWO`; sign = 1;
  } else if (quoteDelta !== 0n || burnDelta !== 0n || selfDelta !== 0n) {
    text = "Token movement";
    amount = [signed(quoteDelta, qd ?? 0, 4, "TTWO"), signed(burnDelta, bd ?? 6, 2, "DCTY"), signed(selfDelta, sd ?? 6, 2, selfName)].filter(Boolean).join(", ");
  } else {
    text = venues.length ? `Interaction with ${venues.join(", ")}` : "SOL or account housekeeping";
    const sol = fmt(lamports < 0n ? -lamports : lamports, 9);
    amount = sol !== "0" ? `${lamports > 0n ? "+" : "-"}${sol} SOL` : "";
  }

  return {
    sig, time: blockTime ?? null, kind, coin, text, amount, sign, err: Boolean(meta.err),
    quoteMint, quoteDelta, burnDelta, selfDelta, burned, selfBurned, paid, payouts: [...payouts.entries()], qd, bd, sd,
  };
}

/** Totals over classified rows (failed transactions are left out). */
export function summarize(all) {
  const ok = all.filter((x) => !x.err);
  const of = (kind, coin) => ok.filter((x) => x.kind === kind && (coin === undefined || (x.coin || "burn") === coin));
  const recipients = new Set(of("payout").flatMap((x) => x.payouts.map((p) => p[0])));
  return {
    burned: of("burn", "burn").reduce((a, x) => a + x.burned, 0n),
    burns: of("burn", "burn").length,
    selfBurned: of("burn", "self").reduce((a, x) => a + x.selfBurned, 0n),
    selfBurns: of("burn", "self").length,
    paid: of("payout").reduce((a, x) => a + x.paid, 0n),
    payouts: of("payout").length,
    recipients: recipients.size,
    claimed: of("claim").reduce((a, x) => a + x.quoteDelta, 0n),
    claims: of("claim").length,
    spent: of("buy", "burn").reduce((a, x) => a - x.quoteDelta, 0n),
    buys: of("buy", "burn").length,
    selfSpent: of("buy", "self").reduce((a, x) => a - x.quoteDelta, 0n),
    buybacks: of("buy", "self").length,
  };
}

/** Everything a wallet has received from the treasury, newest first. */
export function receivedBy(all, owner) {
  return all
    .filter((x) => x.kind === "payout" && !x.err)
    .flatMap((x) => x.payouts.filter((p) => p[0] === owner).map((p) => ({ sig: x.sig, time: x.time, amount: p[1], decimals: x.qd })));
}

// ---- RPC ---------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny JSON-RPC client with retry on rate limits and fallback endpoints. */
export function makeRpc(urls, fetchImpl = globalThis.fetch) {
  const list = [...new Set(urls.filter(Boolean))];
  return async function rpc(method, params, attempt = 0, which = 0) {
    const url = list[which];
    let res;
    try {
      res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    } catch (error) {
      if (which + 1 < list.length) return rpc(method, params, 0, which + 1);
      throw new Error(`cannot reach the RPC (${error.message})`);
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 5) { await sleep(700 * 2 ** attempt); return rpc(method, params, attempt + 1, which); }
      if (which + 1 < list.length) return rpc(method, params, 0, which + 1);
      throw new Error(`the RPC is rate-limiting this page (HTTP ${res.status}); try again in a minute`);
    }
    let body;
    try { body = await res.json(); } catch { body = { error: { message: `HTTP ${res.status}` } }; }
    if (body.error) {
      const message = body.error.message || "RPC error";
      if (/429|too many|rate/i.test(message) && attempt < 5) { await sleep(700 * 2 ** attempt); return rpc(method, params, attempt + 1, which); }
      if (which + 1 < list.length && (res.status === 403 || res.status === 401 || /forbidden|token|plan|key/i.test(message))) return rpc(method, params, 0, which + 1);
      throw new Error(message);
    }
    return body.result;
  };
}
