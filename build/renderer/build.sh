#!/bin/sh
# Build the pinned Homebrewery renderer bundle (E3S2T1 / DESIGN D6).
#
# Fetches the renderer sources from the pinned upstream tag, installs the
# exact dependency pins, and bundles them into an IIFE that defines
# window.HomebreweryRenderer.  The bundle is committed, so checking out the
# extension never needs a build step.
#
# Usage: sh build.sh        (from anywhere)
set -eu

PIN="v3.21.0"
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UP="$DIR/upstream"
RAW="https://raw.githubusercontent.com/naturalcrit/homebrewery/$PIN"

rm -rf "$UP"
mkdir -p "$UP/shared" "$UP/themes/fonts/iconFonts"

curl -fsSL "$RAW/shared/markdown.js" -o "$UP/shared/markdown.js"
curl -fsSL "$RAW/license" -o "$UP/LICENSE"

for font in diceFont elderberryInn gameIcons fontAwesome; do
	curl -fsSL "$RAW/themes/fonts/iconFonts/$font.js" \
		-o "$UP/themes/fonts/iconFonts/$font.js"
done

cd "$DIR"
npm install --no-audit --no-fund

# --main-fields=module,main is required: several marked-* plugins otherwise
# resolve to their UMD builds, which have no ESM default export.
npx esbuild entry.js \
	--bundle \
	--format=iife \
	--target=es2017 \
	--main-fields=module,main \
	--minify \
	--legal-comments=none \
	--banner:js="/*! Homebrewery $PIN markdown renderer (vendor bundle). Upstream: https://github.com/naturalcrit/homebrewery tag $PIN, shared/markdown.js. MIT. Built with esbuild; see build/renderer/README.md. */" \
	--outfile="$DIR/../../vendor/homebrewery-3.21.0/renderer.min.js"

# The bundle embeds Homebrewery, marked and lodash; ship their notices next to
# the artifact (the --legal-comments=none build keeps them out of the bundle).
cp "$UP/LICENSE" "$DIR/../../vendor/homebrewery-3.21.0/LICENSE"
cp "$DIR/node_modules/marked/LICENSE.md" \
	"$DIR/../../vendor/homebrewery-3.21.0/LICENSE.marked"
cp "$DIR/node_modules/lodash/LICENSE" \
	"$DIR/../../vendor/homebrewery-3.21.0/LICENSE.lodash"

echo "built vendor/homebrewery-3.21.0/renderer.min.js"
