# Dusk Ledger
One long sunset runs behind the entire site: the miami-hero waterfront photograph fades downward into a warm pink-violet-indigo gradient that every section sits on, and neon appears only where light would actually come from (the sun-disc logo, the horizon rule under each heading, the glowing cursor of a live number). Numbers stay legible because they never sit on the raw photograph: every figure lives on a frosted indigo glass card with a solid 86% backing, Inter tabular numerals, and a single thin neon horizon line as its only decoration.

## palette
--night #0b0716 Page base and footer; the indigo the sunset dissolves into
--dusk #1a0f3a Card backing (used at 86% alpha over the gradient), table header, nav scrim
--violet #4a1d6b Mid-gradient band, hover tint, chart gridline base
--sunset-pink #ff2d95 Primary action, logo top band, active filter, 40% DCTY burn figure
--coral #ff7a59 Warm rim of the sun gradient, amber-ish 'pending' state tints
--gold #ffc966 Horizon highlight at the top of the hero scrim; never for text
--neon-violet #b65cff Logo middle band, 20% buyback figure, chart 'burned' series
--cyan #3ee8ff Logo bottom band, links, 40% holders figure, chart 'paid' series, live-update flash
--text #fbf4ff Headings and primary values
--muted #c3b5d6 Body copy, labels, table cells
--faint #8a7aa3 Captions, timestamps, disclaimer
--line #ffffff14 Card borders and table rules (8% white)
--ok #4ade80 Confirmed / claimed status
--warn #fbbf24 Pending / not launched status
--bad #fb7185 Error banner, failed tx

## gradients
--g-dusk | linear-gradient(180deg, #ffb86b 0%, #ff5d8f 18%, #c23fa6 40%, #4a1d6b 66%, #1a0f3a 86%, #0b0716 100%) | The page sky. Painted once on body as a fixed-height top layer (min 140vh on landing, 100vh on dashboard) so every section sits on the same sunset. Also the fallback behind miami-hero.jpg while it loads.
--g-hero-scrim | linear-gradient(180deg, rgba(11,7,22,0.18) 0%, rgba(11,7,22,0.05) 30%, rgba(26,15,58,0.55) 62%, rgba(11,7,22,0.96) 100%), linear-gradient(90deg, rgba(11,7,22,0.55) 0%, rgba(11,7,22,0.15) 45%, rgba(11,7,22,0) 70%) | Over the hero photograph: darkens the left third where the headline sits and the bottom where the tiles overlap, leaves the sun and skyline in the upper right untouched.
--g-horizon | linear-gradient(90deg, transparent 0%, #3ee8ff 20%, #ff2d95 50%, #b65cff 80%, transparent 100%) | The one neon element: a 2px rule under section headings, the top edge of the overview card on the dashboard, and the underline of the active nav link.
--g-split | linear-gradient(90deg, #ff2d95 0 40%, #b65cff 40% 60%, #3ee8ff 60% 100%) | The 40/20/40 bar in 'One Rule. Every Cycle' and the #bar element on the dashboard. Hard stops, no blending, so the proportions read as exact.
--g-card | linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 40%), rgba(26,15,58,0.86) | Every card: a faint top sheen over a near-opaque indigo backing, so text contrast is the same wherever the card lands on the sunset.
--g-sun-text | linear-gradient(180deg, #ffd1e8 0%, #ff5d8f 55%, #ff2d95 100%) | Clip-path text fill for one word only in the h1 ('Holders') and the big percentage values on the split cards; everything else is flat --text.
--g-grid-fade | linear-gradient(180deg, #0b0716 0%, rgba(11,7,22,0.2) 50%, #0b0716 100%) | Over miami-grid.jpg in the dashboard header band and site footer so the cyan floor grid stays a texture, not a focal point.

## typography
{
 "display": "Space Grotesk 500 and 700 (Google Fonts). Its squared counters and slightly wide stance read as 80s airport-signage without becoming a novelty face; 700 for h1/h2 at tight tracking, 500 for the wordmark letterspaced wide. It also carries tabular figures, so hero tiles can use it for values if Inter is not loaded yet.",
 "body": "Inter 400, 500, 600 (Google Fonts) with font-feature-settings 'cv11', 'ss01' off. Chosen for long-run legibility of fee copy, table cells and the disclaimer at 15px on a dark violet backing.",
 "numerals": "Inter 700 with font-variant-numeric: tabular-nums lining-nums for every live value (tiles, overview, kpis, table amounts) so digits do not jitter when they animate; Space Grotesk 700 only for the three static percentage figures (40 / 20 / 40) where the squared 4 and 0 become part of the brand. Units (SOL, TTWO, DCTY) are a 13px Inter 600 small cap in --muted after the figure.",
 "scale": "h1 clamp(2.6rem, 5.4vw, 4.2rem) / 1.04, letter-spacing -0.03em; h2 clamp(1.7rem, 3vw, 2.3rem) / 1.1, -0.02em; h3 16px / 1.3, -0.01em, weight 700; label 11px / 1.2, uppercase, letter-spacing 0.12em, weight 600; value (stat tile) 30px / 1.05, -0.03em; value big (split cards, overview) 40px / 1 (34px on phones); table cell 14px / 1.5; body 15px / 1.6; caption 13px / 1.45."
}

## logo
The Dusk D: a setting-sun disc squared off on its left edge into a letter D, sliced by two horizontal gaps into three bands in exact 40 / 20 / 40 proportion, the way a synthwave sun is banded as it meets the horizon. The bands carry the three fee destinations in colour: pink (DCTY burn), violet (buyback), cyan (holders). A single 1px horizon line sits beneath it. Original form, no reference to any game or studio mark; reads at 16px in the favicon as a banded D and at 120px on the hero as a sun.
DACITY in Space Grotesk 500, uppercase, letter-spacing 0.22em, --text; directly beneath at 55% size, STRATEGY in Space Grotesk 500, letter-spacing 0.3em, --cyan. Locked to the left of the mark with the baseline of DACITY aligned to the top edge of the D's middle band. Single-line variant for the sticky nav: mark + 'Dacity Strategy' in Space Grotesk 700, 16px, no tracking.

## layout landing
1) Sticky header (64px): Dusk D mark + wordmark left; nav How it works / On-Chain / Dashboard / GitHub (#repo) centre-right; #buy-nav as the one pink pill button. Background rgba(11,7,22,.55) with backdrop blur, bottom edge is --g-horizon at 1px, 40% opacity. 2) Hero (min-height 92vh, full-bleed): miami-hero.jpg as background, positioned 68% 40% so the sun and skyline sit upper-right; --g-hero-scrim over it. Left column (max 620px): label 'Creator fees, every cycle' in cyan; h1 'Every Fee Works for <span class=sun>Holders</span>' (#title); lead with the one-sentence mechanic; buttons #buy-hero (pink) and 'Open dashboard' (glass). The hero's bottom 120px is where the #tiles row overlaps: four glass stat tiles (Treasury TTWO, SOL balance, Burned DCTY, Paid to holders) in a 4-col grid pulled up with margin-top -96px, each with its live value, unit and 'as of' caption; zero values render as '0' with a --warn dot and 'Not launched yet' sub, never blank. 3) 'One Rule. Every Cycle' (#how, padding 96px 0): h2 with --g-horizon rule beneath; the 40/20/40 split bar full-width (--g-split, 14px tall, rounded, three labels above it); below, three split cards in a 3-col grid, each with ticket-pink / ticket-white / ticket-blue.jpg as a right-aligned 38% wide background faded under --g-card, big percentage in --g-sun-text (pink, violet, cyan respectively via .pct-burn/.pct-buyback/.pct-holders), name, one-line explanation, #minhold inline in the holders card. To the right on wide screens (>1100px) a tall portrait panel showing miami-palms.jpg at 3:4 with a cyan caption 'Minimum hold: 1,000,000' overlaid at the bottom; on tablet the panel drops below the cards as a 16:9 strip. 4) On-Chain (#proof, padding 96px 0 72px): h2 'On-Chain' + caption 'Read live from Solana in your browser'; 2-col grid: left a 'Creator vaults and treasury' card with #treasury-link and the address list (#addresses, mono, copy buttons); right a 'Cumulative' card with the per-cycle totals and a 'Open dashboard' link. #error banner slot sits above the grid. 5) Footer band: miami-grid.jpg under --g-grid-fade, 220px tall; mark + wordmark, GitHub (#repo), dashboard link, and the disclaimer in --faint 13px: 'Independent project. Not affiliated with Take-Two Interactive, the TTWO issuer or pump.fun. Not financial advice.' #top back-to-top as a small cyan circle bottom-right.

## layout dashboard
1) Same sticky header; the nav's active item is 'Dashboard' with the --g-horizon underline; #refresh (glass button with a rotating-arrow icon that spins only while fetching) and #buy sit right. 2) Dashboard header band (180px): miami-grid.jpg under --g-grid-fade, h1 'Dashboard' (#brand-title) with caption 'Updated <time> · next cycle <#next>' and #error slot. 3) OVERVIEW ROW (#overview), the first thing under the band and the only element allowed to break the sunset: one wide glass card, top edge --g-horizon 2px, containing three equal columns separated by 1px --line dividers: Treasury (TTWO, 40px value, sub 'in creator vaults + treasury'), SOL balance (40px value, #sol-note caption for rent/fees), Supply (DCTY and strategy coin supply with burned amount struck through beneath). On phones the three stack but stay inside the one card with horizontal dividers, so they still read as one overview. 4) KPI tiles (#kpis): 4-col grid of smaller stat tiles (Burned DCTY, Bought back and burned, Paid to holders, Cycles run). 5) Split and next cycle: 2-col; left card holds #bar (--g-split, 14px) with #split legend and #split-caption; right card 'Next cycle' with #next countdown and the preview of how the pending fee amount would split (splitPreview output), all zero-safe. 6) Charts: 2-col, #chart-paid (cyan series) and #chart-burned (violet series) on cards with --violet gridlines at 25% and no chart background. 7) History: #filters as a row of chip toggles (All / Burn / Buyback / Payout / Claim) in a sticky sub-bar at the top of the table card; table (#tbody) with sticky header row in --dusk, mono signatures truncated with a copy affordance, amounts right-aligned tabular; #more 'Load more' glass button centered beneath; #ledger-link and #activity-note in the card footer. 8) Footer identical to landing. #top floating button on both pages.

## imagery
- web/art/miami-hero.jpg (master brand/art/miami-hero.jpg) - NOT YET IN PROJECT; prompt exists at brand/art/prompt-miami-hero.txt and out-miami-hero.json is empty, so the generation must be run or re-run and the export placed at web/art/miami-hero.jpg (21:9, target 2560x1097, JPEG q82, plus a 1280px variant web/art/miami-hero-md.jpg for srcset). | Landing hero, full-bleed background inside .hero-media; also the og:image source (crop to 1200x630 centred on the sun) replacing web/og.png. | object-fit: cover; object-position 68% 40% so the sun and far-shore skyline sit in the upper right and the left third is water and palm shadow where the headline goes. On phones (<640px) switch to object-position 62% 50% and min-height auto so the palms frame the headline rather than being cut. | --g-hero-scrim: vertical layer rgba(11,7,22,.18) top to .96 bottom with the darkening starting at 62%, plus a horizontal layer .55 at the left fading to 0 at 70%. Headline contrast against the darkest part of the scrim is >= 7:1; the sun is left untouched. A blurred radial .hero-sun div adds the gentle glow animation on top of the photograph rather than modifying it.
- web/art/miami-grid.jpg (master brand/art/miami-grid.jpg) - NOT YET IN PROJECT; prompt at brand/art/prompt-miami-grid.txt. Export 16:9, 2048x1152, q80, to web/art/miami-grid.jpg. | Dashboard header band (180px tall) behind the page title and refresh caption; site footer background on both pages. | object-position center 70% so the cyan grid floor and thin pink horizon line sit across the lower half of the band; the empty upper two thirds of the image are mostly cropped away. | --g-grid-fade: #0b0716 at 0%, rgba(11,7,22,.2) at 50%, #0b0716 at 100%, with the image itself at opacity .5. The grid stays a texture under 13px footer text; disclaimer contrast stays >= 4.5:1.
- web/art/miami-palms.jpg (master brand/art/miami-palms.jpg) - NOT YET IN PROJECT; prompt at brand/art/prompt-miami-palms.txt. Export 3:4, 1536x2048, q82, to web/art/miami-palms.jpg. | Right-hand portrait panel beside the three split cards in 'One Rule. Every Cycle' on screens wider than 1100px; becomes a 16:9 strip under the cards on tablet; hidden on phones to save bandwidth (loading=lazy everywhere). | Portrait panel: object-position center 35% so the crescent moon stays in frame above the palm tops. Tablet strip: object-position center 55% to keep both palm silhouettes. | linear-gradient(180deg, rgba(11,7,22,0) 45%, rgba(11,7,22,.85) 100%) plus a 1px --g-horizon rule above the caption; the caption 'Minimum hold: 1,000,000' is 13px cyan over the solid lower band.
- web/art/card.jpg (three glass tickets, existing) | Open Graph fallback and the 'Cumulative' card header in the On-Chain section as a 120px tall strip above the figures. | object-position center 55%, aspect 1160/120 so only the glowing bases of the three tickets and the reflective floor show; the magenta wall glow blends into the card backing. | linear-gradient(180deg, rgba(26,15,58,.1), rgba(26,15,58,.95)) so the figures beneath sit on solid indigo.
- web/art/ticket-pink.jpg, ticket-white.jpg, ticket-blue.jpg (existing) | Right 42% of each of the three split cards (DCTY burn = pink, buyback = white, holders = blue), tying each ticket colour to its fee destination. | object-fit cover, object-position center 30% so the lit upper half of the ticket is visible; width 42% of the card, full height. | opacity .55 under --g-card plus a horizontal mask-image fading the left 35% to transparent so the percentage and text sit on the plain indigo part of the card.
- web/art/wall.jpg (existing) | Dashboard body background texture behind the history table card only, inside a 1px-bordered region below the charts. | background-size cover, background-position center 40%, background-attachment scroll. | rgba(11,7,22,.9) flat scrim; the wall is felt as subtle texture, never read as an image.
- web/art/hero.jpg and header.jpg (existing) | Retired from the pages; hero.jpg kept as the og:image fallback until miami-hero.jpg exists, header.jpg kept in brand/art only. | og: 1200x630 centred on the ticket. | none

## animation
- hero-sun-glow | Runs continuously on .hero-sun while the hero is in the viewport (paused with animation-play-state when an IntersectionObserver reports it offscreen). | @keyframes sun-breathe{0%,100%{opacity:.7;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
.hero-sun{animation:sun-breathe 7s ease-in-out infinite;will-change:opacity,transform}
.hero.offscreen .hero-sun{animation-play-state:paused}
@media (prefers-reduced-motion:reduce){.hero-sun{animation:none;opacity:.85}}
- headline-shimmer | Once on page load, after fonts are ready (document.fonts.ready), on h1 .sun only. | @keyframes shimmer{from{background-position:0% 0}to{background-position:200% 0}}
h1 .sun{background-image:linear-gradient(100deg,#ffd1e8 0%,#ff5d8f 35%,#fff0f7 50%,#ff5d8f 65%,#ff2d95 100%);background-size:200% 100%;animation:shimmer 1.4s var(--ease) 1 .3s both}
@media (prefers-reduced-motion:reduce){h1 .sun{animation:none;background-image:var(--g-sun-text)}}
- page-enter | On every page load and on navigation between index.html and dashboard.html (View Transitions API where supported via @view-transition{navigation:auto}; plain body fade elsewhere). | @view-transition{navigation:auto}
::view-transition-old(root){animation:fade-out .18s ease both}
::view-transition-new(root){animation:fade-in .26s var(--ease) both}
@keyframes fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes fade-out{to{opacity:0}}
body{animation:fade-in .3s var(--ease) both}
@media (prefers-reduced-motion:reduce){body,::view-transition-old(root),::view-transition-new(root){animation:none}}
- section-reveal | IntersectionObserver adds .in to each [data-reveal] element (section heads, cards, table card) at 12% visibility, once; children stagger via --i index set in the markup. Elements are visible by default when JS is disabled (the .reveal class is only applied by JS). | .reveal{opacity:0;transform:translateY(14px);transition:opacity .45s var(--ease),transform .45s var(--ease);transition-delay:calc(var(--i,0)*60ms)}
.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}}
- card-hover | Pointer hover on .card.hoverable (stat tiles, split cards, chart cards); not applied to the table card or overview row. | .card.hoverable{transition:transform .22s var(--ease),border-color .22s var(--ease),box-shadow .22s var(--ease)}
.card.hoverable:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.18);box-shadow:0 24px 48px -28px rgba(11,7,22,.9),0 0 0 1px rgba(62,232,255,.08)}
@media (hover:none),(prefers-reduced-motion:reduce){.card.hoverable:hover{transform:none}}
- metric-update | Only when a live value is first rendered or when a refresh changes its text. The render helper compares the new string to the old; if different it sets textContent, toggles .tick (remove, force reflow, add), and runs a 500ms count-up from old to new numeric value with requestAnimationFrame. Unchanged values and zero-to-zero refreshes trigger nothing. | @keyframes tick{0%{color:var(--cyan);text-shadow:0 0 18px rgba(62,232,255,.8)}100%{color:inherit;text-shadow:none}}
.value.tick{animation:tick .7s var(--ease) 1}
/* count-up: JS eases from old to new over 500ms with t=1-(1-x)^3 and formats with fmt(); on prefers-reduced-motion it sets the final value immediately and still runs the colour tick, which is a colour change, not motion. */
@media (prefers-reduced-motion:reduce){.value.tick{animation-duration:.4s}}
- refresh-spin and loading skeleton | #refresh gets aria-busy=true while fetches are in flight; values waiting for their first fetch show a skeleton bar instead of text. | @keyframes spin{to{transform:rotate(360deg)}}
#refresh[aria-busy=true] .icon{animation:spin .9s linear infinite}
@keyframes skeleton{0%{background-position:200% 0}100%{background-position:-200% 0}}
.value.loading{display:block;height:1em;width:60%;border-radius:6px;color:transparent;background:linear-gradient(90deg,rgba(255,255,255,.06) 25%,rgba(255,255,255,.14) 50%,rgba(255,255,255,.06) 75%);background-size:200% 100%;animation:skeleton 1.4s linear infinite}
@media (prefers-reduced-motion:reduce){#refresh[aria-busy=true] .icon{animation:none;opacity:.5}.value.loading{animation:none;background:rgba(255,255,255,.08)}}

## components
### Tokens, sky and base
@import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&display=swap");
:root{--night:#0b0716;--dusk:#1a0f3a;--violet:#4a1d6b;--sunset-pink:#ff2d95;--coral:#ff7a59;--gold:#ffc966;--neon-violet:#b65cff;--cyan:#3ee8ff;--text:#fbf4ff;--muted:#c3b5d6;--faint:#8a7aa3;--line:rgba(255,255,255,.08);--line-2:rgba(255,255,255,.16);--ok:#4ade80;--warn:#fbbf24;--bad:#fb7185;--g-dusk:linear-gradient(180deg,#ffb86b 0%,#ff5d8f 18%,#c23fa6 40%,#4a1d6b 66%,#1a0f3a 86%,#0b0716 100%);--g-horizon:linear-gradient(90deg,transparent 0%,#3ee8ff 20%,#ff2d95 50%,#b65cff 80%,transparent 100%);--g-split:linear-gradient(90deg,#ff2d95 0 40%,#b65cff 40% 60%,#3ee8ff 60% 100%);--g-card:linear-gradient(180deg,rgba(255,255,255,.06) 0%,rgba(255,255,255,0) 40%),rgba(26,15,58,.86);--g-sun-text:linear-gradient(180deg,#ffd1e8 0%,#ff5d8f 55%,#ff2d95 100%);--display:"Space Grotesk","Inter",system-ui,sans-serif;--body:"Inter",system-ui,sans-serif;--mono:ui-monospace,Menlo,Consolas,monospace;--r:16px;--gap:16px;--ease:cubic-bezier(.22,1,.36,1)}
*{box-sizing:border-box}
html{background:var(--night);scroll-behavior:smooth;scroll-padding-top:84px}
body{margin:0;min-height:100vh;color:var(--text);font:15px/1.6 var(--body);-webkit-font-smoothing:antialiased;background:var(--night);position:relative;overflow-x:hidden}
body::before{content:"";position:absolute;inset:0 0 auto 0;height:140vh;background:var(--g-dusk);z-index:-2;pointer-events:none}
body.dashboard::before{height:100vh}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline;text-decoration-color:rgba(62,232,255,.5)}
[hidden]{display:none!important}
.container{max-width:1160px;margin:0 auto;padding:0 24px}
.num{font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.02em}
.mono{font-family:var(--mono);font-size:.9em;overflow-wrap:anywhere}
.muted{color:var(--muted)}.faint{color:var(--faint)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
@media (max-width:640px){.container{padding:0 16px}}
### Header and brand
.site-header{position:sticky;top:0;z-index:30;background:rgba(11,7,22,.55);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%)}
.site-header::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--g-horizon);opacity:.4}
.site-header .container{display:flex;align-items:center;justify-content:space-between;height:64px;gap:20px}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);font:700 16px/1 var(--display);letter-spacing:-.01em}
.brand:hover{text-decoration:none}
.brand .logo{width:28px;height:28px;flex:none;filter:drop-shadow(0 0 8px rgba(255,45,149,.45))}
.wordmark{display:grid;line-height:1}
.wordmark b{font:500 18px/1 var(--display);letter-spacing:.22em;text-transform:uppercase;color:var(--text)}
.wordmark small{font:500 10px/1 var(--display);letter-spacing:.3em;text-transform:uppercase;color:var(--cyan);margin-top:4px}
.site-nav{display:flex;align-items:center;gap:22px}
.site-nav a{position:relative;color:var(--muted);font:600 14px/1 var(--body);padding:6px 0}
.site-nav a:hover{color:var(--text);text-decoration:none}
.site-nav a[aria-current=page]{color:var(--text)}
.site-nav a[aria-current=page]::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:2px;border-radius:2px;background:var(--g-horizon)}
@media (max-width:760px){.site-nav a:not(.btn){display:none}}
### Buttons
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 20px;border-radius:999px;border:1px solid var(--line-2);background:rgba(26,15,58,.6);color:var(--text);font:700 14px/1 var(--body);cursor:pointer;white-space:nowrap;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .18s var(--ease),border-color .18s var(--ease),transform .18s var(--ease),box-shadow .18s var(--ease)}
.btn:hover{background:rgba(74,29,107,.7);border-color:rgba(255,255,255,.26);text-decoration:none;transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.btn-primary{background:var(--sunset-pink);border-color:var(--sunset-pink);color:#fff;box-shadow:0 10px 28px -12px rgba(255,45,149,.75),0 0 0 0 rgba(255,45,149,0)}
.btn-primary:hover{background:#ff47a3;border-color:#ff47a3;box-shadow:0 14px 32px -12px rgba(255,45,149,.9)}
.btn-sm{height:36px;padding:0 14px;font-size:13px}
.btn:disabled{opacity:.5;cursor:default;transform:none}
.btn .icon{width:16px;height:16px}
#refresh[aria-busy=true] .icon{animation:spin .9s linear infinite}
### Hero
.hero{position:relative;min-height:92vh;display:flex;align-items:center;padding:120px 0 200px;isolation:isolate;overflow:hidden}
.hero-media{position:absolute;inset:0;z-index:-1;background:var(--g-dusk)}
.hero-media img{width:100%;height:100%;object-fit:cover;object-position:68% 40%;display:block}
.hero-media::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,7,22,.18) 0%,rgba(11,7,22,.05) 30%,rgba(26,15,58,.55) 62%,rgba(11,7,22,.96) 100%),linear-gradient(90deg,rgba(11,7,22,.55) 0%,rgba(11,7,22,.15) 45%,rgba(11,7,22,0) 70%)}
.hero-sun{position:absolute;right:12%;top:18%;width:min(28vw,360px);aspect-ratio:1;border-radius:50%;z-index:-1;pointer-events:none;background:radial-gradient(circle,rgba(255,201,102,.55) 0%,rgba(255,93,143,.35) 35%,rgba(255,45,149,0) 70%);filter:blur(28px);mix-blend-mode:screen}
.hero-copy{max-width:620px}
.hero .label{color:var(--cyan);font:600 11px/1.2 var(--body);letter-spacing:.12em;text-transform:uppercase;margin-bottom:18px}
h1{margin:0;font:700 clamp(2.6rem,5.4vw,4.2rem)/1.04 var(--display);letter-spacing:-.03em;text-wrap:balance}
h1 .sun{background:var(--g-sun-text);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none}
.lead{margin:20px 0 0;max-width:52ch;font-size:clamp(1rem,1.4vw,1.15rem);line-height:1.6;color:var(--muted)}
.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:32px}
#tiles{position:relative;z-index:2;margin-top:-96px}
@media (max-width:900px){.hero{min-height:auto;padding:88px 0 160px}#tiles{margin-top:-120px}}
### Card and stat tiles
.card{position:relative;background:var(--g-card);border:1px solid var(--line);border-radius:var(--r);padding:22px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform .22s var(--ease),border-color .22s var(--ease),box-shadow .22s var(--ease)}
.card.hoverable:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.18);box-shadow:0 24px 48px -28px rgba(11,7,22,.9),0 0 0 1px rgba(62,232,255,.08)}
.card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}
.card-head h3{margin:0;font:700 16px/1.3 var(--display);letter-spacing:-.01em}
.grid{display:grid;gap:var(--gap)}
.cols-2{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(3,1fr)}.cols-4{grid-template-columns:repeat(4,1fr)}
.label{font:600 11px/1.2 var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.stat .label{margin-bottom:10px}
.stat .value{font:700 30px/1.05 var(--body);letter-spacing:-.03em;font-variant-numeric:tabular-nums lining-nums;overflow-wrap:anywhere;color:var(--text)}
.stat .value small{font:600 13px/1 var(--body);color:var(--muted);margin-left:6px;letter-spacing:0;text-transform:uppercase}
.stat .sub{margin-top:8px;font-size:13px;color:var(--faint)}
.stat.big .value{font-size:40px}
.stat .value.is-zero{color:var(--muted)}
.stat .status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--faint)}
.stat .status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--warn);box-shadow:0 0 8px var(--warn)}
.stat .status.live::before{background:var(--ok);box-shadow:0 0 8px var(--ok)}
@media (max-width:1000px){.cols-4{grid-template-columns:repeat(2,1fr)}.cols-3{grid-template-columns:repeat(2,1fr)}}
@media (max-width:640px){.cols-2,.cols-3,.cols-4{grid-template-columns:1fr}.stat.big .value{font-size:34px}}
### Section heading with horizon rule
.section{padding:96px 0 0}
.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:28px;padding-bottom:16px;position:relative}
.section-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--g-horizon);opacity:.7;border-radius:2px}
h2{margin:0;font:700 clamp(1.7rem,3vw,2.3rem)/1.1 var(--display);letter-spacing:-.02em}
.section-head p{margin:0;color:var(--muted);font-size:14px}
### Fee split bar and split cards
.split-bar{height:14px;border-radius:999px;background:var(--g-split);box-shadow:0 0 24px -6px rgba(182,92,255,.6);position:relative;overflow:hidden}
.split-bar::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,0) 55%)}
.split-legend{display:grid;grid-template-columns:40fr 20fr 40fr;gap:8px;margin-bottom:10px}
.split-legend span{font:600 12px/1.2 var(--body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.split-legend span:nth-child(2){text-align:center}.split-legend span:nth-child(3){text-align:right}
.split-cards{margin-top:28px}
.split-cards .card{overflow:hidden;min-height:220px;display:flex;flex-direction:column;justify-content:flex-end}
.split-cards .card .ticket{position:absolute;top:0;right:0;width:42%;height:100%;object-fit:cover;object-position:center 30%;opacity:.55;mask-image:linear-gradient(90deg,transparent 0%,#000 35%);-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 35%)}
.split-cards .value{font:700 clamp(2.6rem,4vw,3.4rem)/1 var(--display);letter-spacing:-.04em;font-variant-numeric:tabular-nums;position:relative}
.pct-burn{color:var(--sunset-pink)}.pct-buyback{color:var(--neon-violet)}.pct-holders{color:var(--cyan)}
.split-cards .value{text-shadow:0 0 28px currentColor}
#bar{height:14px;border-radius:999px;background:var(--g-split);overflow:hidden}
#split{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
#split .k{font:600 11px/1.2 var(--body);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
#split .v{font:700 20px/1.1 var(--body);font-variant-numeric:tabular-nums;margin-top:4px}
### Dashboard overview row
#overview{display:grid;grid-template-columns:repeat(3,1fr);padding:0;overflow:hidden}
#overview::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--g-horizon)}
#overview .item{padding:26px 28px;border-left:1px solid var(--line)}
#overview .item:first-child{border-left:0}
#overview .label{margin-bottom:12px}
#overview .value{font:700 40px/1 var(--body);letter-spacing:-.035em;font-variant-numeric:tabular-nums lining-nums;overflow-wrap:anywhere}
#overview .value small{font:600 14px/1 var(--body);color:var(--muted);margin-left:8px;letter-spacing:0}
#overview .sub{margin-top:10px;font-size:13px;color:var(--faint)}
#overview .sub s{color:var(--faint);text-decoration-color:rgba(255,45,149,.6)}
@media (max-width:860px){#overview{grid-template-columns:1fr}#overview .item{border-left:0;border-top:1px solid var(--line)}#overview .item:first-child{border-top:0}#overview .value{font-size:34px}}
### Filters, table and history
#filters{display:flex;gap:8px;flex-wrap:wrap;padding:14px 0;position:sticky;top:64px;z-index:5;background:rgba(26,15,58,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);margin:-22px -22px 0;padding-left:22px;padding-right:22px;border-bottom:1px solid var(--line);border-radius:var(--r) var(--r) 0 0}
.chip{height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--line-2);background:transparent;color:var(--muted);font:600 13px/1 var(--body);cursor:pointer;transition:background .16s var(--ease),color .16s var(--ease),border-color .16s var(--ease)}
.chip:hover{color:var(--text);border-color:rgba(255,255,255,.3)}
.chip[aria-pressed=true]{background:rgba(255,45,149,.16);border-color:var(--sunset-pink);color:#fff;box-shadow:0 0 16px -6px rgba(255,45,149,.8)}
.table-wrap{overflow-x:auto;margin:0 -22px;padding:0 22px;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:14px}
thead th{position:sticky;top:0;background:var(--dusk);color:var(--faint);font:600 11px/1.2 var(--body);letter-spacing:.1em;text-transform:uppercase;text-align:left;padding:12px 10px;border-bottom:1px solid var(--line-2)}
tbody td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:middle;color:var(--muted)}
tbody tr{transition:background .14s var(--ease)}
tbody tr:hover{background:rgba(255,255,255,.035)}
td.amt,th.amt{text-align:right;font-variant-numeric:tabular-nums lining-nums;color:var(--text);font-weight:600}
td.sig a{font-family:var(--mono);font-size:12.5px;color:var(--cyan)}
.tag{display:inline-block;padding:3px 9px;border-radius:999px;font:600 11px/1.2 var(--body);letter-spacing:.06em;text-transform:uppercase}
.tag.burn{background:rgba(255,45,149,.16);color:#ff8ac4}.tag.buyback{background:rgba(182,92,255,.18);color:#d3a4ff}.tag.payout{background:rgba(62,232,255,.14);color:#8ff3ff}.tag.claim{background:rgba(255,201,102,.14);color:#ffd98a}
.table-empty{padding:40px 16px;text-align:center;color:var(--faint)}
#more{display:flex;margin:18px auto 0}
### Charts, addresses, error, footer
.chart{height:220px;position:relative}
.chart svg{width:100%;height:100%;display:block}
.chart .grid line{stroke:rgba(74,29,107,.6);stroke-width:1}
.chart .axis text{fill:var(--faint);font:500 11px var(--body)}
#chart-paid .series{stroke:var(--cyan);fill:rgba(62,232,255,.14)}
#chart-burned .series{stroke:var(--neon-violet);fill:rgba(182,92,255,.16)}
.chart .series{stroke-width:2;stroke-linejoin:round}
.chart .empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--faint);font-size:13px}
#addresses{display:grid;gap:10px}
#addresses .addr{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:rgba(11,7,22,.4)}
#addresses .addr code{font:500 12.5px/1.4 var(--mono);color:var(--muted);overflow-wrap:anywhere}
#error{background:rgba(251,113,133,.12);border:1px solid rgba(251,113,133,.4);color:#ffd3da;border-radius:12px;padding:12px 16px;font-size:14px;margin-bottom:var(--gap)}
.site-footer{position:relative;margin-top:96px;padding:56px 0 40px;isolation:isolate;overflow:hidden;background:var(--night)}
.site-footer .bg{position:absolute;inset:0;z-index:-1}
.site-footer .bg img{width:100%;height:100%;object-fit:cover;object-position:center 70%;opacity:.5}
.site-footer .bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#0b0716 0%,rgba(11,7,22,.2) 50%,#0b0716 100%)}
.site-footer .row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;align-items:flex-start}
.site-footer .links{display:flex;gap:20px;flex-wrap:wrap}
.site-footer .links a{color:var(--muted);font-weight:600;font-size:14px}
.disclaimer{margin-top:28px;font-size:13px;line-height:1.5;color:var(--faint);max-width:70ch}
#top{position:fixed;right:20px;bottom:20px;width:40px;height:40px;border-radius:50%;border:1px solid rgba(62,232,255,.4);background:rgba(11,7,22,.7);color:var(--cyan);display:grid;place-items:center;backdrop-filter:blur(8px);z-index:20;transition:opacity .2s var(--ease),transform .2s var(--ease)}
#top[hidden]{display:grid!important;opacity:0;pointer-events:none;transform:translateY(8px)}

## risks
- The three Miami assets do not exist yet: brand/art has only prompt-miami-hero.txt, prompt-miami-grid.txt, prompt-miami-palms.txt and an empty out-miami-hero.json. Until web/art/miami-hero.jpg, miami-grid.jpg and miami-palms.jpg are generated and exported, the hero falls back to the --g-dusk gradient alone and the footer/dashboard band to flat --night; the build must not substitute stock or placeholder art.
- Pre-launch zero state: every live figure except DCTY supply is 0 right now. The design shows '0' with a --warn 'Not launched yet' status rather than hiding tiles, and the charts render an explicit empty state; the count-up and tick animations must not fire on 0-to-0 refreshes or the page will flash for no reason.
- Legibility over the photograph depends on the scrim and on the headline staying in the left third. If a generated hero has its sun or skyline on the left, flip object-position to 32% 40% and mirror the horizontal scrim rather than moving the headline over the bright area.
- Neon creep: the brief forbids excessive effects. Neon is budgeted to four places (logo glow, horizon rules, active chip, metric tick). Adding glow to table rows, borders or the split bar labels would collapse the hierarchy.
- backdrop-filter on many cards plus a fixed-height gradient layer can cost frames on older phones; cards use a near-opaque backing so the blur can be removed under a (max-width:640px) or prefers-reduced-transparency query with no contrast loss.
- Pink text on violet (#ff2d95 on #4a1d6b) is about 3.6:1, so pink is used for the big 40% figures at display size and for buttons, never for body or table text; links use cyan (#3ee8ff on #1a0f3a is about 10:1).
- Element ids and the inline module scripts in index.html and dashboard.html must be preserved exactly (tiles, kpis, overview, bar, split, next, chart-paid, chart-burned, filters, tbody, more, top, refresh, treasury-link, buy, buy-nav, buy-hero, minhold, pct-*, self-name, addresses, repo, error, plus sol-note, split-caption, ledger-link, activity-note, brand-title, nav-title, title). The overview and filter markup changes shape (three .item columns, chip buttons) so the render functions that write into #overview and #filters need their templates updated, not just the CSS.
- Google Fonts adds two requests; if the GitHub Pages site should stay dependency-light, self-host the two families as woff2 in web/fonts and keep font-display: swap so values never render invisible.
- The logo's three bands at 16px favicon size need the gaps widened to 1.6 units in a dedicated favicon.svg; at 32px and up the 1.2 gap reads correctly.
