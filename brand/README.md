# brand/

The homepage is built from the files below. None is here yet. Put them in this folder
under exactly these names.

| File | What it is | Specification |
| --- | --- | --- |
| `hero.png` | The ring with the coin in its centre | 16:9, at least 3840 x 2160. Pure black background (#000000, not dark grey). Object in the right two thirds, left third empty. |
| `hero.mp4` | The ring turning a quarter turn, then separating into five layers | 6 seconds, 16:9, at least 1920 x 1080, locked camera, pure black background, constant speed, no cuts. |
| `layers.png` | The exploded stack of five layers | 16:9, at least 3840 x 2160. Pure black background. Centred, even gaps. |
| `logo.png` | The ring symbol | Square, at least 2048 x 2048, flat, one colour on black. |
| `banner.png` | Link-preview image | 3:1 from the generator. I crop it to 1200 x 630 for link previews, so keep the object clear of the outer edges. |
| `style-*.png` | The style screenshots (jacket product site, mazerealestate.fun) | Any size. Used only for comparison. Nothing from them is shipped. |

## What has to line up

These three points decide whether the scroll sequence looks like one object or three
different renders.

1. **The first frame of `hero.mp4` should be `hero.png`.** Generate the video from the
   still (image-to-video with `hero.png` as the start frame). The page shows the still
   first and swaps to the sequence once it has loaded; any difference shows as a jump.
2. **The last frame of `hero.mp4` should match `layers.png`.** Either use `layers.png` as
   the end frame of the video, or take `layers.png` from the video's last frame and
   upscale it. The five callouts are positioned on `layers.png`; if the video ends in a
   different arrangement, the lines will point at the wrong layers.
3. **Black must be true black in all of them.** The page is #000000. A render on #050505
   shows as a visible rectangle. If the generator will not give true black, tell me and I
   will key the background out, at some cost to the rim-light edges.

## Notes on the prompts in the brief

- `[NAME]` and `[ACCENT COLOUR]` are still placeholders in all six prompts.
- The lockup prompt asks the generator to set the name in a dot-matrix typeface.
  Generated lettering is rarely clean. I will set the name in the site's own font and
  redraw the symbol as SVG, so only the symbol needs to come out right.
- The exploded view has five layers and the page labels them, top to bottom: your wallet,
  the coin, the amount, the Ring, the public chain. The prompt's order (frosted glass,
  mesh, quilted metal, translucent, dark base plate) maps onto those one to one, so keep
  that order.
