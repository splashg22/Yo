# Dacity Strategy · website walkthrough — shot list

Format: 3840 × 2160, 60 fps, 28.8 s (1,728 frames = 12 bars at 100 BPM; every cut falls on a beat). Style: high-end SaaS explainer, dark plum room, light DM Sans
headline with one bold phrase, the real site UI as layers. Everything on screen is either the site exactly as it
rendered at capture time or a line of caption in the site's own words; no invented numbers (all live figures
are 0 except the DCTY supply, read from the chain at capture time), no pills, badges or "LIVE" stamps.

Brand (from `web/ui.css` `:root` only): pink `#ff2d95`, pink-hi `#ff5fae`, violet `#b65cff`, cyan `#3ee8ff`,
ink `#0b0308`, card `#170810`, frame `#140811`, text `#fff4fa`, muted `rgba(255,228,243,.72)`, button `#ffe1f3`
on `#1c0713`. Font DM Sans 200–900. Logo `web/logo.svg` (the D sliced 40 / 20 / 40) and the kit wordmark.

Motion language: ease-out entrances `cubic-bezier(0.16, 1, 0.3, 1)`; UI pops on a spring with slight overshoot;
40–80 ms staggers; captions held ≥ 2.4 s; no pointer on screen, a click is a brief pink ring (gone within
300 ms); transitions grow out of the content (the mark's three bands become the split bar, the "Open the
dashboard" click ripples into the next room, the wall's pink glow blooms into the end card).

Note: the live dashboard dropped its "Where the fees went" panel while this was being made, so the fixed-split
scene uses the home page's own cycle wheel and card plus the dashboard's `#bar` styling, not a panel capture.
Two dashboard scenes ("Every number, on-chain" and "Every transaction") were cut at the user's request after the
first render; the captures and the rebuilt panels for them are no longer in the composition.

| # | Frames (s) | Scene | Picture | Motion | Caption / type | Background |
| - | ---------- | ----- | ------- | ------ | -------------- | ---------- |
| 1 | 0–216 (0.0–3.6) | Hook | The mark alone, then the wordmark | The D's outline draws on; the pink, violet and cyan bands slide in 200 ms apart; spring scale 0.72→1; one glow pulse; "Dacity" then "STRATEGY" wipe in | **Dacity** STRATEGY | Higgsfield *bay* (dusk bay), slow push, darkened 42 % |
| 2 | 216–504 (3.6–8.4) | Problem line | Two lines of kinetic type | Line 1 rises word by word (60 ms); line 2 snaps in bold on a spring and holds 2.9 s; both lift out as the page arrives | *Creator fees usually stay with the creator.* **Here, nothing is kept.** | *grid*, glide, darkened 55 % |
| 3 | 504–864 (8.4–14.4) | Reveal: the real site in one move | Pill nav, "Every fee works **for holders.**", lede, buttons (captured layers) and the ring rebuilt with the site's own CSS and maths, turning at 8°/s | Page rises 90 px on an ease-out while the camera pushes in 3.5 %; the "Open the dashboard" button takes its hover tint, a pink ring marks the click (frame 756), and an ink ripple from the button carries into the next room | none (the page is the type) | The site's own wall over *sky* at 30 % |
| 4 | 864–1296 (14.4–21.6) | One fixed rule | The mark at the bar's end; the 40 / 20 / 40 bar in the dashboard's `#bar` colours; the home page's cycle wheel and card at steps 2–4 | Bar draws on in three segments; 40 %, 20 %, 40 % count up; wheel and card crossfade through "40 % burns DCTY → 20 % buys back → 40 % to holders" every 2 s, the active segment glowing | *One rule,* **every cycle.** — Nothing is kept. Every fee the coin earns is split the same way, every time, and every step is public. | *tickets*, slow orbit, darkened 62 % |
| 5 | 1296–1728 (21.6–28.8) | End card | Mark, wordmark, tagline, URL, disclaimer | The wall's pink glow blooms; mark springs in; wordmark wipes in; tagline rises; the URL underlines itself; the disclaimer fades in last and holds 4.2 s; fade to ink | **Dacity** STRATEGY · Every fee works **for holders.** · splashg22.github.io/Yo · Independent project. Not affiliated with Take-Two Interactive, the TTWO issuer or pump.fun. Not financial advice. | *bay* from 2.5 s, darkened 50 % |

Audio: a bed and effects composed in code (see README › Audio). Cues in `src/cues.json`: hit on the logo
reveal (frame 36), whooshes at the cuts (200, 504, 804, 1296) and the bar draw (912), a click at the button click
(756), ticks under the 40 / 20 / 40 count (912–1032).