# Dacity Strategy · website walkthrough video

A 28.8-second motion-design walkthrough of https://splashg22.github.io/Yo/ in the style of a SaaS explainer:
the real site UI as separate layers, the brand taken only from `web/ui.css`, `web/logo.svg` and the kit in
`brand/kit/`, and background footage generated on Higgsfield from the project's own artwork.

| File | What |
| --- | --- |
| `out/dacity-walkthrough-4k.mp4` | The video: **3840 × 2160, 60 fps, H.264 (crf 17, max rate 18 Mbit/s so the file stays under GitHub's 100 MB limit), AAC stereo at 48 kHz (see Audio)** |
| `out/thumbnail.png` | Thumbnail still, 3840 × 2160 |
| `shotlist.md` | The shot list the composition follows |
| `footage/jobs.md` | Every Higgsfield job id and its cost |
| `src/` | The Remotion composition |
| `public/ui/` | The UI captured from the live pages at 2× (`capture-ui.mjs`) |
| `public/footage/` | The Higgsfield clips, re-encoded 8-bit H.264 for fast frame access (`footage/raw/` holds the originals, not committed) |
| `public/audio/`, `audio/` | The soundtrack and the code that composes, levels and measures it |
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
words. Five scenes: hook, problem line, the home page revealed in one move, the fixed 40 / 20 / 40 rule with the
home page's own cycle wheel and card, end card with the disclaimer. There is no pointer on screen; the one click
is marked by a brief pink ring. Two dashboard scenes were cut at the user's request after the first render;
their captures (`public/ui/dash-*.png`) and texts (`src/captured.json`) are kept in case they return. No pills,
badges or "LIVE" stamps, no invented numbers, no GTA / Vice City marks.

Because the site is live, re-run the capture (below) before a re-render that should show the current page.

## Re-render

Needs Node 24 (`/Users/blueberry/.local/node-v24.22.0-darwin-arm64/bin` on this machine) and Google Chrome
for the capture step. Everything else is inside this folder.

```bash
cd brand/video
npm install                 # Remotion 4, React 18, puppeteer-core (for the capture only)
npm run capture             # optional: re-syncs the site assets and re-captures the live UI into public/ui and src/captured.json
node render.mjs             # 3840 × 2160 → out/dacity-walkthrough-4k.mp4 (about 15 min on an 8 GB M-series Mac)
node still.mjs --frame 690 --out out/thumbnail.png
```

`node render.mjs --scale 1` renders a 1920 × 1080 preview in a few minutes; `--frames 700-820` renders a
range; `--concurrency 3` if the machine has the memory. `npm run studio` opens the Remotion Studio.

`footage/generate.sh <bay|grid|tickets|sky>` regenerates a clip on Higgsfield (costs credits, see
`footage/jobs.md`); `footage/transcode.sh` re-encodes the downloads into `public/footage/`.

## Audio

The soundtrack is **composed and synthesized in code in this folder**, from plain oscillators, noise and
envelopes: no samples, no third-party audio code, no generated-audio service. It is the project's own work
and ships with the repository under the same terms as the rest of it.

- `audio/synth.mjs` writes the 28.8 s bed (`public/audio/bed.wav`: A minor, 100 BPM, 12 bars so every cut lands on a beat; pulsing bass, soft pad,
  light arpeggio, kick and hat, arranged to the scenes and fading out on the end card) and four effects
  (`sfx-hit`, `sfx-whoosh`, `sfx-click`, `sfx-tick`).
- `src/cues.json` places them: one hit on the logo reveal (frame 36), whooshes on the scene transitions and
  the bar draw, a click on the button click (frame 756), ticks while the 40 / 20 / 40 percentages count up.
  The composition reads the same file (`src/audio.ts`).
- `audio/mix.mjs` sums bed and cues exactly as placed, measures them with an ITU-R BS.1770-4 integrated
  loudness meter (K-weighting, 400 ms blocks, absolute and relative gates, implemented in that file) and
  bakes one gain into every file so the sum lands on the target. Result in `public/audio/loudness.json`:
  **−14.0 LUFS integrated, short-term max −12.7 LUFS, sample peak −1.4 dBFS, RMS −14.9 dBFS.** True
  (inter-sample) peak is not measured. The rendered MP4's AAC track, decoded back to WAV and measured the
  same way: **−14.04 LUFS integrated, short-term max −12.7 LUFS, sample peak −1.36 dBFS, RMS −14.9 dBFS.**

To change the music or the effects, edit `audio/synth.mjs`, then:

```bash
node audio/synth.mjs && node audio/mix.mjs && node render.mjs
```

`node audio/mix.mjs --measure-only some.wav` reports loudness, peak and RMS of any 48 kHz WAV.

## Motion language

Ease-out entrances on `cubic-bezier(0.16, 1, 0.3, 1)`, UI pops on a spring with slight overshoot
(`damping 13, stiffness 160`), 40–80 ms staggers, captions held at least 2.4 s, the cursor on quadratic
bezier paths with a press and ripple on click, the ring turned by the site's own `ring.js` maths at the
site's own 8°/s, the split bar drawn on in the dashboard's own `#bar` styling, the supply counted up with the
site's own ease-out cubic (`web/motion.js`).
