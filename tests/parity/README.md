# Parity and golden regression harness (E3.5S5)

`npm run parity` loads every fixture in its `fixtures` list through the real
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
- the column-overflow signal (E4B1) is present exactly when the fixture
  overruns: `data-hbw-overflow="<pages>"` on the host and `.pages`, the column
  count on each overfull `.page`, and a notice in the host above the frame that
  names the clipped pages — and absent for a fixture that fits;
- each 816 CSS px page matches `goldens/<fixture>-<n>.png`.

Fixtures and golden provenance:

| Fixture | Covers | Goldens from |
|---|---|---|
| `three-page-brew.md` | page split, `\column`, numbering | the Homebrewery app |
| `rich-brew.md` | clipping, note box, table, list, quote, both markers | this renderer |

`rich-brew.md` exists because the older fixture — three pages of one heading
and one sentence — cannot clip, so nothing measured the failure in E4B1. Its
golden is recorded from this renderer rather than the app: the app's editor
keeps the demo brew's style tab (`.page { padding-bottom: 1.1cm }`), which
changes the column height and therefore every line break on a full page. An
app capture of a full page is not a stable target; the structural assertions
above are what pin the behaviour, and the golden pins this renderer's output.
Record or refresh it with:

```sh
HBW_PARITY_ACCEPT=1 npm run parity
```

That writes only fixtures marked `upstream: false` and must be reviewed like
any other golden change.

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
