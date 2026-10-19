<?php
/**
 * Brew article class.
 *
 * MediaWiki 1.14 has no ContentHandler (1.21+); a custom Article subclass
 * returned from the ArticleFromTitle hook is the extension point for custom
 * page behaviour.  At this stage (E1S1T3) the class is a thin subclass so brew
 * pages exist as first-class pages; rendering behaviour is added later.
 *
 * PHP 5.2 compatible: no namespaces, no closures, no short array syntax.
 *
 * @file
 */

if ( !defined( 'MEDIAWIKI' ) ) {
    die( 'This file is a MediaWiki extension and must not be loaded directly.' );
}

/**
 * Article handler for pages in the brew namespace (NS_MANUAL).
 *
 * The 1.14 Article constructor is __construct( Title $title, $oldId = null ),
 * which is inherited here.
 */
class HomebreweryWiki_Article extends Article {

    /*
     * Standard-editing invariants (E1S1T4) - preserved deliberately:
     *
     * - Editing a brew page uses MediaWiki's stock plain-text edit form.  This
     *   class does NOT override edit(), getContent() or anything EditPage relies
     *   on, so no custom editor is introduced.
     * - Permission checks are stock as well: anonymous visitors remain read-only
     *   with the usual "view source" tab, and edit rights come from the wiki's
     *   normal group permissions (Epic B).  Nothing here widens access.
     * - A brew page body is markdown stored as a plain string, so the edit box
     *   and preview receive the raw text unchanged.
     *
     * E1S1T5 adds rendering on top of this; it must not disturb the above.
     */

    /**
     * Build a brew article for a title, or return null when the title is not a
     * brew page.  Keeps the ArticleFromTitle handler thin.
     *
     * @param Title $title
     * @return HomebreweryWiki_Article|null
     */
    public static function newFromTitle( $title ) {
        if ( !( $title instanceof Title ) || $title->getNamespace() !== NS_MANUAL ) {
            return null;
        }
        return new HomebreweryWiki_Article( $title );
    }

    /**
     * Whether this page is a brew page.  Always true for this class; provided so
     * shared code can ask the question without knowing the class.
     *
     * @return bool
     */
    public function isBrewPage() {
        return $this->getTitle()->getNamespace() === NS_MANUAL;
    }

    /**
     * The raw brew source, exactly as stored (E1S1T6).
     *
     * On 1.14, Article content is a plain string: Article::fetchContent() reads
     * Revision::getText() and Article::getContent() returns that string.  This
     * subclass never runs the source through the parser and never serialises it
     * to HTML, so storage and retrieval are a byte-for-byte round trip of the
     * author's markdown.
     *
     * @return string Raw brew markdown ('' when the page has no content yet).
     */
    public function getBrewText() {
        $text = $this->getContent();
        if ( ! HomebreweryWiki::isValidBrewText( $text ) ) {
            return '';
        }
        return $text;
    }

    /*
     * History and diffs (E1S1T8) use MediaWiki's stock revision APIs: the
     * Article base class fetches revisions and DifferenceEngine renders the
     * diff.  This subclass overrides none of that path, so brew pages get
     * normal history entries and clean plain-text diffs of the stored markdown.
     */
}
