# Vendored front-end libraries (E1S3, E3S2T1)

These files are pinned upstream builds loaded by the extension on brew page
views only. `marked` and `DOMPurify` are committed unmodified; the Homebrewery
renderer is committed as a built artifact (see `build/renderer/`). **E7**
(build, release & upgrades) owns the fully reproducible build.

| File | Upstream | Version | License | SHA-256 |
|---|---|---|---|---|
| `marked-0.3.19.min.js` | https://github.com/markedjs/marked | 0.3.19 | MIT (`LICENSE.marked.md`) | `1e20d1edb70f0d8c01284b4b8e3edcc9b40e7f6b806c379a73958ae78febf8cc` |
| `dompurify-2.5.8.min.js` | https://github.com/cure53/DOMPurify | 2.5.8 | Apache-2.0 OR MPL-2.0 (`LICENSE.dompurify`) | `a4e1299c636d1878a7ba2dc261638458c930a12367300bfc7cbc6b4b2adddcd6` |
| `homebrewery-3.21.0/renderer.min.js` | https://github.com/naturalcrit/homebrewery (tag v3.21.0, `shared/markdown.js`) | 3.21.0 | MIT (`homebrewery-3.21.0/LICENSE`); bundled marked 15.0.12 and lodash 4.17.21 notices in `homebrewery-3.21.0/LICENSE.marked` / `LICENSE.lodash` | `ece48aae0a8a6e46d49a1ab00736ec5b712da3e1d0cdc9b517c10a5d7d5ea3f2` |

## Why these pins

- `marked` 0.3.19 and `DOMPurify` 2.5.8 are **ES5** builds (no `let`/`const`,
  arrow functions, classes or ES modules), matching the legacy MediaWiki 1.14
  front end (no ResourceLoader / bundler).
- `marked` 0.3.19 is the same legacy parser line Homebrewery keeps as
  `markedLegacy`; it is now the **fallback** renderer.
- `homebrewery-3.21.0/renderer.min.js` is the pinned fidelity target: the
  Homebrewery **v3** renderer (`shared/markdown.js`, not `markdownLegacy.js`),
  built from tag v3.21.0 as an ES2017 IIFE exposing
  `window.HomebreweryRenderer`. Upstream's marked 15 + lodash cannot be lowered
  to ES5, so this one artifact follows Homebrewery v3.21's browser floor;
  browsers that cannot parse it fall back to `marked`, then to plain text.
- `DOMPurify` 2.5.8 is the last 2.x line with ES5 output and supports the
  sanitization baseline in `docs/DESIGN.md` D7 / `docs/SECURITY-REVIEW.md`.
- `--legal-comments=none` keeps third-party comment banners out of the minified
  bundle, so the licences of the libraries embedded in it are shipped beside
  the artifact (`LICENSE`, `LICENSE.marked`, `LICENSE.lodash`).

## Loading

`HomebreweryWiki::rendererAssets()` returns them in dependency order:

1. `vendor/homebrewery-3.21.0/renderer.min.js`
2. `vendor/marked-0.3.19.min.js`
3. `vendor/dompurify-2.5.8.min.js`
4. `HomebreweryWiki.render.js`

Do not edit the vendored files. Upgrade deliberately (pin + hash + license
review), rebuild the renderer with `sh build/renderer/build.sh`, and keep the
order above.

## Upstream source URLs

- https://cdn.jsdelivr.net/npm/marked@0.3.19/marked.min.js
- https://cdn.jsdelivr.net/npm/dompurify@2.5.8/dist/purify.min.js
- https://raw.githubusercontent.com/markedjs/marked/v0.3.19/LICENSE.md
- https://raw.githubusercontent.com/cure53/DOMPurify/2.5.8/LICENSE
- https://github.com/naturalcrit/homebrewery/tree/v3.21.0
- https://raw.githubusercontent.com/naturalcrit/homebrewery/v3.21.0/license
- https://raw.githubusercontent.com/markedjs/marked/v15.0.12/LICENSE.md
- https://raw.githubusercontent.com/lodash/lodash/4.17.21/LICENSE
