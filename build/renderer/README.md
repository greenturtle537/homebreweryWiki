# Homebrewery renderer bundle (build)

Produces `vendor/homebrewery-3.21.0/renderer.min.js`, the pinned Homebrewery
markdown renderer used by `HomebreweryWiki.render.js`.

- **Upstream pin:** `naturalcrit/homebrewery` tag **v3.21.0**, module
  `shared/markdown.js` (the v3 renderer — not `markdownLegacy.js`).
- **Contract:** the bundle defines `window.HomebreweryRenderer.render( text, pageNumber )`,
  which is upstream's `Markdown.render`. It renders **one page** at a time; page
  splitting is done by the caller.
- **Output target:** ES2017 IIFE. Upstream uses marked 15 + lodash, which esbuild
  cannot lower to ES5 (706 transform errors). The extension's own code stays ES5;
  this vendored artifact follows Homebrewery v3.21's browser floor. Browsers that
  cannot parse it fall back to the plain `<pre>` view.
- **Committed artifact:** the built file is checked in, so installing or
  checking out the extension needs no Node toolchain.

## Rebuild

```sh
sh build/renderer/build.sh
```

The script fetches the pinned upstream files into `build/renderer/upstream/`
(gitignored), installs the exact dependency versions from `package.json`, and
runs esbuild. Compare the printed SHA-256 with `vendor/README.md`; if it
changed, update the manifest entry.

It also copies the notices for the code embedded in the bundle next to the
artifact: Homebrewery (`LICENSE`), marked (`LICENSE.marked`) and lodash
(`LICENSE.lodash`). `--legal-comments=none` keeps those banners out of the
minified output, so the files are the only attribution the vendored bundle
ships with.

## Notes

- `--main-fields=module,main` is mandatory. Without it, several `marked-*`
  plugins resolve to their UMD build and the bundle fails with
  "No matching export … for import default".
- `esbuild` is pinned to 0.25.9 to keep rebuilds comparable. A fully
  lockfile-driven reproducible build belongs to the E7 build/release story.
