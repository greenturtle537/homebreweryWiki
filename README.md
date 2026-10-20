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
