# HomebreweryWiki (MediaWiki extension)

MediaWiki using the Homebrewery Renderer; for large-scale community homebrew projects.

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
policy is raster-only (`png`, `jpg`, `jpeg`, `gif`, `webp`); SVG is excluded
because it can carry script (Q14). Extension checks and the strict allowlist
are enabled, uploads are capped at 10 MB, and `$wgEnableUploads` is turned on
because MediaWiki 1.14 ships with local uploads disabled.

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

DOM tests for the render module (Node + jsdom, no MediaWiki needed):
```sh
npm install
npm test
```

There is no build step for the extension itself: the front-end assets
(`HomebreweryWiki.render.js` plus `vendor/`) are plain static files served by
the web server, in the load order declared by
`HomebreweryWiki::rendererAssets()`.
