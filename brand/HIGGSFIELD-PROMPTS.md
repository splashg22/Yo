# Higgsfield prompts

Six prompts, in the order to run them. Each result is saved into this folder under the
file name given. The site already runs on stand-ins with these names, so replacing a file
and running `npm run media` is all it takes. No code changes.

Name: RINGPAD. Accent colour: amber, #F5A524.

## The three rules that make the files match

1. **The video starts on `hero.png`.** Generate `hero.mp4` from `hero.png` as its first frame.
2. **The video ends on the stack shown in `layers.png`.** Same five layers, same order,
   same gaps, same lighting. Use `layers.png` as the video's last frame if the tool allows
   it. If it does not, make the video first and take `layers.png` from its last frame.
   The camera in the video is locked, so the stack ends where the ring began, on the right.
   `layers.png` itself shows that stack centred. The site handles the difference.
3. **Black is #000000 in every file.** Not dark grey. The site turns black into
   transparency so the page background can pass behind the object; a grey background
   would show as a faint rectangle.

## 1. `hero.png`

16:9, at least 3840 x 2160.

> Product-film render of a single thick metallic ring floating on a pure black background,
> a coin suspended in its centre. Liquid chrome surface with deep amber (#F5A524) and warm
> amber rim lights, sharp reflections, shallow depth of field, studio lighting from the
> upper left. Three-quarter angle, object fills the right two thirds of a 16:9 frame, left
> third empty black. Photoreal, high detail, no text, no logos, no background elements.

## 2. `layers.png`

16:9, at least 3840 x 2160. Reference image: `hero.png`.

> Same object and lighting as the reference image, shown as an exploded isometric stack of
> five separated layers floating above each other on pure black: a frosted glass sheet with
> water droplets on top, a fine mesh layer, a quilted metallic layer, a smooth translucent
> layer, a dark base plate. Even gaps between layers, same amber (#F5A524) and amber rim
> light. Centred, 16:9, no text, no labels, no lines.

Keep the layers in exactly this order, top to bottom. The page labels them 01 to 05:
your wallet, the coin, the amount, the Ring, the public chain.

## 3. `hero.mp4`

6 seconds, 16:9, at least 1920 x 1080. Start frame: `hero.png`. End frame: `layers.png`
if the tool takes one.

> Six seconds. The ring rotates slowly a quarter turn, then separates vertically into five
> floating layers with even gaps and holds still. Locked camera, pure black background,
> same lighting throughout, smooth constant speed, no cuts, no text.

## 4. `logo.png`

Square, at least 2048 x 2048. Reference image: `hero.png`, for mood only.

> Minimal logo mark for a crypto privacy brand called RINGPAD. A single bold geometric
> symbol built from one or two interlocking rings, partly hidden as if passing behind a
> wall. Flat vector style, amber (#F5A524) on a pure black background, mood taken from the
> reference image. Centred, generous empty space, sharp edges, no gradients, no glow, no
> 3D, no text, no letters. Must read clearly at 32 pixels.

The site draws its mark as SVG (`public/logo.svg`). When this file lands I redraw that SVG
from it by hand; the PNG itself is not shipped.

## 5. `lockup.png`

Wide, at least 3000 pixels across. Reference image: `logo.png`.

> Horizontal logo lockup: the ring symbol from the reference image on the left, the word
> "RINGPAD" on the right in a pixel / dot-matrix display typeface, all caps, wide spacing.
> White lettering, amber (#F5A524) symbol, pure black background. Flat, crisp, print
> quality. No tagline, no effects, no gradients, no other text.

This prompt appeared twice in the brief; it only needs running once. It is for use off
the site (social profiles, documents). On the site the name is set in the site's own font
next to the SVG mark, so generated lettering never has to be exact.

## 6. `banner.png`

3:1, at least 3600 x 1200. Reference image: `hero.png`.

> Wide banner, 3:1. Pure black background, the ring object from the reference image large
> and cropped off the right edge, same lighting. Leave the left half empty and black for a
> headline added later. No text, no gradients, no extra shapes.

The site crops the right-hand 1200 x 630 of this for link previews, so keep the object
inside the right half.

## After the files are in

```bash
npm run media     # cuts the frames, sizes the stills, makes the link-preview image
npm run build
```

Then check two things by eye: that the five callout lines still meet their layers (their
positions are the `layers` list in `site.config.ts`), and that the object sits where the
headline does not (its position in the video is `objectX` in the same file).
