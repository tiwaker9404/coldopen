#!/usr/bin/env bash
# ffmpeg and the Noto fonts for a film renderer on GitHub Actions, from a cache when there is one.
#
# Installing them with apt took about 37s of every film. This keeps a static ffmpeg build and the
# font files in ~/.cache/coldopen-tools (saved by actions/cache), so later runs only copy them into
# place. On a cache miss it downloads them once; if the static build can't be had, it falls back
# to apt, as before.
set -euo pipefail

TOOLS="$HOME/.cache/coldopen-tools"
mkdir -p "$TOOLS/bin" "$TOOLS/fonts"

if [ ! -x "$TOOLS/bin/ffmpeg" ] || [ ! -x "$TOOLS/bin/ffprobe" ]; then
  tmp=$(mktemp -d)
  # BtbN's builds are static and published as GitHub releases, so the download stays on GitHub
  if gh release download latest -R BtbN/FFmpeg-Builds -D "$tmp" \
      -p 'ffmpeg-n7*-latest-linux64-gpl-7*.tar.xz' 2>/dev/null; then
    tar -xJf "$(ls "$tmp"/*.tar.xz | head -1)" -C "$tmp"
    cp "$tmp"/ffmpeg-*/bin/ffmpeg "$tmp"/ffmpeg-*/bin/ffprobe "$TOOLS/bin/"
  else
    echo "static ffmpeg not available; installing with apt"
    sudo apt-get update -qq
    sudo apt-get install -y -qq --no-install-recommends ffmpeg
    ln -sf "$(command -v ffmpeg)" "$TOOLS/bin/ffmpeg"
    ln -sf "$(command -v ffprobe)" "$TOOLS/bin/ffprobe"
    # these links point outside the cache: a later run that restores them finds them broken
    # and installs again
  fi
  rm -rf "$tmp"
fi

if [ -z "$(ls -A "$TOOLS/fonts")" ]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq --no-install-recommends fonts-noto-core
  cp -r /usr/share/fonts/truetype/noto "$TOOLS/fonts/"
fi

# fontconfig (and so Chromium) reads ~/.local/share/fonts
mkdir -p "$HOME/.local/share/fonts"
cp -r "$TOOLS/fonts/." "$HOME/.local/share/fonts/"
fc-cache -f >/dev/null 2>&1 || true

echo "$TOOLS/bin" >> "$GITHUB_PATH"
"$TOOLS/bin/ffmpeg" -hide_banner -version | head -1
