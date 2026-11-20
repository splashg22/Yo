# Dacity Strategy · website walkthrough — shot list

Format: 3840 × 2160, 60 fps, 38 s (2,280 frames). Style: high-end SaaS explainer, dark plum room, light DM Sans
headline with one bold phrase, the real site UI as layers. Everything on screen is either the site exactly as it
rendered at capture time or a line of caption in the site's own words; no invented numbers (all live figures
are 0 except the DCTY supply, read from the chain at capture time), no pills, badges or "LIVE" stamps.

Brand (from `web/ui.css` `:root` only): pink `#ff2d95`, pink-hi `#ff5fae`, violet `#b65cff`, cyan `#3ee8ff`,
ink `#0b0308`, card `#170810`, frame `#140811`, text `#fff4fa`, muted `rgba(255,228,243,.72)`, button `#ffe1f3`
on `#1c0713`. Font DM Sans 200–900. Logo `web/logo.svg` (the D sliced 40 / 20 / 40) and the kit wordmark.

Motion language: ease-out entrances `cubic-bezier(0.16, 1, 0.3, 1)`; UI pops on a spring with slight overshoot;
40–80 ms staggers; captions held ≥ 2.4 s; cursor on quadratic bezier paths; transitions grow out of the content
(the mark's three bands become the split bar, the "Open the dashboard" click ripples into the next room, the
page scrolls on from the treasury to the history, the wall's pink glow blooms into the end card).

Note: the live dashboard dropped its "Where the fees went" panel while this was being made, so the fixed-split
scene uses the home page's own cycle wheel and card plus the dashboard's `#bar` styling, not a panel capture.

| # | Frames (s) | Scene | Picture | Motion | Caption / type | Background |
| - | ---------- | ----- | ------- | ------ | -------------- | ---------- |
| 1 | 0–216 (0.0–3.6) | Hook | The mark alone, then the wordmark | The D's outline draws on; the pink, violet and cyan bands slide in 200 ms apart; spring scale 0.72→1; one glow pulse; "Dacity" then "STRATEGY" wipe in | **Dacity** STRATEGY | Higgsfield *bay* (dusk bay), slow push, darkened 42 % |
| 2 | 216–444 (3.6–7.4) | Problem line | Two lines of kinetic type | Line 1 rises word by word (60 ms); line 2 snaps in bold on a spring; both lift out as the page arrives | *Creator fees usually stay with the creator.* **Here, nothing is kept.** | *grid*, glide, darkened 55 % |
| 3 | 444–756 (7.4–12.6) | Reveal: the real site in one move | Pill nav, "Every fee works **for holders.**", lede, buttons (captured layers) and the ring rebuilt with the site's own CSS and maths, turning at 8°/s | Page rises 90 px on an ease-out while the camera pushes in 3.5 %; cursor curves to "Open the dashboard", hover tint, click ripple; an ink ripple from the button carries into the next room | none (the page is the type) | The site's own wall over *sky* at 30 % |
| 4 | 756–1140 (12.6–19.0) | One fixed rule | The mark at the bar's end; the 40 / 20 / 40 bar in the dashboard's `#bar` colours; the home page's cycle wheel and card at steps 2–4 | Bar draws on in three segments; 40 %, 20 %, 40 % count up; wheel and card crossfade through "40 % burns DCTY → 20 % buys back → 40 % to holders", the active segment glowing | *One rule,* **every cycle.** — Nothing is kept. Every fee the coin earns is split the same way, every time, and every step is public. | *tickets*, slow orbit, darkened 62 % |
| 5 | 1140–1548 (19.0–25.8) | The live dashboard | "The treasury, **live.**" head (captured), the overview panel and the four KPI tiles rebuilt from the site's CSS with the captured texts | Overview slides in, items 70 ms apart; Supply counts 0 → the chain value with the site's ease-out cubic; tiles pop 60 ms apart; cursor curves to "Treasury on Solscan ↗" and clicks; 3 % push-in | *Every number,* **on-chain.** — Read from a public Solana RPC in your browser, nothing taken on trust. | Site wall over *sky* |
| 6 | 1548–1908 (25.8–31.8) | Every step public | "Treasury history" panel in its real empty state; the three address rows | Panel springs in; chips pop 50 ms apart; the empty-state line types on; address rows slide up 70 ms apart; cursor clicks **Copy** → "Copied" in cyan (the site's own state) for 1.4 s | *Every* **transaction.** — The treasury's full history, classified from what each transaction did on-chain. Each row links to Solscan. | *bay*, darkened 55 % |
| 7 | 1908–2280 (31.8–38.0) | End card | Mark, wordmark, tagline, URL, disclaimer | The wall's pink glow blooms; mark springs in; wordmark wipes in; tagline rises; the URL underlines itself; the disclaimer fades in last and holds 3.5 s; fade to ink | **Dacity** STRATEGY · Every fee works **for holders.** · splashg22.github.io/Yo · Independent project. Not affiliated with Take-Two Interactive, the TTWO issuer or pump.fun. Not financial advice. | *tickets* |

Audio: placeholders only (see README). Cue points in `src/audio.ts`: logo bloom 0.9 s, type snap 5.3 s, page
rise 7.4 s, bar draw 13.4 s, tile pops 20.0 s, click 23.7 s, copy click 30.5 s, end bloom 31.8 s.
