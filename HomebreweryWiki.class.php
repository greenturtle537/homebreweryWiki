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

    /**
     * Whether the renderer bundle must load for this request (E1S3T1).
     *
     * Kept a pure predicate so the enqueue rule is unit-testable without an
     * OutputPage or a live request.  The bundle loads only for an ordinary
     * *view* of a brew-namespace page: edit, history, preview (action=submit),
     * purge, diffs, and every non-brew page are excluded.
     *
     * @param Title|mixed $title  Page title (or anything; non-Title => false).
     * @param string      $action Requested action, e.g. 'view', 'edit'.
     * @param mixed       $diff   Raw 'diff' request value (null when absent).
     * @return bool
     */
    public static function shouldEnqueueRenderer( $title, $action, $diff ) {
        if ( !( $title instanceof Title ) ) {
            return false;
        }
        if ( $title->getNamespace() !== NS_MANUAL ) {
            return false;
        }
        if ( $action !== 'view' ) {
            return false;
        }
        if ( $diff !== null ) {
            return false;
        }
        return true;
    }

    /**
     * Renderer assets in load order (E1S3T1): markdown parser, sanitizer, then
     * the module that reads the hidden source and fills the pane.  Kept as a
     * pure list so unit tests can assert the order without an OutputPage.
     *
     * @return array Script paths relative to $wgScriptPath.
     */
    public static function rendererAssets() {
        return array(
            HOMEBREWERYWIKI_MARKED_LIB,
            HOMEBREWERYWIKI_PURIFY_LIB,
            HOMEBREWERYWIKI_RENDER_MODULE,
        );
    }

    /**
     * BeforePageDisplay hook.  Loads the renderer bundle for brew page views
     * only (E1S3T1).  Non-brew pages, edit/history/preview screens and diffs
     * receive no brew module, so nothing outside a brew view is affected.
     *
     * MediaWiki 1.14 signature: ( &$out, &$sk ).
     *
     * @param OutputPage &$out
     * @param Skin       &$sk
     * @return bool Always true so other handlers keep running.
     */
    public static function onBeforePageDisplay( &$out, &$sk ) {
        global $wgRequest, $wgScriptPath, $wgTitle;

        // 1.14 OutputPage has no getTitle(); the current Title is the $wgTitle
        // global (it is null/absent on some request types, which we treat as
        // "not a brew view").
        $title  = $wgTitle;
        $action = $wgRequest->getVal( 'action', 'view' );
        $diff   = $wgRequest->getVal( 'diff' );

        if ( ! self::shouldEnqueueRenderer( $title, $action, $diff ) ) {
            return true;
        }

        foreach ( self::rendererAssets() as $asset ) {
            $out->addScriptFile( $wgScriptPath . $asset );
        }
        return true;
    }

    /**
     * ArticleViewHeader hook.  For a current revision of an existing brew page,
     * emit the raw brew source into a hidden placeholder and suppress the stock
     * wikitext parse (E1S2, "no raw-markdown flash" - D9).  The render module
     * then replaces the placeholder with sanitized rendered HTML (E1S3).
     *
     * MediaWiki 1.14 signature: ( &$article, &$outputDone, &$pcache ).  This
     * hook fires from Article::view() only, so diffs (and action=raw) never
     * reach it.
     *
     * @param Article &$article    Article being viewed.
     * @param bool    &$outputDone Set true to skip the stock content output.
     * @param bool    &$pcache     Cleared so no parser-cache entry is written.
     * @return bool Always true.
     */
    public static function onArticleViewHeader( &$article, &$outputDone, &$pcache ) {
        if ( !( $article instanceof HomebreweryWiki_Article ) ) {
            return true;
        }

        $title = $article->getTitle();
        // Non-existent pages keep the stock "no article" screen; read-access
        // checks stay with core (never bypass userCanRead()).
        if ( ! $title->exists() || ! $title->userCanRead() ) {
            return true;
        }
        // Old revisions keep the stock path for this slice.
        if ( $article->getOldID() !== 0 ) {
            return true;
        }

        $outputDone = true;
        $pcache     = false;

        global $wgOut;
        $wgOut->addHTML( self::brewPlaceholder( $article->getBrewText() ) );
        return true;
    }

    /**
     * Build the hidden source placeholder the view module consumes (E1S2T2).
     *
     * The wrapper carries the single scoping class `.hbw-brew` (Q25).  The raw
     * brew source is HTML-escaped and hidden, so it is available to the module
     * (and to no-JS crawlers) but never flashed to the reader; the module builds
     * the visible <pre> from it and drops the placeholder.
     *
     * The hidden container is a <div>, not a <pre>: the HTML parser strips one
     * newline immediately after a <pre> start tag, which would eat a leading
     * newline in the saved source.  A <div> text node round-trips exactly.
     * The <noscript> block renders the escaped source for readers with JS off;
     * its <pre> deliberately starts with a sacrificial newline so the parser
     * strips that one instead of a real leading newline.  With JS on, the
     * render module also uses this exact source as its render input.
     *
     * @param mixed $text Raw brew markdown.
     * @return string HTML fragment.
     */
    public static function brewPlaceholder( $text ) {
        if ( !is_string( $text ) ) {
            $text = '';
        }
        $escaped = htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' );
        return "<div class=\"hbw-brew\" id=\"hbw-brew\">"
             . "<div class=\"hbw-source\" id=\"hbw-source\" style=\"display:none\">"
             . $escaped
             . "</div>"
             . "<noscript><pre class=\"hbw-brew-text\">\n"
             . $escaped
             . "</pre></noscript></div>\n";
    }
}
