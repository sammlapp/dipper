#!/usr/bin/env bash
# Remove bundled libraries from a Tauri-built AppImage that must come from the host system,
# then repack it in place.
#
# libwayland-*: the AppImage is built on Ubuntu 22.04 and linuxdeploy bundles its
# libwayland-client/-egl/-cursor/-server (1.20). The host's Mesa libEGL loads them, and on
# newer systems (Ubuntu 26.04, Mesa 26) the old copies make WebKitGTK fail with
# "Could not create default EGL display: EGL_BAD_PARAMETER" and show a blank window.
# libwayland keeps backward compatibility, so the host copy works with the bundled GTK/WebKit
# (tested on Ubuntu 22.04, 24.04 and 26.04).
#
# Usage: strip-appimage-libs.sh <path/to/App.AppImage>
set -euo pipefail

APPIMAGETOOL_VERSION=1.9.1
APPIMAGETOOL_SHA256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
STRIP_GLOBS=('libwayland-*.so*')

appimage=$(realpath "$1")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

curl -fsSL -o appimagetool \
  "https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-x86_64.AppImage"
echo "${APPIMAGETOOL_SHA256}  appimagetool" | sha256sum -c -
chmod +x appimagetool

"$appimage" --appimage-extract > /dev/null

for glob in "${STRIP_GLOBS[@]}"; do
  matches=(squashfs-root/usr/lib/$glob)
  if [ ! -e "${matches[0]}" ]; then
    echo "::error::No bundled libraries match usr/lib/$glob; the AppImage layout changed, review this script"
    exit 1
  fi
  rm -v "${matches[@]}"
done

# --appimage-extract-and-run: CI runners have no FUSE
ARCH=x86_64 ./appimagetool --appimage-extract-and-run squashfs-root "$appimage"
echo "Repacked $appimage"
