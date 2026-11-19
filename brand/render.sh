#!/usr/bin/env bash
# Renders the brand sources to PNG with headless Chrome. Needs network once for the font.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
render() { # name width height
  # Headless Chrome keeps some window height for itself, so render 200px taller with the stage 100px down and crop the centre.
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=8000 \
    --window-size="$2,$(($3 + 200))" --screenshot="out/$1.png" "file://$PWD/src/$1.html" >/dev/null 2>&1
  sips -c "$3" "$2" "out/$1.png" >/dev/null
  echo "out/$1.png ($2x$3)"
}
render avatar 400 400
render banner 1500 500
render post-announce 1200 675
