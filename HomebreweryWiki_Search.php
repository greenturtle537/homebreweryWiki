<?php
/**
 * Clean search snippets for brew pages (E4S4T1).
 *
 * MediaWiki 1.14 builds a snippet from the stored revision text, so a brew
 * page would otherwise show raw markdown (`# Heading`, `[[Page|label]]`,
 * table pipes, fences) in search results.  SearchResult::getTextSnippet() is
 * a method, not a hook, so the only extension point is the search engine
 * itself: these subclasses keep the built-in MySQL behaviour and change only
 * the snippet text, and only for the brew namespace.
 *
 * Target platform: MediaWiki 1.14.1 / PHP 5.2.12.  No namespaces, no
 * closures, no short array syntax.
 *
 * @file
 */

/**
 * Search result whose snippet text is the brew's readable text (E4S4T1).
 */
class HomebreweryWiki_SearchResult extends SearchResult {

    /**
     * Highlight the readable text of a brew page, not its markdown.
     *
     * @param array $terms Terms to highlight.
     * @return string
     */
    function getTextSnippet( $terms ) {
        $this->initText();
        if ( $this->mTitle instanceof Title &&
             $this->mTitle->getNamespace() === NS_MANUAL ) {
            $this->mText = HomebreweryWiki::brewSnippetText( $this->mText );
        }
        return parent::getTextSnippet( $terms );
    }
}

/**
 * Result set that hands out the snippet-aware result class (E4S4T1).
 */
class HomebreweryWiki_MySQLSearchResultSet extends MySQLSearchResultSet {

    /**
     * 1.14 uses a PHP4-style constructor; forward it explicitly.
     *
     * @param ResultWrapper $resultSet
     * @param array         $terms
     */
    function HomebreweryWiki_MySQLSearchResultSet( $resultSet, $terms ) {
        parent::MySQLSearchResultSet( $resultSet, $terms );
    }

    /**
     * @return SearchResult|false
     */
    function next() {
        $row = $this->mResultSet->fetchObject();
        if ( $row === false ) {
            return false;
        }
        return new HomebreweryWiki_SearchResult( $row );
    }
}

/**
 * MySQL search engine that returns snippet-aware results (E4S4T1).
 *
 * Everything else - query parsing, ordering, limits - stays with the core
 * SearchMySQL implementation.
 */
class HomebreweryWiki_SearchMySQL extends SearchMySQL {

    /**
     * @param string $term Raw search term.
     * @return HomebreweryWiki_MySQLSearchResultSet
     */
    function searchText( $term ) {
        $resultSet = $this->db->resultObject(
            $this->db->query( $this->getQuery( $this->filter( $term ), true ) )
        );
        return new HomebreweryWiki_MySQLSearchResultSet(
            $resultSet, $this->searchTerms
        );
    }

    /**
     * @param string $term Raw search term.
     * @return HomebreweryWiki_MySQLSearchResultSet
     */
    function searchTitle( $term ) {
        $resultSet = $this->db->resultObject(
            $this->db->query( $this->getQuery( $this->filter( $term ), false ) )
        );
        return new HomebreweryWiki_MySQLSearchResultSet(
            $resultSet, $this->searchTerms
        );
    }
}
