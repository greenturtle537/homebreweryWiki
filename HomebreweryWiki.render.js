/**
 * HomebreweryWiki render module (E1S3, shared with the preview in E1S4).
 *
 * Replaces the E1S2 plain-text display with rendered, sanitized HTML.  The
 * server still emits the source into the hidden placeholder (#hbw-source
 * inside .hbw-brew) and loads the renderer scripts only on a brew page view or
 * a brew edit preview (see HomebreweryWiki.php / HomebreweryWiki.class.php).
 * Preview and saved view therefore run this exact module with the exact same
 * markup contract (DESIGN D3).
 *
 * Load order (legacy addScriptFile, MW 1.14 has no ResourceLoader):
 *   1. vendor/marked-0.3.19.min.js   markdown -> HTML
 *   2. vendor/dompurify-2.5.8.min.js  HTML sanitizer (D7)
 *   3. this file                     render + inject into the pane
 *
 * Sanitization baseline (DESIGN.md D7 / SECURITY-REVIEW.md F1-F3):
 *   - remove <script>, <iframe>, <object>, <embed>, <form>, <style>,
 *     <audio>, <picture>, <source>, <video>, <track>, <svg>, ...
 *   - remove event-handler attributes, unknown protocols (DOMPurify), and
 *     the poster/srcset/background attributes
 *   - inline CSS is an allowlist: only safe properties with values that
 *     contain no resource-loading function (url(, image-set(), ...), no CSS
 *     escapes, and no position/overlay control
 *   - keep only same-origin images and inline `data:image/*` images (D2)
 *
 * On any failure the module falls back to the E1S2 plain <pre> so a reader
 * never loses the content.  ES5 only (desktop browser floor, Q19).
 */
( function () {
    'use strict';

    var SOURCE_ID = 'hbw-source';
    var RENDERED_ID = 'hbw-brew-rendered';
    var RENDERED_CLASS = 'hbw-brew-rendered';
    var PAGE_CLASS = 'hbw-page';
    var COLUMN_CLASS = 'hbw-column';

    /**
     * A Homebrewery split marker on a line of its own (Q18 / E3S1).
     *
     * `\page` starts a new page block, `\column` starts a new column inside
     * the current page.  Optional attributes after the token (Homebrewery
     * allows e.g. `\page [landscape]`) are consumed with the marker, so no
     * marker text can reach the rendered content.
     *
     * @type {RegExp}
     */
    var SPLIT_MARKER = /^[ \t]*\\(page|column)(?:[ \t].*)?$/;

    var SANITIZE_CONFIG = {
        FORBID_TAGS: [
            'script', 'iframe', 'object', 'embed', 'form', 'input',
            'button', 'textarea', 'select', 'style', 'link', 'meta', 'base',
            // Media elements can fetch from author-controlled URLs through
            // src / srcset / poster; they are not needed for brew pages.
            'audio', 'picture', 'source', 'video', 'track',
            // SVG image/feImage (and the legacy background attribute) can
            // fetch external URLs without going through the img check.
            'svg'
        ],
        FORBID_ATTR: [ 'srcdoc', 'formaction', 'poster', 'srcset', 'background' ],
        ALLOW_DATA_ATTR: false
    };

    /**
     * Properties authors may set inline.  Anything else (position, top/left,
     * z-index, cursor, filter, ...) is dropped, which also removes the whole
     * `position: fixed` family rather than a single value pattern.
     *
     * @type {Object.<string, boolean>}
     */
    var ALLOWED_CSS_PROPERTIES = {
        'color': true,
        'background': true,
        'background-color': true,
        'background-image': true,
        'font': true,
        'font-family': true,
        'font-size': true,
        'font-style': true,
        'font-weight': true,
        'font-variant': true,
        'font-stretch': true,
        'line-height': true,
        'letter-spacing': true,
        'word-spacing': true,
        'text-align': true,
        'text-decoration': true,
        'text-transform': true,
        'text-indent': true,
        'text-shadow': true,
        'text-overflow': true,
        'white-space': true,
        'word-break': true,
        'word-wrap': true,
        'overflow-wrap': true,
        'margin': true,
        'margin-top': true,
        'margin-right': true,
        'margin-bottom': true,
        'margin-left': true,
        'padding': true,
        'padding-top': true,
        'padding-right': true,
        'padding-bottom': true,
        'padding-left': true,
        'border': true,
        'border-top': true,
        'border-right': true,
        'border-bottom': true,
        'border-left': true,
        'border-color': true,
        'border-style': true,
        'border-width': true,
        'border-radius': true,
        'border-collapse': true,
        'border-spacing': true,
        'width': true,
        'height': true,
        'max-width': true,
        'max-height': true,
        'min-width': true,
        'min-height': true,
        'display': true,
        'float': true,
        'clear': true,
        'vertical-align': true,
        'box-sizing': true,
        'overflow': true,
        'overflow-x': true,
        'overflow-y': true,
        'opacity': true,
        'list-style': true,
        'list-style-type': true,
        'list-style-position': true,
        'columns': true,
        'column-count': true,
        'column-gap': true,
        'column-rule': true,
        'break-inside': true,
        'page-break-before': true,
        'page-break-after': true,
        'page-break-inside': true
    };

    /**
     * CSS functions that carry no resource fetch and may appear in a value.
     *
     * @type {Object.<string, boolean>}
     */
    var ALLOWED_CSS_FUNCTIONS = {
        'rgb': true,
        'rgba': true,
        'hsl': true,
        'hsla': true,
        'calc': true
    };

    /**
     * Whether a CSS value is free of resource-loading tricks.
     *
     * `url(` is not enough: `image-set(`, `cross-fade(`, `element(` and
     * friends also fetch, and a backslash can spell a function name with CSS
     * escapes (`u\72l(`).  Only the safe colour/calc functions are allowed.
     *
     * @param {string} value CSS value portion
     * @return {boolean}
     */
    function isSafeCssValue( value ) {
        var lower = String( value ).toLowerCase();
        if ( lower.indexOf( '\\' ) !== -1 ) {
            return false;
        }
        var match;
        var fn = /([a-z-]+)\s*\(/g;
        while ( ( match = fn.exec( lower ) ) !== null ) {
            if ( !ALLOWED_CSS_FUNCTIONS[ match[ 1 ] ] ) {
                return false;
            }
        }
        return true;
    }

    /**
     * Reduce a style attribute to allowed properties with safe values.
     * MVP baseline (D7); a stricter policy is deferred to post-MVP hardening
     * (Epic J).
     *
     * @param {string} value style attribute value
     * @return {string} filtered declarations
     */
    function filterCss( value ) {
        var parts = String( value ).split( ';' );
        var kept = [];
        var i;
        for ( i = 0; i < parts.length; i++ ) {
            var decl = parts[ i ];
            var colon = decl.indexOf( ':' );
            if ( !decl || colon < 1 ) {
                continue;
            }
            var prop = decl.substring( 0, colon ).replace( /^\s+|\s+$/g, '' ).toLowerCase();
            var val = decl.substring( colon + 1 ).replace( /^\s+|\s+$/g, '' );
            if ( !ALLOWED_CSS_PROPERTIES[ prop ] ) {
                continue;
            }
            if ( !isSafeCssValue( val ) ) {
                continue;
            }
            kept.push( prop + ': ' + val );
        }
        return kept.join( ';' );
    }

    /**
     * Whether an image src may be loaded: inline data images or our own origin
     * only (D2 / F3).  Relative URLs resolve against the current page.
     *
     * @param {string} src
     * @return {boolean}
     */
    function isAllowedImage( src ) {
        if ( /^data:image\//i.test( src ) ) {
            return true;
        }
        var a = document.createElement( 'a' );
        a.href = src;
        if ( !a.protocol || !a.host ) {
            return false;
        }
        return a.protocol + '//' + a.host === window.location.protocol + '//' + window.location.host;
    }

    /**
     * Remove / neuter unsafe attributes that DOMPurify leaves alone.
     * Runs on a detached container before its HTML is inserted.
     *
     * @param {HTMLElement} box
     */
    function hardenTree( box ) {
        var nodes = box.getElementsByTagName( '*' );
        var i;
        for ( i = nodes.length - 1; i >= 0; i-- ) {
            var node = nodes[ i ];

            var style = node.getAttribute( 'style' );
            if ( style ) {
                var safe = filterCss( style );
                if ( safe ) {
                    node.setAttribute( 'style', safe );
                } else {
                    node.removeAttribute( 'style' );
                }
            }

            if ( node.nodeName && node.nodeName.toLowerCase() === 'img' ) {
                var src = node.getAttribute( 'src' );
                if ( src && !isAllowedImage( src ) ) {
                    node.removeAttribute( 'src' );
                    node.setAttribute( 'data-hbw-blocked', 'external' );
                    if ( !node.getAttribute( 'alt' ) ) {
                        node.setAttribute( 'alt', 'External image blocked' );
                    }
                }
            }
        }
    }

    /**
     * Render markdown to sanitized HTML.  Returns null when the renderer or
     * sanitizer is unavailable (caller then uses the plain-text fallback).
     *
     * @param {string} text raw brew source
     * @return {string|null}
     */
    function renderMarkdown( text ) {
        var purifier = window.DOMPurify;
        var renderer = window.marked;
        var html;

        if ( !purifier || typeof purifier.sanitize !== 'function' ) {
            return null;
        }

        if ( typeof renderer === 'function' ) {
            html = renderer( text );
        } else if ( renderer && typeof renderer.parse === 'function' ) {
            html = renderer.parse( text );
        } else {
            return null;
        }

        if ( typeof html !== 'string' ) {
            return null;
        }

        var clean = purifier.sanitize( html, SANITIZE_CONFIG );
        var box = document.createElement( 'div' );
        box.innerHTML = clean;
        hardenTree( box );
        return box.innerHTML;
    }

    /**
     * Split brew source into Homebrewery page/column segments (E3S1).
     *
     * A page is an array of column sources; the result is an array of pages in
     * document order.  Marker lines are removed, so the returned text is ready
     * to render.  A brew without markers yields exactly one page with one
     * column, which keeps the "one page block per brew page" contract uniform.
     *
     * @param {string} text raw brew source
     * @return {Array.<Array.<string>>} pages -> columns -> source
     */
    function splitBrew( text ) {
        var lines = String( text ).split( /\r\n|\r|\n/ );
        var pages = [];
        var columns = [];
        var current = [];
        var marker;
        var i;

        for ( i = 0; i < lines.length; i++ ) {
            marker = SPLIT_MARKER.exec( lines[ i ] );
            if ( !marker ) {
                current.push( lines[ i ] );
                continue;
            }

            columns.push( current.join( '\n' ) );
            current = [];

            if ( marker[ 1 ] === 'page' ) {
                pages.push( columns );
                columns = [];
            }
        }

        columns.push( current.join( '\n' ) );
        pages.push( columns );

        return pages;
    }

    /**
     * Render every column, returning pages of sanitized HTML.  Returns null
     * when the renderer bundle is unavailable for any segment, so the caller
     * can fall back to the plain-text view for the whole brew.
     *
     * @param {Array.<Array.<string>>} pages pages -> columns -> source
     * @return {Array.<Array.<string>>|null} pages -> columns -> HTML
     */
    function renderPages( pages ) {
        var renderedPages = [];
        var renderedColumns;
        var html;
        var page;
        var column;
        var p;
        var c;

        for ( p = 0; p < pages.length; p++ ) {
            page = pages[ p ];
            renderedColumns = [];
            for ( c = 0; c < page.length; c++ ) {
                column = page[ c ];
                html = renderMarkdown( column );
                if ( html === null ) {
                    return null;
                }
                renderedColumns.push( html );
            }
            renderedPages.push( renderedColumns );
        }

        return renderedPages;
    }

    /**
     * Build the rendered container with one page block per brew page (E3S1).
     * Each page block holds one column block per `\column` segment, in
     * document order.
     *
     * @param {Array.<Array.<string>>} renderedPages pages -> columns -> HTML
     * @return {HTMLElement}
     */
    function buildRendered( renderedPages ) {
        var container = document.createElement( 'div' );
        var pageNode;
        var columnNode;
        var p;
        var c;

        container.className = RENDERED_CLASS;
        container.id = RENDERED_ID;
        container.setAttribute( 'data-hbw-render', 'html' );

        for ( p = 0; p < renderedPages.length; p++ ) {
            pageNode = document.createElement( 'div' );
            pageNode.className = PAGE_CLASS;
            pageNode.setAttribute( 'data-hbw-page', String( p + 1 ) );

            for ( c = 0; c < renderedPages[ p ].length; c++ ) {
                columnNode = document.createElement( 'div' );
                columnNode.className = COLUMN_CLASS;
                columnNode.innerHTML = renderedPages[ p ][ c ];
                pageNode.appendChild( columnNode );
            }

            container.appendChild( pageNode );
        }

        return container;
    }

    /**
     * Build the visible pane content from the hidden source placeholder.
     */
    function renderBrew() {
        var source = document.getElementById( SOURCE_ID );
        if ( !source ) {
            // Not a brew view, or already rendered.
            return;
        }

        var host = source.parentNode;
        if ( !host ) {
            return;
        }

        var text = source.textContent || source.innerText || '';
        var renderedPages = null;
        var rendered = null;

        try {
            renderedPages = renderPages( splitBrew( text ) );
        } catch ( e ) {
            renderedPages = null;
        }

        if ( renderedPages !== null ) {
            rendered = buildRendered( renderedPages );
            host.appendChild( rendered );
        } else {
            // Degraded path: never hide the reader's content because the
            // renderer bundle failed to load or threw.
            rendered = document.createElement( 'pre' );
            rendered.className = 'hbw-brew-text';
            rendered.id = 'hbw-brew-text';
            rendered.appendChild( document.createTextNode( text ) );
            rendered.setAttribute( 'data-hbw-render', 'fallback' );
            host.appendChild( rendered );
        }

        host.removeChild( source );
    }

    if ( document.readyState === 'complete' || document.readyState === 'interactive' ) {
        renderBrew();
    } else if ( document.addEventListener ) {
        document.addEventListener( 'DOMContentLoaded', renderBrew, false );
    } else if ( window.attachEvent ) {
        window.attachEvent( 'onload', renderBrew );
    } else {
        window.onload = renderBrew;
    }
}() );
