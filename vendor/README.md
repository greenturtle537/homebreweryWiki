# Vendored front-end libraries (E1S3)

These files are pinned, unmodified upstream builds loaded by the extension on
brew page views only. They are **not** rebuilt here; **E7** (build, release &
upgrades) owns the reproducible build and **E3** (Homebrewery rendering
fidelity) replaces `marked` with the pinned Homebrewery renderer bundle.

| File | Upstream | Version | License | SHA-256 |
|---|---|---|---|---|
| `marked-0.3.19.min.js` | https://github.com/markedjs/marked | 0.3.19 | MIT (`LICENSE.marked.md`) | `1e20d1edb70f0d8c01284b4b8e3edcc9b40e7f6b806c379a73958ae78febf8cc` |
| `dompurify-2.5.8.min.js` | https://github.com/cure53/DOMPurify | 2.5.8 | Apache-2.0 OR MPL-2.0 (`LICENSE.dompurify`) | `a4e1299c636d1878a7ba2dc261638458c930a12367300bfc7cbc6b4b2adddcd6` |

## Why these pins

- Both builds are **ES5** (no `let`/`const`, arrow functions, classes or ES
  modules), matching the project's desktop browser floor (Q19) and the legacy
  MediaWiki 1.14 front end (no ResourceLoader / bundler).
- `marked` 0.3.19 is the same legacy parser line Homebrewery keeps as
  `markedLegacy`; E3 swaps in the pinned Homebrewery renderer.
- `DOMPurify` 2.5.8 is the last 2.x line with ES5 output and supports the
  sanitization baseline in `docs/DESIGN.md` D7 / `docs/SECURITY-REVIEW.md`.

## Loading

`HomebreweryWiki::rendererAssets()` returns them in dependency order:

1. `vendor/marked-0.3.19.min.js`
2. `vendor/dompurify-2.5.8.min.js`
3. `HomebreweryWiki.render.js`

Do not edit the vendored files. Upgrade deliberately (pin + hash + license
review), and keep the order above.

## Upstream source URLs

- https://cdn.jsdelivr.net/npm/marked@0.3.19/marked.min.js
- https://cdn.jsdelivr.net/npm/dompurify@2.5.8/dist/purify.min.js
- https://raw.githubusercontent.com/markedjs/marked/v0.3.19/LICENSE.md
- https://raw.githubusercontent.com/cure53/DOMPurify/2.5.8/LICENSE
