# Dacity Strategy · website walkthrough video

A 38-second motion-design walkthrough of https://splashg22.github.io/Yo/ in the style of a SaaS explainer:
the real site UI as separate layers, the brand taken only from `web/ui.css`, `web/logo.svg` and the kit in
`brand/kit/`, and background footage generated on Higgsfield from the project's own artwork.

| File | What |
| --- | --- |
| `out/dacity-walkthrough-4k.mp4` | The video: **3840 × 2160, 60 fps, H.264 (crf 17, max rate 18 Mbit/s so the file stays under GitHub's 100 MB limit), AAC track (silent, see Audio)** |
| `out/thumbnail.png` | Thumbnail still, 3840 × 2160 |
| `shotlist.md` | The shot list the composition follows |
| `footage/jobs.md` | Every Higgsfield job id and its cost |
| `src/` | The Remotion composition |
| `public/ui/` | The UI captured from the live pages at 2× (`capture-ui.mjs`) |
| `public/footage/` | The Higgsfield clips, re-encoded 8-bit H.264 for fast frame access (`footage/raw/` holds the originals) |
| `src/captured.json` | The texts, numbers and positions the live site showed when captured |

## Resolution, honestly

Higgsfield's video models do not output 8K. The clips were generated with **Seedance 2.0 at its `4k`
setting, which outputs 3840 × 2160** (the job params in `footage/jobs/*.json` say so and ffprobe agrees).
Topaz Video on Higgsfield upscales only to 2160p, so a Topaz pass would not have raised the resolution, and
the account had no credits left for one anyway. The UI layers were captured at device scale 2 from a
1920-wide viewport, so they are pixel-exact at 4K. The composition is laid out at 1920 × 1080 and rendered at
scale 2: **the delivered MP4 is 3840 × 2160.** An 8K master would require upscaling, which this project does
not do.

## What is on screen

Everything is either the website as it rendered at capture time or a line of caption in the site's own
words. All live figures were zero except the DCTY supply, which the dashboard read from the chain at
capture time (`src/captured.json` → `capturedAt`, `dashboard.updated`); the count-up runs 0 → that value
only. The history table shows the site's real empty state. The disclaimer is on the end card. No pills,
badges or "LIVE" stamps, no invented numbers, no GTA / Vice City marks.

Because the site is live, the supply and the "Updated HH:MM UTC" text change between captures. To refresh
them, re-run the capture (below) and re-render.

## Re-render

Needs Node 24 (`/Users/blueberry/.local/node-v24.22.0-darwin-arm64/bin` on this machine) and Google Chrome
for the capture step. Everything else is inside this folder.

```bash
cd brand/video
npm install                 # Remotion 4, React 18, puppeteer-core (for the capture only)
npm run capture             # optional: re-syncs the site assets and re-captures the live UI into public/ui and src/captured.json
node render.mjs             # 3840 × 2160 → out/dacity-walkthrough-4k.mp4 (about 20 min on an 8 GB M-series Mac)
node still.mjs --frame 690 --out out/thumbnail.png
```

`node render.mjs --scale 1` renders a 1920 × 1080 preview in a few minutes; `--frames 700-820` renders a
range; `--concurrency 3` if the machine has the memory. `npm run studio` opens the Remotion Studio.

`footage/generate.sh <bay|grid|tickets|sky>` regenerates a clip on Higgsfield (costs credits, see
`footage/jobs.md`); `footage/transcode.sh` re-encodes the downloads into `public/footage/`.

## Audio

The MP4 carries a **silent AAC track** so it drops into any editor or player as a normal file. No music or
sound effects are included, because no licensed track was available and the Higgsfield balance was spent
on footage. To add sound, supply:

1. **One music bed**, 38 s or longer, licensed for online video (royalty-free or a purchased licence):
   put it at `public/audio/bed.mp3` and set `AUDIO.bed` in `src/audio.ts`.
2. **Sound effects** (optional), short WAV/MP3 files for the cue points in `src/audio.ts`:
   logo bloom (0.9 s), type snap (5.3 s), page rise (7.4 s), bar draw (13.4 s), tile pops (20.0–20.3 s),
   click (23.7 s), copy click (30.5 s), end bloom (31.8 s).

Then `node render.mjs` again. The composition already contains the `<Audio>` elements, gated on those
paths being set.

## Motion language

Ease-out entrances on `cubic-bezier(0.16, 1, 0.3, 1)`, UI pops on a spring with slight overshoot
(`damping 13, stiffness 160`), 40–80 ms staggers, captions held at least 2.4 s, the cursor on quadratic
bezier paths with a press and ripple on click, the ring turned by the site's own `ring.js` maths at the
site's own 8°/s, the split bar drawn on in the dashboard's own `#bar` styling, the supply counted up with the
site's own ease-out cubic (`web/motion.js`).
