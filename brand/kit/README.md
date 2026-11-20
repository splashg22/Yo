# Dacity Strategy brand kit

Built from the site's own tokens (`web/ui.css`), vector first. Rebuild everything with
`python3 brand/kit/build.py` (needs fontTools and Google Chrome); `--sheet` rebuilds only the sheet.

- `logo/mark.svg` — the mark: a D sliced 40 / 20 / 40 (pink burn, violet buyback, cyan holders).
- `logo/wordmark-on-dark.svg`, `logo/wordmark-on-light.svg` — "Dacity / STRATEGY" as paths (DM Sans 800 and 500).
- `logo/lockup-on-dark.svg`, `logo/lockup-on-light.svg` — mark plus wordmark.
- `png/` — mark, wordmark and lockup at 512 and 1024 px on transparent, light (#ffe1f3) and dark (#0b0308).
  The transparent exports use the on-dark colours (light text), for dark surfaces.
- `x/profile-400.png` — X profile picture, the mark at 56% so it survives the circular crop.
- `x/banner-1500x500.png` — X banner; content centred, bottom-left clear of the profile picture.
- `brand-sheet/brand-sheet.png` and `.pdf` — one page: palette, type, logo rules, do and don't.

Minimum sizes: mark 24 px on screen or 8 mm in print, lockup 120 px or 30 mm. Clear space: half the mark's height.
