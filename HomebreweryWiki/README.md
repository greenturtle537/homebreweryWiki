# HomebreweryWiki (MediaWiki extension)

Renders Homebrewery-flavoured markdown ("brew pages") inside the normal
MediaWiki content pane.

## Target platform

- MediaWiki 1.14.1
- PHP 5.2.12-2 (Suhosin-Patch 0.9.7)

Source is PHP 5.2 compatible: no namespaces, closures, short array syntax,
`__DIR__`, or late static binding. MediaWiki 1.14 has no `extension.json`,
`ContentHandler`, or `ResourceLoader`.

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

## Authoring rules

- Brew pages contain Homebrewery markdown only. No wikitext, templates, or
  transclusion.
- Editing uses the standard plain-text edit form.

## Status

Early skeleton (Epic E1, story E1S1). See the project design docs for details.