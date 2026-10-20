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
 *   1. vendor/homebrewery-3.21.0/renderer.min.js  pinned Homebrewery v3 renderer
 *      (E3S2T1; defines window.HomebreweryRenderer)
 *   2. vendor/marked-0.3.19.min.js   degraded fallback if (1) cannot run
 *   3. vendor/dompurify-2.5.8.min.js  HTML sanitizer (D7)
 *   4. this file                     render + inject into the pane
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
     * Page marker on a line of its own (Q18 / E3S1).
     *
     * `\page` / `\pagebreak`, with the optional `{ ... }` attribute form from
     * upstream's `PAGEBREAK_REGEX_V3`
     * (`/^(?=\\page(?:break)?(?: *{[^\n{}]*})?$)/m`).  The whole line is
     * consumed so no marker text can reach the rendered content.
     *
     * @type {RegExp}
     */
    var PAGE_MARKER = /^[ \t]*\\(?:page|pagebreak)(?:[ \t]*\{[^\n{}]*\})?[ \t]*$/;

    /**
     * Column marker on a line of its own.  Only used for the degraded
     * `marked` path: the pinned renderer turns this into its own
     * `<div class="columnSplit">` inside the page (see renderPages).
     *
     * @type {RegExp}
     */
    var COLUMN_MARKER = /^[ \t]*\\(?:column|columnbreak)(?:[ \t]*\{[^\n{}]*\})?[ \t]*$/;

    /**
     * The marker the pinned renderer emits for a column break.
     *
     * @type {RegExp}
     */
    var RENDERED_COLUMN_SPLIT = /<div[^>]*class=["']columnSplit["'][^>]*>\s*<\/div>/gi;

    /**
     * Version of the pinned Homebrewery renderer vendored in
     * vendor/homebrewery-3.21.0/ (E3S2T1).
     *
     * @type {string}
     */
    var HOMEBREWERY_VERSION = '3.21.0';

    /**
     * Which renderer produced the current output, for the container's
     * `data-hbw-renderer` marker.
     *
     * @type {string|null}
     */
    var activeRenderer = null;

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
     * The pinned Homebrewery renderer (E3S2T1) is preferred; the older
     * `marked` bundle is kept as the degraded path for browsers that cannot
     * parse the modern bundle.
     *
     * @param {string} text       raw brew source
     * @param {number} pageNumber zero-based page index (Homebrewery variable)
     * @return {string|null}
     */
    function renderMarkdown( text, pageNumber ) {
        var purifier = window.DOMPurify;
        var homebrewery = window.HomebreweryRenderer;
        var renderer = window.marked;
        var html = null;

        if ( !purifier || typeof purifier.sanitize !== 'function' ) {
            return null;
        }

        if ( homebrewery && typeof homebrewery.render === 'function' ) {
            try {
                html = homebrewery.render( text, pageNumber || 0 );
                activeRenderer = 'homebrewery-' + HOMEBREWERY_VERSION;
            } catch ( e ) {
                // A pinned-renderer failure must not cost the reader the
                // content: fall through to the marked bundle.
                html = null;
            }
        }

        if ( html === null && typeof renderer === 'function' ) {
            html = renderer( text );
            activeRenderer = 'marked-0.3.19';
        } else if ( html === null && renderer && typeof renderer.parse === 'function' ) {
            html = renderer.parse( text );
            activeRenderer = 'marked-0.3.19';
        } else if ( html === null ) {
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
     * Split text on marker lines, dropping the marker lines themselves.
     *
     * @param {string} text   source text
     * @param {RegExp} marker marker matcher
     * @return {Array.<string>} segments in document order
     */
    function splitOnMarker( text, marker ) {
        var lines = String( text ).split( /\r\n|\r|\n/ );
        var parts = [];
        var current = [];
        var i;

        for ( i = 0; i < lines.length; i++ ) {
            if ( marker.test( lines[ i ] ) ) {
                parts.push( current.join( '\n' ) );
                current = [];
            } else {
                current.push( lines[ i ] );
            }
        }

        parts.push( current.join( '\n' ) );
        return parts;
    }

    /**
     * Split brew source into page sources (E3S1).  A brew without page
     * markers yields one page, so "one page block per brew page" holds
     * uniformly.
     *
     * @param {string} text raw brew source
     * @return {Array.<string>} page sources in document order
     */
    function splitPages( text ) {
        return splitOnMarker( text, PAGE_MARKER );
    }

    /**
     * Split one page source into column sources.  Only the degraded `marked`
     * path needs this; the pinned renderer handles `\column` itself.
     *
     * @param {string} page page source
     * @return {Array.<string>} column sources in document order
     */
    function splitColumns( page ) {
        return splitOnMarker( page, COLUMN_MARKER );
    }

    /**
     * Split rendered page HTML at the pinned renderer's columnSplit markers.
     *
     * @param {string} html sanitized page HTML
     * @return {Array.<string>} column HTML in document order
     */
    function splitRenderedColumns( html ) {
        return String( html ).split( RENDERED_COLUMN_SPLIT );
    }

    /**
     * Render pages to sanitized HTML (E3S1 + E3S2T1).
     *
     * A page is rendered in a single call so the pinned renderer's per-page
     * state (variable definitions, heading ids) spans all of its columns; the
     * rendered columnSplit markers are then turned into column blocks.  The
     * `marked` fallback has no column support, so it renders each column from
     * the source instead.
     *
     * @param {Array.<string>} pages page sources
     * @return {Array.<Array.<string>>|null} pages -> columns -> HTML
     */
    function renderPages( pages ) {
        var renderedPages = [];
        var renderedColumns;
        var columns;
        var columnHtml;
        var html;
        var p;
        var c;

        for ( p = 0; p < pages.length; p++ ) {
            html = renderMarkdown( pages[ p ], p );
            if ( html === null ) {
                return null;
            }

            if ( activeRenderer === 'homebrewery-' + HOMEBREWERY_VERSION ) {
                renderedPages.push( splitRenderedColumns( html ) );
                continue;
            }

            columns = splitColumns( pages[ p ] );
            if ( columns.length === 1 ) {
                renderedPages.push( [ html ] );
                continue;
            }

            renderedColumns = [];
            for ( c = 0; c < columns.length; c++ ) {
                columnHtml = renderMarkdown( columns[ c ], p );
                if ( columnHtml === null ) {
                    return null;
                }
                renderedColumns.push( columnHtml );
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
        if ( activeRenderer ) {
            container.setAttribute( 'data-hbw-renderer', activeRenderer );
        }

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

        activeRenderer = null;

        try {
            renderedPages = renderPages( splitPages( text ) );
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
