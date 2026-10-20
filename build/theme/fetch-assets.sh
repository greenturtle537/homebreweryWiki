#!/bin/sh
# Install the pinned theme assets on a wiki host (E3.5S2T1 / licence gate).
#
# Downloads the pinned Homebrewery source tag once, then copies every file in
# assets.sha256 into vendor/homebrewery-3.21.0/theme/ and verifies its hash.
# Nothing is fetched at render time; the wiki serves these files locally.
#
#   sh build/theme/fetch-assets.sh
set -eu

PIN="v3.21.0"
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$DIR/../.." && pwd)
OUT="$ROOT/vendor/homebrewery-3.21.0/theme"
MANIFEST="$OUT/assets.sha256"
TARBALL="$DIR/homebrewery-$PIN.tar.gz"
TMP="$DIR/.fetch"

if [ ! -f "$MANIFEST" ]; then
	echo "missing $MANIFEST - run build.sh first" >&2
	exit 1
fi
if [ ! -f "$TARBALL" ]; then
	echo "fetching homebrewery $PIN source"
	curl -fsSL "https://codeload.github.com/naturalcrit/homebrewery/tar.gz/refs/tags/$PIN" \
		-o "$TARBALL"
fi

rm -rf "$TMP"
mkdir -p "$TMP"
tar -xzf "$TARBALL" -C "$TMP" "homebrewery-${PIN#v}/themes"

cd "$TMP/homebrewery-${PIN#v}"
while read -r hash path; do
	[ -n "$path" ] || continue
	# Verify first: set -e must stop the copy, never leave an unverified file
	# behind in the served directory.
	printf '%s  %s\n' "$hash" "$path" | sha256sum -c - >/dev/null
	mkdir -p "$OUT/$(dirname "$path")"
	cp "$path" "$OUT/$path"
done < "$MANIFEST"

rm -rf "$TMP"
echo "verified $(wc -l < "$MANIFEST") theme assets in $OUT"
echo "5e fonts/textures are unlicensed upstream: keep them local, do not redistribute."
