# HomebreweryWiki (MediaWiki extension)

MediaWiki using the Homebrewery Renderer; for large-scale community homebrew projects.

## Target platform

- MediaWiki 1.14.1
- PHP 5.2.12-2 (Suhosin-Patch 0.9.7)

Source is PHP 5.2 compatible: no namespaces, closures, short array syntax,
`__DIR__`, or late static binding. MediaWiki 1.14 has no `extension.json`,
`ContentHandler`, or `ResourceLoader`.

Front-end JavaScript written in this extension targets **ES5** (desktop only):
no `let`/`const`, arrow functions, template literals, classes, or ES modules.

The one exception is the vendored Homebrewery renderer bundle
(`vendor/homebrewery-3.21.0/renderer.min.js`), which is built from upstream
v3.21.0 as an ES2017 IIFE because upstream's marked 15 / lodash cannot be
lowered to ES5. It follows Homebrewery v3.21's own browser floor; browsers that
cannot parse it fall back to the vendored `marked` bundle, and a browser with
no renderer at all still gets the plain-text `<pre>` view.

## Install

1. Copy this directory to `$IP/extensions/HomebreweryWiki/`.
2. Add to `LocalSettings.php`:

   ```php
   require_once( "$IP/extensions/HomebreweryWiki/HomebreweryWiki.php" );
   ```

3. Registers the `Manual:` namespace (id 3000) and `Manual_talk` (id 3001).

## Permissions

The extension applies the account policy from `docs/QUESTIONS.md` Q21 when it
loads (all values can be overridden later in `LocalSettings.php`):

- Anonymous visitors are **read-only**: no `edit`, `createpage`, `createtalk`,
  `upload`, or `createaccount` (self-registration is disabled).
- Any logged-in (admin-created) account is a trusted editor: `edit`,
  `createpage`, `createtalk`, `upload`.
- The brew namespaces carry a dedicated `homebrewery-edit` right, granted to
  `user` and `sysop`. A `userCan` hook denies `edit`/`create` on `Manual:` and
  `Manual_talk` pages to accounts without it, so brew authoring stays locked
  even if anonymous editing is re-enabled wiki-wide.
- `read` is never touched: brew pages follow the global read policy exactly
  like normal pages.

MediaWiki 1.14's `$wgNamespaceProtection` is deliberately **not** used — it is
checked for every action, including `read`, and would make brew pages
unreadable to anonymous visitors.

### Uploads

Only logged-in (admin-created) accounts hold the `upload` right. The file
policy is raster-only (`png`, `jpg`, `jpeg`, `gif`); SVG is excluded because it
can carry script (Q14) and WebP because MediaWiki 1.14 has no WebP MIME or
thumbnail support. Extension checks and the strict allowlist are enabled,
`$wgEnableUploads` is turned on (1.14 ships with local uploads disabled), and
uploads are capped at 10 MB. Because 1.14 applies `$wgMaxUploadSize` only to
URL-copy uploads, the `UploadVerification` hook enforces the same cap on local
uploads before the file is stored.

## Build & test

Syntax check:
```sh
php -l HomebreweryWiki.php
php -l HomebreweryWiki.class.php
php -l HomebreweryWiki_Article.php
php -l HomebreweryWiki.i18n.php
node --check HomebreweryWiki.render.js
```

Unit tests (needs a MediaWiki 1.14.1 install):
```sh
cp tests/run.php <mediawiki>/maintenance/hbwtest.php
php maintenance/hbwtest.php
```

Or run them against a real MediaWiki 1.14.1 without installing anything
(Docker; PHP 5.6.40 standing in for the production 5.2.12/Suhosin stack):
```sh
npm run test:mw
```

DOM tests for the render module (Node + jsdom, no MediaWiki needed):
```sh
npm install
npm test
```

Theme build and assets (E3.5S2). The compiled upstream theme
(`vendor/homebrewery-3.21.0/theme/theme.css`) and its SHA-256 manifest are
committed. The font/texture binaries are **not** committed because the 5e
fonts and textures are unlicensed in the pinned tag; install them on the wiki
host instead:

```sh
sh build/theme/fetch-assets.sh   # downloads the pinned tag, verifies hashes
npm run verify:assets            # fails if any served url() target is missing
```

`fetch-assets.sh` is a required step in **every** build and deploy, not an
optional extra: the committed stylesheet points at fonts and textures that
only that script installs, and a wiki that skips it serves a theme whose icons
and textures 404 without any server error. Run `npm run verify:assets` after
installing to confirm the served stylesheet resolves; it accepts a
`@font-face` `src` list when any entry in the list is present (the pinned set
ships the `.woff2` files, not the `.ttf` fallbacks), and it exits non-zero
when a plain `url()` points at nothing. CI runs it in both browser jobs.

The build itself (`sh build/theme/build.sh`) fetches `naturalcrit/homebrewery`
v3.21.0, compiles `themes/V3/Blank/style.less` then
`themes/V3/5ePHB/style.less`, and rewrites `/assets`, `/fonts/iconFonts` and
`../../../fonts` URLs to be **relative to `theme.css`** (`./themes/...`). That
keeps the committed stylesheet working under any `$wgScriptPath`, including a
subdirectory install such as `/wiki`. `HBW_ASSET_BASE` overrides the prefix
when the assets are served from another directory on the same origin (the shell
CSP only allows same-origin fonts, images and styles); rebuild after changing
it. To use an admin-supplied theme directory instead, set
`$wgHomebreweryWikiThemeCss` in `LocalSettings.php`. Never hotlink Homebrewery.

Visual regression for the reference brew (headless Chromium; needs the browser
once — `npx playwright install --with-deps chromium`). Run
`fetch-assets.sh` first so the theme fonts and textures are present:
```sh
npm run visual          # compare against tests/visual/baselines/
npm run visual:update   # rewrite baselines deliberately, then review the PNG
```

CI (`.github/workflows/ci.yml`) runs all three: jsdom, MediaWiki 1.14.1 in a
container, then the visual baseline check.

There is no build step for the extension itself: the front-end assets
(`HomebreweryWiki.render.js` plus `vendor/`) are plain static files served by
the web server, in the load order declared by
`HomebreweryWiki::rendererAssets()`.

The brew itself renders inside `HomebreweryWiki.shell.html`, a static
same-origin iframe served from the extension directory. The parent renders and
sanitizes the markdown, then injects the upstream page DOM
(`.brewRenderer > .pages > .page > .columnWrapper`) into the frame; the frame
runs no scripts (`sandbox="allow-same-origin
allow-top-navigation-by-user-activation"`). The compiled theme stylesheet is
loaded inside the frame, never in the wiki document.
