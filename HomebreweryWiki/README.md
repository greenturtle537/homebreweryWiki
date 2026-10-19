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

## Status

Early skeleton (Epic E1, story E1S1). See the project design docs for the full
design.
