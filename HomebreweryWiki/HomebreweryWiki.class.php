<?php
/**
 * HomebreweryWiki extension core class.
 *
 * PHP 5.2 compatible: no namespaces, no closures, no short array syntax.
 *
 * @file
 */

if ( !defined( 'MEDIAWIKI' ) ) {
    die( 'This file is a MediaWiki extension and must not be loaded directly.' );
}

/**
 * Core setup and shared helpers for the HomebreweryWiki extension.
 *
 * The entry point (HomebreweryWiki.php) registers credits, i18n, the brew
 * namespace (E1S1T2, at load time) and this class.  setup() still does nothing;
 * the brew content type lands here in E1S1T3.
 */
class HomebreweryWiki {

    /**
     * $wgExtensionFunctions entry point.  Called once, after MediaWiki is
     * fully initialised.
     *
     * @return void
     */
    public static function setup() {
        // Intentionally empty for the "empty extension" skeleton.
        // Later tasks append registration work here.
    }

    /**
     * ArticleFromTitle hook.  Return a brew-aware Article subclass for pages in
     * the brew namespace so that brew pages are first-class.
     *
     * MediaWiki 1.14 signature: ( &$title, &$article ) - two args, no $context
     * (that is a 1.18+ addition).
     *
     * @param Title   &$title   Page title.
     * @param Article &$article Article object, or null.
     * @return bool Always true so other handlers keep running.
     */
    public static function onArticleFromTitle( &$title, &$article ) {
        $brew = HomebreweryWiki_Article::newFromTitle( $title );
        if ( $brew !== null ) {
            $article = $brew;
        }
        return true;
    }

    /**
     * ArticleSave hook.  Reject brew saves whose source is not valid UTF-8
     * text, so a corrupt revision can never be stored (E1S1T7).
     *
     * MediaWiki 1.14 signature:
     *   array( &$this, &$user, &$text, &$summary, $minor, $watch, $section,
     *          &$flags, &$status )
     *
     * @return bool False to abort the save, true otherwise.
     */
    public static function onArticleSave( &$article, &$user, &$text, &$summary, $minor, $watch, $section, &$flags, &$status ) {
        if ( ! ( $article instanceof Article ) ||
             $article->getTitle()->getNamespace() !== NS_MANUAL ) {
            return true;
        }
        if ( ! HomebreweryWiki::isValidBrewText( $text ) ) {
            $status = Status::newFatal( 'homebrewerywiki-invalid-brew-text' );
            return false;
        }
        return true;
    }

    /**
     * Whether $text is safe to treat as brew source (E1S1T7): a string that is
     * empty or valid UTF-8.
     *
     * On 1.14 the framework already stores and returns article text as a plain
     * string, so brew revisions are never rewritten by this extension.  This
     * predicate lets load/save callers reject malformed data instead of letting
     * it corrupt downstream handling.
     *
     * @param mixed $text
     * @return bool
     */
    public static function isValidBrewText( $text ) {
        if ( !is_string( $text ) ) {
            return false;
        }
        if ( $text === '' ) {
            return true;
        }
        // preg_match() returns false on malformed UTF-8, 1 otherwise.
        return ( preg_match( '//u', $text ) === 1 );
    }
}
