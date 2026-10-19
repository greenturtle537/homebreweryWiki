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

## Brew page rendering (E1S2)

On a brew page **view** the server skips the stock wikitext parse and emits the
raw source into a hidden placeholder; a small front-end module then places it
into the content pane as plain preformatted text (a proof of the pane plumbing
before the Homebrewery renderer lands):

- `HomebreweryWiki_Article` is returned from `ArticleFromTitle` (E1S1).
- `ArticleViewHeader` (`HomebreweryWiki::onArticleViewHeader`) emits, for the
  current revision of an existing brew page, the hidden wrapper
  `<div class="hbw-brew"><pre id="hbw-source" style="display:none">…</pre></div>`
  and sets `$outputDone` so the markdown is never run through the wikitext parser.
- `BeforePageDisplay` (`HomebreweryWiki::onBeforePageDisplay`) loads
  `HomebreweryWiki.view.js` **only** on a brew page view — not on edit, history,
  preview or diff screens, and not on non-brew pages (MW 1.14 has no
  `ResourceLoader`; legacy `addScriptFile` is used).
- `HomebreweryWiki.view.js` reads `#hbw-source` and builds the visible
  `<pre class="hbw-brew-text">` inside the `.hbw-brew` wrapper.

Diffs and `action=raw` are unaffected: they return before `ArticleViewHeader`.

## Authoring rules

- Brew pages contain Homebrewery markdown only. No wikitext, templates, or
  transclusion.
- Editing uses the standard plain-text edit form.

## Status

Walking skeleton (Epic E1): E1S1 (namespace + content type) and E1S2 (plain
preformatted display in the pane) done. See the project design docs for details.