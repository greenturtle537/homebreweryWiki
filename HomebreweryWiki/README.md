# HomebreweryWiki (MediaWiki extension)

Renders Homebrewery-flavoured markdown ("brew pages") inside the normal
MediaWiki content pane.

## Target platform

- MediaWiki **1.14.1**
- PHP **5.2.12-2** (Suhosin-Patch 0.9.7)

All source stays PHP 5.2 compatible: no namespaces, no closures, no short array
syntax (`[]`), no `__DIR__`, no late static binding. MediaWiki 1.14 has no
`extension.json`, `ContentHandler`, or `ResourceLoader`.

## Install

1. Copy this directory to `$IP/extensions/HomebreweryWiki/`.
2. Add to `LocalSettings.php`:

   ```php
   require_once( "$IP/extensions/HomebreweryWiki/HomebreweryWiki.php" );
   ```

3. The extension registers the `Manual:` content namespace (id 3000) and its
   talk namespace `Manual_talk` (id 3001).

## Authoring rules

- Brew pages contain **Homebrewery markdown only** - no wikitext, templates, or
  transclusion.
- Editing uses the **standard plain-text edit form**; the wiki's normal
  permission checks apply (anonymous viewers are read-only).

## Build & verification

There is no compile step - this is pure PHP. "Build" means syntax-checking and
installing against a real MediaWiki 1.14.1.

- Syntax check every file:
  ```sh
  php -l HomebreweryWiki.php
  php -l HomebreweryWiki.class.php
  php -l HomebreweryWiki_Article.php
  php -l HomebreweryWiki.i18n.php
  ```
  The target runtime is PHP 5.2.12 (Suhosin-Patch 0.9.7); the dev container ships
  PHP 8.4, so `php -l` only catches syntax. Keep source PHP 5.2 clean by eye
  (no namespaces, closures, short arrays, `__DIR__`, `static::`, `new Foo()->bar()`).

- Unit / smoke tests (requires a MediaWiki 1.14.1 install):
  ```sh
  # copy tests/run.php into the wiki's maintenance/ dir, then:
  php maintenance/run.php
  ```
  14 assertions cover `isValidBrewText`, `newFromTitle`, `onArticleFromTitle`,
  `onArticleSave` (valid / invalid / non-brew), and `getBrewText`.

- Live install (verified): see `.sandbox/install-1.14.md` for the working
  SQLite harness (MediaWiki 1.14.1 on PHP 5.6, plus a source-built PHP 5.2.12
  binary with Suhosin for the runtime check).

## Versioning

- Current version: **0.1.0** (`HOMEBREWERYWIKI_VERSION` in `HomebreweryWiki.php`).
- Bump the `define( 'HOMEBREWERYWIKI_VERSION', ... )` value for every release
  and mirror it in the `$wgExtensionCredits['other'][]` block (the
  `version` key).
- Version history is tracked in git; one feature branch per story card
  (`story/<card-id>`), merged to `main` via pull request.
- MediaWiki 1.14 has no `extension.json` / `ExtensionRegistry`, so there is no
  machine-readable version manifest - keep the two version strings in sync by
  hand.

## Status

Early skeleton (Epic E1, story E1S1). See the project design docs for the full
design.
