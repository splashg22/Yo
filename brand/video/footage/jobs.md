# Higgsfield jobs for the walkthrough video

Account: the user's Higgsfield Plus workspace. Balance before this work: **1,069.75 credits**.
Model: **Seedance 2.0** (`seedance_2_0`), mode `std`, 16:9, resolution `4k` (the job params report
`width 3840, height 2160`), `generate_audio false`, one image reference each. Seedance 2.0 is the only
video model on the account that outputs native 4K (Seedance 2.5 lists `4k` too but costs 140 vs 110 per
5 s; Kling 4.0, Wan 3.0 and Veo 3.1 top out at 1080p). Topaz Video upscales only to 2160p, which is the
size these clips already are, so no upscale pass was bought (see README).

References were uploaded once as 2,560 px JPEG copies of `brand/art/*.jpg` (the 8K files time out on
upload): `miami-hero` 8b6d0fd3-bd26-4bc0-9217-79c7fd573895, `miami-grid` 2da05214-607a-42ab-8db4-e9736c1247b8,
`miami-sky` 443c55d8-3fcf-4a32-9fa8-f98d0ab3f4a9, `card` (three glass tickets) bd6f32cf-6170-4cac-b8cf-2d6108329e0e.
Prompts are in `generate.sh`; none asks for text, letters, logos or people.

## Attempt 1 — 2026-11-20 00:53 UTC (used in the video)

The CLI reported `request failed (no response received)` for all four, but the jobs had been created and
all four completed. Their results are the clips in `raw/`.

| Clip | Job id | Duration | Output | Credits |
| --- | --- | --- | --- | --- |
| tickets | b33d4684-2b25-406b-84e3-028b864af40d | 10 s | 3840 × 2160 | 220 |
| sky | b952a8d7-1999-48ea-b478-32e83f9f30e5 | 5 s | 3840 × 2160 | 110 |
| grid | ae7e2aee-fd03-4d9c-bdf1-a1a45af33b57 | 5 s | 3840 × 2160 | 110 |
| bay | 80468e1b-9544-412a-9150-1524843823a9 | 10 s | 3840 × 2160 | 220 |

## Attempt 2 — 2026-11-20 01:07 UTC (duplicate, my mistake)

Because of the false failure above I relaunched the set by upload id. Two jobs were accepted before the
account ran out of credits; the other two were refused (`not_enough_credits`). These two are paid-for
duplicates of *bay* and *grid* (same prompts and references, different takes). Both finished; they are kept
locally as `raw/bay-alt.mp4` and `raw/grid-alt.mp4` (the `raw/` folder is not committed) and are not used in the video.

| Clip | Job id | Duration | Credits |
| --- | --- | --- | --- |
| bay (duplicate) | 3ea8d625-a528-44c4-9f3c-a49199aeed72 | 10 s | 220 |
| grid (duplicate) | 70f91075-1431-46d0-b171-9f546ead9129 | 5 s | 110 |

## Totals

| | Credits |
| --- | --- |
| Clips used in the video | 660 |
| Duplicate clips (not needed) | 330 |
| **Spent on this video** | **990** |
| Balance after | 79.75 |

No Topaz Video, music or sound-effect jobs were run (not enough credits left for a Topaz pass, and the
clips are already 2160p; audio is placeholder-only, see README).
