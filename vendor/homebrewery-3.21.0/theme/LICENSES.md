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
