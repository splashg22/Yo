#!/bin/zsh
# Re-encodes the Higgsfield downloads (HEVC 10-bit) to 8-bit H.264 4K at high quality so Remotion's
# frame extraction is fast; the picture is unchanged in size. Uses the ffmpeg Remotion ships.
cd "$(dirname "$0")"
D=../node_modules/@remotion/compositor-darwin-arm64
for n in bay grid sky tickets; do
  [ -f ../public/footage/$n.mp4 ] && continue
  DYLD_LIBRARY_PATH=$D $D/ffmpeg -y -hide_banner -loglevel error -i raw/$n.mp4 -an -c:v libx264 -preset medium -crf 15 -pix_fmt yuv420p -movflags +faststart ../public/footage/$n.mp4 && echo "$n done"
done
