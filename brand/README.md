# Dacity Strategy · Twitter / X brand kit

Ready-to-upload files are in `out/`. Sources are in `src/`; `./render.sh`
regenerates the PNGs with headless Chrome after you edit them.

| File | Size | Use |
| --- | --- | --- |
| `out/avatar.png` | 400 × 400 | Profile picture (X crops it to a circle; the mark is centred with room) |
| `out/banner.png` | 1500 × 500 | Header. The bottom-left stays quiet because the avatar sits over it |
| `out/post-announce.png` | 1200 × 675 | The "how it works" post / pinned tweet image (16:9, no crop in the timeline) |
| `logo.svg` | any | The mark on its own, for link previews, Telegram, pump.fun |

Nothing in the kit shows a number that has not happened. Add real figures
only from the dashboard once cycles have run.

## Colours

| Name | Hex | Where |
| --- | --- | --- |
| Night | `#0b0308` | background |
| Pink | `#ff1f8f` | the mark, DCTY, burns |
| Pink light | `#ff6ab8` | links, small accents |
| Sky | `#8fd3ff` | TTWO, payouts |
| Paper | `#fff4fa` | headline text |
| Mist | `rgba(255,228,243,.68)` | body text |
| Button | `#ffe1f3` on `#1c0713` | call-to-action pills |

Type: **DM Sans** (Google Fonts). Light 300 for the first half of a
headline, Extra-bold 800 for the punch, tight letter-spacing (−0.04em).
Pattern: *light statement,* **bold payoff.**

## Profile

**Name:** Dacity Strategy
**Handle ideas:** @DacityStrategy · @DacityStrat · @DCTYstrategy (check availability)

**Bio (160 chars):**
> Every creator fee works. 40% burns $DCTY, 20% buys this coin back and burns it, 40% pays holders in $TTWO. Proven live on Solana. Not financial advice.

**Short bio (if you want it tighter):**
> Fees burn $DCTY, buy back the coin and pay you in $TTWO. All on-chain.

**Website field:** https://splashg22.github.io/Yo/
**Location field:** Solana

## Pinned post (with `post-announce.png`)

> Dacity Strategy is a pump.fun coin paired with $TTWO, tokenized Take-Two stock.
>
> Every creator fee is split by a fixed rule:
> 🔥 40% buys and burns $DCTY
> 🔁 20% buys this coin back and burns it
> 💸 40% is paid to holders in $TTWO
>
> Nothing to claim. Every step is a public transaction.
> Live dashboard: https://splashg22.github.io/Yo/dashboard.html

## Launch thread (post when the coin is live)

1. > We're live. Contract: `<address>` · Buy on pump.fun: `<link>`
   > Hold at least 1,000,000 and the bot pays you $TTWO every cycle. No claiming.
2. > How it works, in one picture. (attach `post-announce.png`)
3. > Why TTWO: the coin's fees arrive as tokenized Take-Two stock, not SOL. Holders get stock-backed payouts straight to their wallet.
4. > Why burn DCTY too: 40% of every fee buys DacityCoin on the open market and destroys it. Supply only goes down. Every burn has a transaction link.
5. > Why buy back: 20% buys this coin on its own market and burns it. The coin you hold gets scarcer every cycle.
6. > Don't trust, check: the dashboard reads Solana directly in your browser. Treasury `7ZGiZyFjBEKNS5qGhtfonJdKmhvechrHK1HW3P4uRjqP`. Code is open: https://github.com/splashg22/Yo

## Recurring post templates

Fill these from the dashboard only; never estimate.

**After a cycle**
> Cycle `N` just ran.
> 🔥 `X` $DCTY burned
> 🔁 `Y` of the coin bought back and burned
> 💸 `Z` $TTWO paid to `K` holders
> Every tx: https://splashg22.github.io/Yo/#txs

**Weekly**
> This week the treasury burned `X` $DCTY, bought back `Y`, and paid holders `Z` $TTWO. Lifetime numbers and every transaction on the dashboard.

**Holder prompt**
> Paste your wallet on the site and see what you've been paid, no login: https://splashg22.github.io/Yo/#wallet

## Rules of voice

- Facts, then feeling. Numbers come from the chain, never from a forecast.
- Say "paid", "burned", "bought back". Avoid "guaranteed", "risk-free", "passive income".
- Always: "Not financial advice" in the bio or the pinned post. Always: "Independent project, not affiliated with Take-Two Interactive, the TTWO issuer or pump.fun" somewhere visible.
- Link the dashboard, not a screenshot, whenever a number is the point.

## Generated art (Higgsfield)

The kit above is typographic on purpose; generated art goes *behind* it, never
instead of it. Generate these in the Higgsfield app (the connector in this
workspace cannot generate, only read history), then say so: the results can
be pulled from your generation history and dropped in as backgrounds for the
X header, the hero and the announcement card. Keep text out of the images;
the type is laid over them from the sources in `src/`.

Recommended models: **Nano Banana Pro** or **Cinema Studio Image 2.5** at 2k.
Use the same seed or reference the first result for the other two so they
match. Ask for no text, no logos, no watermarks every time.

**1. X header background · 21:9** (crop to 1500 × 500 afterwards)
> A vast dark wall of small rounded rectangular tiles, deep night plum (#0b0308) with a soft hot-pink glow (#ff1f8f) rising from the top centre and fading out, like a lit arcade wall at night. Low camera angle, slight perspective, cinematic lighting, film grain, shallow depth of field at the edges. Empty negative space in the left half and bottom-left for text. No text, no letters, no logos, no people.

**2. Hero image for the site · 16:9**
> Macro photograph of a single matte-black ticket stub with a perforated edge on a dark tiled surface, lit by a thin hot-pink neon line from above, pale sky-blue rim light from the left. A faint curl of smoke rising from one corner as if just burned. Moody, precise, premium. Night plum palette (#0b0308, #ff1f8f, #8fd3ff). No text, no numbers, no logos.

**3. Announcement card background · 16:9**
> Three tall translucent glass tickets standing in a shallow fan on a dark reflective floor, each lit edge-on: the left one hot pink, the middle one warm white, the right one pale sky blue. Dark tiled wall behind, soft glow at the top, long reflections, cinematic, 4k product photography. Empty space across the upper half for a headline. No text, no logos.

**4. Avatar mark, optional · 1:1**
> A minimal pink neon "A" made of two strokes with an inner arch, mounted on a dark tile wall, glowing softly, centred, lots of margin, photographic. No other text.

After generating: tell Claude "the Higgsfield art is ready". It will read the
URLs from the history, place the images under `brand/art/`, and re-render the
kit with the type on top.
