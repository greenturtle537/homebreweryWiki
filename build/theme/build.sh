#!/bin/sh
# Build the pinned Homebrewery theme (E3.5S2T1/T2/T3/T4).
#
# Fetches naturalcrit/homebrewery at the pinned tag, compiles the Blank base
# theme then the 5ePHB theme with Less, rewrites the asset URLs to the
# configured base path, and writes a SHA-256 manifest for the runtime assets.
#
#   sh build/theme/build.sh
#   HBW_ASSET_BASE=/wiki/extensions/HomebreweryWiki/vendor/homebrewery-3.21.0/theme \
#       sh build/theme/build.sh
#
# The compiled theme.css and the manifest are committed. Binary assets are NOT
# committed (licence gate): run fetch-assets.sh on the target install, or set
# $wgHomebreweryWikiThemeCss to an admin-supplied theme directory.
set -eu

PIN="v3.21.0"
ASSET_BASE="${HBW_ASSET_BASE:-/extensions/HomebreweryWiki/vendor/homebrewery-3.21.0/theme}"
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$DIR/../.." && pwd)
UP="$DIR/upstream"
OUT="$ROOT/vendor/homebrewery-3.21.0/theme"
TARBALL="$DIR/homebrewery-$PIN.tar.gz"

mkdir -p "$UP" "$OUT/themes"

if [ ! -f "$TARBALL" ]; then
	echo "fetching homebrewery $PIN source"
	curl -fsSL "https://codeload.github.com/naturalcrit/homebrewery/tar.gz/refs/tags/$PIN" \
		-o "$TARBALL"
fi

rm -rf "$UP/themes"
tar -xzf "$TARBALL" -C "$UP" --strip-components=1 "homebrewery-${PIN#v}/themes"

cd "$DIR"
npm install --no-audit --no-fund

# Blank is the base theme; 5ePHB overrides it. Compile in that order.
./node_modules/.bin/lessc --include-path="$UP" "$UP/themes/V3/Blank/style.less" > "$DIR/blank.css"
./node_modules/.bin/lessc --include-path="$UP" "$UP/themes/V3/5ePHB/style.less" > "$DIR/5ephb.css"
cat "$DIR/blank.css" "$DIR/5ephb.css" > "$DIR/theme.raw.css"

node "$DIR/rewrite-assets.js" "$DIR/theme.raw.css" "$ASSET_BASE" > "$OUT/theme.css"

# Runtime asset manifest: exactly the files the compiled CSS can request, plus
# the licence files that must travel with the fonts. Paths keep the upstream
# themes/... layout so the rewritten URLs resolve unchanged.
node "$DIR/manifest.js" "$OUT/theme.css" "$ASSET_BASE" > "$DIR/runtime-files.txt"
cat >> "$DIR/runtime-files.txt" <<'LICENCES'
themes/fonts/Journal/LICENSE - PermanentMarker.txt
themes/fonts/iconFonts/diceFont_license.md
themes/fonts/iconFonts/game-icons_license.md
LICENCES
(
	cd "$UP"
	while IFS= read -r path; do
		[ -f "$path" ] || continue
		sha256sum "$path"
	done < "$DIR/runtime-files.txt"
) > "$OUT/assets.sha256"
echo "runtime assets: $(wc -l < "$OUT/assets.sha256")"

# Licence gate record (E3.5S2T4 / Q23): what may ship and what needs an audit.
cat > "$OUT/LICENSES.md" <<'LICENCE'
# Theme asset licences (Homebrewery v3.21.0)

Compiled CSS (`theme.css`) is built from the MIT-licensed Homebrewery Less
sources. The binary assets are **not committed**; `fetch-assets.sh` installs
them from the pinned tag after verifying `assets.sha256`.

| Asset group | Upstream file | Status |
|---|---|---|
| TeX Gyre Pagella (Blank text) | `themes/fonts/Blank/fonts.less` | GUST Font License (GFL/LPPL), redistribution allowed with the notice |
| Journal fonts | `themes/fonts/Journal/LICENSE - PermanentMarker.txt` | see upstream notice |
| Dice / game-icons / Font Awesome | `themes/fonts/iconFonts/*_license.md` | see upstream notice |
| 5e fonts (Bookinsanity, Nodesto, Scaly Sans, ...) | no licence file in the tag | **unlicensed — audit before redistributing** |
| Textures / watercolour masks / borders | no licence file in the tag | **unlicensed — audit before redistributing** |

Because the 5e fonts and textures are unlicensed in the pinned tag, this build
ships no binaries: an install either runs `fetch-assets.sh` (assets stay local
to that install) or points `$wgHomebreweryWikiThemeCss` at an admin-supplied
theme directory. Never hotlink Homebrewery.
LICENCE

echo "built $OUT/theme.css (asset base: $ASSET_BASE)"
if command -v sha256sum >/dev/null 2>&1; then
	sha256sum "$OUT/theme.css"
else
	shasum -a 256 "$OUT/theme.css"
fi
