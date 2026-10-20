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
    var PAGE_FOOTER_CLASS = 'hbw-page-footer';
    var FOOTNOTE_REF_CLASS = 'hbw-footnote-ref';
    var FOOTNOTE_NOTES_CLASS = 'hbw-footnotes';
    var FOOTNOTE_LIST_CLASS = 'hbw-footnotes-list';
    var FOOTNOTE_ITEM_CLASS = 'hbw-footnote';
    var FOOTNOTE_BACK_CLASS = 'hbw-footnote-back';

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
     * Footnote reference (`[^label]`) inside source text.
     *
     * @type {RegExp}
     */
    var FOOTNOTE_REF = /\[\^([^\]\s]+)\]/g;

    /**
     * Footnote definition line (`[^label]: note text`), the definition's
     * first line.  Continuation lines belong to the definition below.
     *
     * @type {RegExp}
     */
    var FOOTNOTE_DEF_LINE = /^[ \t]*\[\^([^\]\s]+)\][ \t]*:[ \t]*(.*)$/;

    /**
     * Strip footnote definitions from one page source (E3S3T3).
     *
     * Definitions live brew-wide: a definition found on any page resolves
     * references on any page, matching how readers follow a brew.  Definition
     * lines (and their indented continuations) are removed up front because
     * the pinned renderer would otherwise rewrite `[^label]` text into its
     * own superscript spans before this extension ever sees them.  Note
     * bodies stay verbatim so bold, links and tables still apply inside the
     * notes.
     *
     * @param {Array.<string>} pages page sources
     * @return {{ pages: Array.<string>, notes: Object.<string, string> }}
     */
    function extractFootnotes( pages ) {
        var notes = {};
        var cleaned = [];
        var lines;
        var kept;
        var current;
        var match;
        var p;
        var i;

        for ( p = 0; p < pages.length; p++ ) {
            lines = String( pages[ p ] ).split( /\r\n|\r|\n/ );
            kept = [];
            current = null;
            for ( i = 0; i < lines.length; i++ ) {
                match = FOOTNOTE_DEF_LINE.exec( lines[ i ] );
                if ( match ) {
                    current = match[ 1 ];
                    notes[ current ] = match[ 2 ];
                    continue;
                }
                if ( current !== null &&
                    ( /^[ \t]+/.test( lines[ i ] ) || lines[ i ] === '' ) ) {
                    notes[ current ] += '\n' + lines[ i ];
                    continue;
                }
                current = null;
                kept.push( lines[ i ] );
            }
            cleaned.push( kept.join( '\n' ) );
        }

        return { pages: cleaned, notes: notes };
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
     * @param {Object.<string, string>} footnoteNotes footnote bodies by label
     * @return {Array.<Array.<string>>|null} pages -> columns -> HTML
     */
    function renderPages( pages, footnoteNotes ) {
        var renderedPages = [];
        var renderedColumns;
        var columns;
        var columnHtml;
        var pageMarked;
        var html;
        var p;
        var c;

        for ( p = 0; p < pages.length; p++ ) {
            pageMarked = markFootnoteRefs( pages[ p ], footnoteNotes );
            html = renderMarkdown( pageMarked, p );
            if ( html === null ) {
                return null;
            }

            if ( activeRenderer === 'homebrewery-' + HOMEBREWERY_VERSION ) {
                renderedPages.push( splitRenderedColumns( html ) );
                continue;
            }

            columns = splitColumns( pageMarked );
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
     * Footnote reference marker: `<span class="hbw-footnote-mark"
     * data-hbw-footnote="label">` with no content.  The span survives the
     * pinned renderer untouched (although DOMPurify drops the attribute), so
     * references are resolved by walking the source references and the
     * rendered marker spans side by side in document order.
     *
     * @type {RegExp}
     */
    var FOOTNOTE_MARKER = /<span class="hbw-footnote-mark"[^>]*><\/span>/g;

    /**
     * Replace defined footnote references in one page source with empty
     * marker spans (E3S3T3).  Only references with a matching definition
     * become markers; anything without one (including `[^nope]`) stays
     * verbatim so readers see the source text instead of a broken link.
     *
     * @param {string} pageSource page source
     * @param {Object.<string, string>} notes footnote bodies by label
     * @return {string} page source with markers
     */
    function markFootnoteRefs( pageSource, notes ) {
        return String( pageSource ).replace( FOOTNOTE_REF, function ( whole, label ) {
            if ( !notes.hasOwnProperty( label ) ) {
                return whole;
            }
            return '<span class="hbw-footnote-mark" data-hbw-footnote="' +
                label.replace( /&/g, '&amp;' ).replace( /"/g, '&quot;' ) +
                '"></span>';
        } );
    }

    /**
     * Resolve footnote references inside one rendered page (E3S3T3).
     *
     * Each `[^label]` text reference in a column becomes a superscript link
     * to that label's note; then the notes list for the page is appended
     * below the columns, each note linking back to its first reference.
     * References without a matching definition are left as plain text, and
     * unused definitions are never emitted.
     *
     * The pinned renderer rewrites bracket text into its own spans, so this
     * must run on the same extension first while `[^label]` text survives:
     * each page is pre-scanned and every reference is replaced by a marker
     * element before the renderer runs; the links are attached after.
     *
     * @param {string} pageSource page source with markers
     * @param {HTMLElement} pageNode rendered page block
     * @param {Object.<string, string>} notes footnote bodies by label
     * @return {void}
     */
    function linkFootnotes( pageSource, pageNode, notes ) {
        var order = [];
        var seen = {};
        var notesNode;
        var listNode;
        var itemNode;
        var backLink;
        var refLink;
        var markers;
        var marker;
        var label;
        var i;

        FOOTNOTE_REF.lastIndex = 0;
        while ( ( marker = FOOTNOTE_REF.exec( pageSource ) ) !== null ) {
            label = marker[ 1 ];
            if ( !notes.hasOwnProperty( label ) || seen[ label ] ) {
                continue;
            }
            seen[ label ] = true;
            order.push( label );
        }

        // DOMPurify strips the `data-hbw-footnote` attribute but keeps the
        // marker spans in place, so labels are matched by walking the source
        // references and the rendered markers side by side in document order.
        markers = [];
        ( function collect( node ) {
            var child;
            for ( child = node.firstChild; child; child = child.nextSibling ) {
                if ( child.nodeType !== 1 ) {
                    continue;
                }
                if ( child.nodeName.toLowerCase() === 'span' &&
                    ( ' ' + child.className + ' ' ).indexOf( ' hbw-footnote-mark ' ) !== -1 ) {
                    markers.push( child );
                }
                collect( child );
            }
        }( pageNode ) );

        FOOTNOTE_REF.lastIndex = 0;
        i = 0;
        while ( i < markers.length &&
            ( marker = FOOTNOTE_REF.exec( pageSource ) ) !== null ) {
            label = marker[ 1 ];
            if ( !notes.hasOwnProperty( label ) ) {
                continue;
            }
            refLink = document.createElement( 'a' );
            refLink.setAttribute( 'href', '#hbw-fn-' + encodeURIComponent( label ) );
            if ( !pageNode.querySelector( '#hbw-fnref-' + encodeURIComponent( label ) ) ) {
                refLink.setAttribute( 'id', 'hbw-fnref-' + encodeURIComponent( label ) );
            }
            refLink.className = FOOTNOTE_REF_CLASS;
            refLink.appendChild( document.createTextNode( '[' + label + ']' ) );
            markers[ i ].parentNode.replaceChild( refLink, markers[ i ] );
            i++;
        }

        if ( !order.length ) {
            return;
        }

        notesNode = document.createElement( 'div' );
        notesNode.className = FOOTNOTE_NOTES_CLASS;
        listNode = document.createElement( 'ol' );
        listNode.className = FOOTNOTE_LIST_CLASS;
        notesNode.appendChild( listNode );

        for ( i = 0; i < order.length; i++ ) {
            label = order[ i ];
            itemNode = document.createElement( 'li' );
            itemNode.setAttribute( 'id', 'hbw-fn-' + encodeURIComponent( label ) );
            itemNode.className = FOOTNOTE_ITEM_CLASS;
            itemNode.innerHTML = renderMarkdown( notes[ label ], 0 ) || '';
            backLink = document.createElement( 'a' );
            backLink.setAttribute( 'href', '#hbw-fnref-' + encodeURIComponent( label ) );
            backLink.className = FOOTNOTE_BACK_CLASS;
            backLink.setAttribute( 'aria-label', 'Back to reference' );
            backLink.appendChild( document.createTextNode( '\u21A9' ) );
            itemNode.appendChild( document.createTextNode( ' ' ) );
            itemNode.appendChild( backLink );
            listNode.appendChild( itemNode );
        }

        pageNode.appendChild( notesNode );
    }

    /**
     * Build the rendered container with one page block per brew page (E3S1).
     * Each page block holds one column block per `\column` segment, in
     * document order; E3S3 footnotes and page numbers hang below the last
     * column of the page they belong to.
     *
     * @param {Array.<Array.<string>>}   renderedPages pages -> columns -> HTML
     * @param {Array.<string>}           pageSources   page sources (marker
     *                                   order for the notes)
     * @param {Object.<string, string>}  notes         footnote bodies by label
     * @return {HTMLElement}
     */
    function buildRendered( renderedPages, pageSources, notes ) {
        var container = document.createElement( 'div' );
        var pageNode;
        var columnNode;
        var footerNode;
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

            linkFootnotes( pageSources[ p ], pageNode, notes );

            // Page footer: computed page number (E3S3T2).
            footerNode = document.createElement( 'div' );
            footerNode.className = PAGE_FOOTER_CLASS;
            footerNode.appendChild( document.createTextNode( String( p + 1 ) ) );
            pageNode.appendChild( footerNode );

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
        var pageSources = null;
        var footnoteData = null;
        var rendered = null;

        activeRenderer = null;

        try {
            pageSources = splitPages( text );
            footnoteData = extractFootnotes( pageSources );
            renderedPages = renderPages( footnoteData.pages, footnoteData.notes );
        } catch ( e ) {
            renderedPages = null;
        }

        if ( renderedPages !== null ) {
            rendered = buildRendered(
                renderedPages, footnoteData.pages, footnoteData.notes
            );
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
