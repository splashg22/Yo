#!/bin/zsh
# Generates the background footage on Higgsfield (Seedance 2.0, native 4K) from the project's own artwork.
# Usage: ./generate.sh <name>   (one of bay grid tickets sky). Logs the job JSON to jobs/<name>.json.
set -u
H=/Users/blueberry/.local/node-v24.22.0-darwin-arm64/bin/higgsfield
# References were pre-uploaded once (2560px JPEG copies of brand/art/*.jpg; the 8K files time out on upload):
#   miami-hero 8b6d0fd3-bd26-4bc0-9217-79c7fd573895   miami-grid 2da05214-607a-42ab-8db4-e9736c1247b8
#   miami-sky  443c55d8-3fcf-4a32-9fa8-f98d0ab3f4a9   card       bd6f32cf-6170-4cac-b8cf-2d6108329e0e
cd "$(dirname "$0")"
name=$1
case $name in
  bay)     ref=8b6d0fd3-bd26-4bc0-9217-79c7fd573895; dur=10; prompt="Slow cinematic forward drift over a calm bay at dusk, a distant city skyline in silhouette, the sky fading from hot pink through violet into deep plum, pale cyan rim light on the gently rippling water, soft haze, steady smooth camera, photoreal, calm and premium. No people, no boats, no text, no letters, no logos, no watermarks." ;;
  grid)    ref=2da05214-607a-42ab-8db4-e9736c1247b8; dur=5;  prompt="A glowing neon grid floor receding to a dusk horizon, pink grid lines on a near-black plum ground, slow continuous forward glide with a very slight upward tilt, atmospheric haze, soft violet glow at the horizon, steady camera, photoreal render. No text, no letters, no logos, no watermarks, no people." ;;
  tickets) ref=bd6f32cf-6170-4cac-b8cf-2d6108329e0e;         dur=10; prompt="Three tall translucent glass tickets standing in a shallow fan on a dark reflective floor, the left one glowing hot pink, the middle warm white, the right pale cyan, a very slow camera orbit around them, light flares sliding across the glass edges, long reflections moving on the floor, dark tiled wall behind, cinematic product photography. No text, no letters, no numbers, no logos, no watermarks, no people." ;;
  sky)     ref=443c55d8-3fcf-4a32-9fa8-f98d0ab3f4a9;  dur=5;  prompt="A dusk sky of slow-moving soft clouds in hot pink and violet over a deep plum darkness, gentle timelapse, smooth gradient, calm, no horizon objects, steady camera. No text, no letters, no logos, no watermarks, no people." ;;
  *) echo "unknown clip $name"; exit 2 ;;
esac
echo "[$name] start $(date -u +%FT%TZ) ref=$ref dur=$dur"
$H generate create seedance_2_0 --prompt "$prompt" --image-references "$ref" --duration $dur --resolution 4k --aspect_ratio 16:9 --generate_audio false --mode std --wait --wait-timeout 40m --wait-interval 10s --json > jobs/$name.json 2> jobs/$name.err
rc=$?
echo "[$name] done rc=$rc $(date -u +%FT%TZ)"
exit $rc
