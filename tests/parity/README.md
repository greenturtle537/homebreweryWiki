# Parity and golden regression harness (E3.5S5)

`npm run parity` loads `tests/fixtures/three-page-brew.md` through the real
production path: `HomebreweryWiki.shell.html`, `HomebreweryWiki.render.js`, and
the compiled upstream theme pinned at **Homebrewery v3.21.0**. The repository is
served over Playwright routes on `http://hbw.test`, so the iframe, theme,
fonts, textures and images resolve exactly as they do on the wiki.

The check asserts:

- exactly three `.page` blocks inside the iframe `.pages`, each with a direct
  `.columnWrapper` and one `.pageNumber`;
- `\column` becomes an upstream `.columnSplit`;
- fixture headers, tables, note/descriptive boxes and stat blocks are present;
- the iframe sandbox is exactly
  `allow-same-origin allow-top-navigation-by-user-activation` (never
  `allow-scripts`) and `referrerpolicy="no-referrer"`;
- every same-origin asset request succeeds, with zero outbound requests;
- each 816 CSS px page matches `goldens/three-page-brew-<n>.png`.

Pixel comparison uses pixelmatch threshold `0.1` and fails above **2%** of
pixels changed. Size changes always fail. A failed comparison writes a
`*.diff.png` next to the golden.

Goldens are captured from the real Homebrewery app at
`https://homebrewery.naturalcrit.com` (currently v3.24.1) at the same 816 CSS px
page width:

```sh
npm run parity:capture
```

The capture script uses `CodeMirror.setValue()` when the legacy
`document.querySelector('.CodeMirror').CodeMirror` API is present, otherwise it
types the fixture into the current CodeMirror 6 editor. It pins the live preview
iframe to 816 CSS px before capturing so the app's split pane cannot clip a
page. Capture is a manual, network-dependent step and is deliberately not part
of CI.

If goldens are absent, `npm run parity` skips the pixel comparison with a clear
message and still exits 0. Commit the captured PNGs when the pinned renderer or
theme changes on purpose, and review the diff before committing.

Golden screenshots are derived from Homebrewery's rendered output. The upstream
code is MIT-licensed, but the 5e fonts and textures are unlicensed in the pinned
tag (see `vendor/homebrewery-3.21.0/theme/LICENSES.md`): keep those assets local
and do not redistribute them. The goldens contain only rendered typography and
textures, not the font binaries.
