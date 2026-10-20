<?php
/**
 * HomebreweryWiki - Homebrew Pages for MediaWiki.
 *
 * Entry point.  Install by adding the following to LocalSettings.php:
 *
 *     require_once( "$IP/extensions/HomebreweryWiki/HomebreweryWiki.php" );
 *
 * Target platform: MediaWiki 1.14.1 / PHP 5.2.12-2 (Suhosin-Patch 0.9.7).
 * The source must stay PHP 5.2 compatible: no namespaces, no closures,
 * no short array syntax ( [] ), no __DIR__, no late static binding.
 *
 * @file
 */

if ( !defined( 'MEDIAWIKI' ) ) {
    die( 'This file is a MediaWiki extension and must not be loaded directly.' );
}

/** Extension version, surfaced on Special:Version. */
define( 'HOMEBREWERYWIKI_VERSION', '0.3.0' );

/**
 * Front-end renderer assets (E1S3), relative to $wgScriptPath, in load order.
 *
 * Loaded on brew page views only.  The module reads the hidden source
 * placeholder the server emits (see HomebreweryWiki::brewPlaceholder()),
 * renders the saved markdown to HTML, sanitizes it, and replaces the
 * placeholder in the content pane.
 *
 * The vendored libraries are pinned and ES5-compatible (desktop floor, Q19):
 * marked 0.3.19 (MIT) and DOMPurify 2.5.8 (Apache-2.0 / MPL-2.0).  See
 * vendor/README.md.  Epic C replaces marked with the pinned Homebrewery
 * renderer bundle; Epic G owns the reproducible build.
 */
define( 'HOMEBREWERYWIKI_MARKED_LIB', '/extensions/HomebreweryWiki/vendor/marked-0.3.19.min.js' );
define( 'HOMEBREWERYWIKI_PURIFY_LIB', '/extensions/HomebreweryWiki/vendor/dompurify-2.5.8.min.js' );
define( 'HOMEBREWERYWIKI_RENDER_MODULE', '/extensions/HomebreweryWiki/HomebreweryWiki.render.js' );

/**
 * Extension credits (MediaWiki 1.14 shape).
 *
 * 1.14 has no extension.json / wfLoadExtension; registration is done with the
 * global arrays set from this file (see the mediawiki-1.14-legacy-extension skill).
 */
$wgExtensionCredits['other'][] = array(
    'name'           => 'HomebreweryWiki',
    'version'        => HOMEBREWERYWIKI_VERSION,
    'author'         => 'homebreweryWiki project',
    'description'    => 'Renders Homebrewery-flavoured markdown (brew pages) inside the standard MediaWiki content pane.',
    'descriptionmsg' => 'homebrewerywiki-desc',
);

/**
 * Brew namespace: one content namespace ("Manual:") plus its talk namespace.
 *
 * MediaWiki 1.14 registers custom namespaces with the $wgExtraNamespaces global
 * (the CanonicalNamespaces hook is 1.17+).  IDs start at 3000 to avoid clashes
 * with core or other extensions.  Set at load time - not in setup() - so the
 * namespaces exist before MediaWiki needs them.
 */
if ( !defined( 'NS_MANUAL' ) ) {
    define( 'NS_MANUAL', 3000 );
}
if ( !defined( 'NS_MANUAL_TALK' ) ) {
    define( 'NS_MANUAL_TALK', 3001 );
}

$wgExtraNamespaces = (array)$wgExtraNamespaces;
$wgExtraNamespaces[NS_MANUAL]      = 'Manual';
$wgExtraNamespaces[NS_MANUAL_TALK] = 'Manual_talk';

/** Brew pages count as real content (article count, search, etc.). */
$wgContentNamespaces[] = NS_MANUAL;

/**
 * Message files.  On 1.14 these are plain PHP files holding a $messages array;
 * they are loaded on demand by the framework.
 */
$wgExtensionMessagesFiles['HomebreweryWiki'] = dirname( __FILE__ ) . '/HomebreweryWiki.i18n.php';

/**
 * Autoloaded classes.  PHP 5.2 has no namespaces, so class names are prefixed
 * (HomebreweryWiki, HomebreweryWiki_Article, ...).
 */
$wgAutoloadClasses['HomebreweryWiki']         = dirname( __FILE__ ) . '/HomebreweryWiki.class.php';
$wgAutoloadClasses['HomebreweryWiki_Article'] = dirname( __FILE__ ) . '/HomebreweryWiki_Article.php';

/**
 * Brew content type.  MediaWiki 1.14 has no ContentHandler, so a brew page is
 * handled by a custom Article subclass returned from the ArticleFromTitle hook
 * (fired from Wiki.php with two args on 1.14).
 */
$wgHooks['ArticleFromTitle'][] = 'HomebreweryWiki::onArticleFromTitle';

/**
 * Brew text validation (E1S1T7 - most robust: reject on save + guard on read).
 *
 * ArticleSave fires on every save; we only act for brew-namespace pages and
 * reject invalid text so a corrupt revision can never be stored.  The read
 * side is guarded in HomebreweryWiki_Article::getBrewText().
 */
$wgHooks['ArticleSave'][] = 'HomebreweryWiki::onArticleSave';

/**
 * Brew pane display (E1S2 placeholder + E1S3 rendered HTML).
 *
 * Both hooks are 1.14-signature (no $context / no OutputPage arg on the
 * article hook):
 *
 * - ArticleViewHeader, fired from Article::view() only, with
 *   ( &$article, &$outputDone, &$pcache ).  Setting $outputDone suppresses the
 *   stock wikitext parse so we can emit the raw brew source into a hidden
 *   placeholder instead of a mangled parse.  Diffs (DifferenceEngine) and
 *   action=raw return before this hook, so they stay untouched.
 *
 * - BeforePageDisplay, fired from OutputPage::output(), with ( &$out, &$sk ).
 *   Used to load the renderer bundle for brew page views only (legacy
 *   addScriptFile; 1.14 has no ResourceLoader).
 */
$wgHooks['ArticleViewHeader'][] = 'HomebreweryWiki::onArticleViewHeader';
$wgHooks['BeforePageDisplay'][] = 'HomebreweryWiki::onBeforePageDisplay';

/**
 * Run once MediaWiki is fully initialised (the 1.14 idiom).  The callback is
 * where later tasks register namespaces and the brew content type.
 */
$wgExtensionFunctions[] = 'HomebreweryWiki::setup';
