# HomebreweryWiki (MediaWiki extension)

MediaWiki using the Homebrewery Renderer; for large-scale community homebrew projects.

Renders Homebrewery-flavoured markdown ("brew pages") inside the normal
MediaWiki content pane.

## Target platform

- MediaWiki 1.14.1
- PHP 5.2.12-2 (Suhosin-Patch 0.9.7)

Source is PHP 5.2 compatible: no namespaces, closures, short array syntax,
`__DIR__`, or late static binding. MediaWiki 1.14 has no `extension.json`,
`ContentHandler`, or `ResourceLoader`.

Front-end JavaScript targets **ES5** (desktop only): no `let`/`const`, arrow
functions, template literals, classes, or ES modules.

## Install

1. Copy this directory to `$IP/extensions/HomebreweryWiki/`.
2. Add to `LocalSettings.php`:

   ```php
   require_once( "$IP/extensions/HomebreweryWiki/HomebreweryWiki.php" );
   ```

3. Registers the `Manual:` namespace (id 3000) and `Manual_talk` (id 3001).

## Build & test

Syntax check:
```sh
php -l HomebreweryWiki.php
php -l HomebreweryWiki.class.php
php -l HomebreweryWiki_Article.php
php -l HomebreweryWiki.i18n.php
```

Unit tests (needs a MediaWiki 1.14.1 install):
```sh
cp tests/run.php <mediawiki>/maintenance/hbwtest.php
php maintenance/hbwtest.php
```

DOM tests for the render module (Node + jsdom, no MediaWiki needed):
```sh
npm install
npm test
```

## Brew page rendering (E1S3)

On a brew page **view** the server skips the stock wikitext parse and emits the
raw source into a hidden placeholder; the renderer bundle then converts it to
sanitized HTML and replaces the placeholder in the content pane.

- `HomebreweryWiki_Article` is returned from `ArticleFromTitle` (E1S1).
- `ArticleViewHeader` (`HomebreweryWiki::onArticleViewHeader`) emits, for the
  current revision of an existing brew page, the hidden wrapper
  `<div class="hbw-brew"><div id="hbw-source" style="display:none">…</div>
  <noscript><pre class="hbw-brew-text">…</pre></noscript></div>`
  and sets `$outputDone` so the markdown is never run through the wikitext parser.
  The hidden source is a `<div>` (not a `<pre>`) so a leading newline survives
  HTML parsing; the `<noscript>` block shows the escaped source when JavaScript
  is disabled.
- `BeforePageDisplay` (`HomebreweryWiki::onBeforePageDisplay`) loads the pinned
  renderer bundle **only** on a brew page view — not on edit, history, preview
  or diff screens, and not on non-brew pages (MW 1.14 has no `ResourceLoader`;
  legacy `addScriptFile` is used, in dependency order):
  1. `vendor/marked-0.3.19.min.js` (markdown → HTML)
  2. `vendor/dompurify-2.5.8.min.js` (sanitizer, DESIGN D7)
  3. `HomebreweryWiki.render.js` (render + inject)
- `HomebreweryWiki.render.js` reads `#hbw-source`, renders the markdown, and
  inserts sanitized HTML as `<div class="hbw-brew-rendered" id="hbw-brew-rendered">`
  inside the `.hbw-brew` wrapper.
- Sanitization baseline (D7 / F1–F3): removes `<script>`, `<iframe>`, `<object>`,
  `<embed>`, `<form>`, `<style>` and similar tags, event-handler attributes and
  unknown protocols (DOMPurify); strips CSS `url(`, `position: fixed`,
  `expression(` and `behavior`; keeps only same-origin or inline `data:image/*`
  images (no outbound requests). A stricter policy is deferred to Epic J.
- If the renderer bundle fails to load or throws, the module falls back to the
  E1S2 plain `<pre class="hbw-brew-text">` so the content is never lost.
- Pins, hashes and licences: `vendor/README.md`. Epic C replaces `marked` with
  the pinned Homebrewery renderer; Epic G owns the reproducible build.

**Deployment note (file cache):** if the target wiki sets `$wgUseFileCache`, an
entry created before this change can still hold parsed wikitext (freshness is
`page_touched`/`$wgCacheEpoch` based). Bump `$wgCacheEpoch` or purge the file
cache when deploying, so stale entries are not served. Do not permanently
exclude brew pages via `IsFileCacheable`; the escaped placeholder and renderer
output are cache-safe.

Diffs and `action=raw` are unaffected: they return before `ArticleViewHeader`.

**Deployment note (assets):** the vendored files and the render module are new
static files; no build step or ResourceLoader registration is involved. Keep
the three assets in load order and make sure the web server serves `.js` as
`application/javascript`.

## Authoring rules

- Brew pages contain Homebrewery markdown only. No wikitext, templates, or
  transclusion.
- Editing uses the standard plain-text edit form.

## Status

Walking skeleton (Epic E1): E1S1 (namespace + content type), E1S2 (plain
preformatted display in the pane) and E1S3 (rendered, sanitized HTML in the
pane) done. E1S4 (preview through the same render path) is next. See the
project design docs for details.