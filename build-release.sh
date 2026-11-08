#!/usr/bin/env bash
# Build the release zip for the Cinnamon desklet.
# Usage: ./build-release.sh
# Output: dist/headsetmon@bytepath-v<VERSION>.zip
#   Archive layout: headsetmon@bytepath/ (top-level folder, files inside)
#   Version read from metadata.json.
set -euo pipefail
cd "$(dirname "$0")"

FILES=(metadata.json desklet.js stylesheet.css settings-schema.json)
FOLDER="headsetmon@bytepath"

# Single source of truth for the version: metadata.json
VERSION=$(python3 -c 'import json; print(json.load(open("metadata.json"))["version"])')

DIST=dist
ZIP="$DIST/headsetmon@bytepath-v$VERSION.zip"
STAGE="$DIST/$FOLDER"

# Stage the files into the top-level folder, then zip (no -j: keep the folder)
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp "${FILES[@]}" "$STAGE/"
rm -f "$ZIP"
(cd "$DIST" && zip -r "$(basename "$ZIP")" "$FOLDER")
rm -rf "$STAGE"

echo
echo "Built $ZIP"
echo
unzip -l "$ZIP"

echo
echo "Release instructions:"
echo "  1. git tag v$VERSION && git push origin v$VERSION"
echo "  2. GitHub: create release from tag, attach $ZIP"
echo "  3. Users: unzip, then move the $FOLDER/ folder"
echo "     into ~/.local/share/cinnamon/desklets/"