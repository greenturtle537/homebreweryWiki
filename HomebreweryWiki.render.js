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
    var FRAME_ID = 'hbw-frame';
    var FRAME_CLASS = 'hbw-frame';
    var FALLBACK_ID = 'hbw-brew-text';
    var PAGES_CLASS = 'pages';
    var BREW_RENDERER_CLASS = 'brewRenderer';
    var PAGE_CLASS = 'page';
    var COLUMN_WRAPPER_CLASS = 'columnWrapper';
    var PAGE_NUMBER_CLASS = 'pageNumber';
    var FOOTNOTE_REF_CLASS = 'hbw-footnote-ref';
    var FOOTNOTE_NOTES_CLASS = 'hbw-footnotes';
    var FOOTNOTE_LIST_CLASS = 'hbw-footnotes-list';
    var FOOTNOTE_ITEM_CLASS = 'hbw-footnote';
    var FOOTNOTE_BACK_CLASS = 'hbw-footnote-back';

    /**
     * Overflow signal (E4B1). The attribute carries the pages that overran
     * and, on a `.page`, the number of columns its content wanted.
     *
     * @type {string}
     */
    var OVERFLOW_ATTR = 'data-hbw-overflow';
    var OVERFLOW_NOTICE_CLASS = 'hbw-overflow-notice';
    /** Sub-pixel slack before content counts as past the page edge. */
    var OVERFLOW_SLACK = 1;

    /**
     * Page style from a leading fence (E4B6).
     *
     * Upstream keeps a brew's stylesheet apart from its markdown, so authors
     * ship it as a leading ` ```css ` fence (the demo does exactly that). The
     * fence is data for the page, not content: it is lifted out before the
     * markdown is rendered and applied to the frame document only.
     *
     * @type {string}
     */
    var STYLE_ATTR = 'data-hbw-style';
    var STYLE_ELEMENT_CLASS = 'hbw-page-style';
    /** Refuse an oversized block rather than paste it into the frame. */
    var STYLE_MAX_LENGTH = 32768;
    /**
     * Leading fence whose info string is `css`, per CommonMark: up to three
     * spaces of indentation, never a tab. A tab is four columns of code
     * indentation, so `\t ```css ` opens an indented code block and must stay
     * a code sample rather than becoming the page's stylesheet.
     */
    var STYLE_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*css[ \t]*$/i;
    var STYLE_FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

    /**
     * Sandbox for the render host (E3.5S6).
     *
     * `allow-same-origin` lets the parent write the sanitized brew DOM into
     * the frame; `allow-scripts` is deliberately absent, so no brew script can
     * execute even if sanitization were bypassed. Top navigation is limited to
     * a user activation so wiki links (`target="_top"`) still navigate the
     * parent, but the brew cannot navigate it on its own.
     *
     * @type {string}
     */
    var SANDBOX = 'allow-same-origin allow-top-navigation-by-user-activation';

    /** Letter page geometry from upstream Blank/style.less (E3.5S4). */
    var PAGE_WIDTH_MM = 215.9;
    var PAGE_HEIGHT_MM = 279.4;
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
     * Column marker on a line of its own.  Replaced with the upstream
     * `.columnSplit` element before rendering: the theme's CSS columns and
     * `break-after: always` do the column work inside one `.columnWrapper`
     * (E3.5; no `.hbw-column` blocks are created).
     *
     * @type {RegExp}
     */
    var COLUMN_MARKER = /^[ \t]*\\(?:column|columnbreak)(?:[ \t]*\{[^\n{}]*\})?[ \t]*$/;

    /**
     * Upstream's column-break element.
     *
     * @type {string}
     */
    var COLUMN_SPLIT_HTML = '<div class="columnSplit"></div>';

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
        // `ping` fires an outbound request on click, and `dynsrc` / `lowsrc`
        // are legacy media pointers that still load in some engines.
        FORBID_ATTR: [
            'srcdoc', 'formaction', 'poster', 'srcset', 'background',
            'ping', 'dynsrc', 'lowsrc'
        ],
        // Author data-* attributes carry no value for readers and are
        // stripped.  Footnote markers are recognised by their CSS class-name
        // instead, so no generated attribute has to survive sanitizing
        // (E3S3T3).
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
     * Resolve a URL written in a brew against the parent document.
     *
     * The sanitized DOM is injected into the same-origin shell iframe, whose
     * own URL is not the article URL, so a relative `href`/`src` keeps its
     * meaning only after it is made absolute here (E3.5S1).
     *
     * @param {string} value
     * @return {string}
     */
    function resolveParentUrl( value ) {
        var anchor = document.createElement( 'a' );
        anchor.href = value;
        return anchor.href;
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

            if ( node.nodeName && node.nodeName.toLowerCase() === 'a' ) {
                // Wiki links navigate the parent (E3.5S3T2); in-page anchors
                // scroll the brew itself, so they stay inside the frame.
                var href = node.getAttribute( 'href' ) || '';
                if ( href.charAt( 0 ) !== '#' && href !== '' ) {
                    node.setAttribute( 'href', resolveParentUrl( href ) );
                }
                node.setAttribute(
                    'target', href.charAt( 0 ) === '#' ? '_self' : '_top'
                );
                node.setAttribute( 'rel', 'noopener noreferrer' );
            }

            if ( node.nodeName && node.nodeName.toLowerCase() === 'img' ) {
                var src = node.getAttribute( 'src' );
                if ( src && !isAllowedImage( src ) ) {
                    node.removeAttribute( 'src' );
                    node.setAttribute( 'data-hbw-blocked', 'external' );
                    if ( !node.getAttribute( 'alt' ) ) {
                        node.setAttribute( 'alt', 'External image blocked' );
                    }
                } else if ( src && !/^data:/i.test( src ) ) {
                    // Same reason as anchors: a relative src would otherwise
                    // resolve against the shell iframe URL instead of the page.
                    node.setAttribute( 'src', resolveParentUrl( src ) );
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
     * Replace `\column` marker lines with upstream's `.columnSplit` element
     * (E3.5).  The theme's CSS columns and `break-after: always` do the column
     * work inside one `.columnWrapper`; the extension never builds
     * `.hbw-column` blocks.  Markers inside fenced code stay literal.
     *
     * @param {string} pageSource page source
     * @return {string} page source with column-split elements
     */
    function replaceColumnMarkers( pageSource ) {
        var walker = createProseWalker( pageSource );
        var out = [];
        var step;
        var line;
        var newline;

        while ( ( step = walker.next() ) !== null ) {
            newline = step.text.charAt( step.text.length - 1 ) === '\n' ? '\n' : '';
            line = newline ? step.text.substring( 0, step.text.length - 1 ) : step.text;
            if ( step.prose && COLUMN_MARKER.test( line ) ) {
                out.push( COLUMN_SPLIT_HTML + newline );
                continue;
            }
            out.push( step.text );
        }
        return out.join( '' );
    }

    /**
     * Create a stateful prose/code walker over one page source (E3S3 review).
     *
     * Each `next()` returns `{ prose: boolean, text: string }` in source
     * order: prose runs (split at inline backtick spans), fenced blocks, and
     * the code spans themselves.  Fences open on up-to-3-spaces plus 3+
     * backticks/tildes and close on a same-character run of at least the
     * opening length; unclosed fences run to the end of the page, and an
     * unmatched backtick leaves the rest of its line as prose.
     *
     * Indented code blocks (E4B4) are reported as code too.  A four-column
     * lead opens one only where the renderers themselves treat the lines as
     * code: at the start of the page, after a blank line, a heading, a rule
     * or a closing fence, and four columns past a list item's content indent
     * rather than a continuation of its paragraph.  Tabs advance to the next
     * four-column stop, so `   \t` reaches column four.  That keeps
     * extraction in step with the pinned renderer and `marked`, which both
     * emit `<pre><code>` for those shapes — the extension must not invent a
     * wider rule than they use.
     *
     * @param {string} pageSource page source
     * @return {Object} walker with a `next()` method
     */
    function createProseWalker( pageSource ) {
        var lines = String( pageSource ).split( '\n' );
        var index = 0;
        var fenceChar = null;
        var fenceLength = 0;
        var indentedCode = false;
        var indentedRequired = 4;
        // True at the start of the page and after a blank line, heading, rule
        // or closing fence: a position where an indented line opens a block.
        // A paragraph line clears it, because the next indented line is then
        // its lazy continuation rather than code.
        var blockBoundary = true;
        // Content indent of the enclosing list item, or null at top level.
        // Four columns past this is a code block inside the item; less is a
        // continuation of the item's paragraph.
        var listIndent = null;
        var LIST_ITEM = /^( {0,3})((?:[-*+]|\d{1,9}[.)]))([ \t]+|$)/;
        var ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
        var RULE_OR_SETEXT = /^ {0,3}(?:=+|-{3,})[ \t]*$/;

        function isBlank( line ) {
            return /^[ \t]*$/.test( line );
        }

        // Leading whitespace in columns: a tab advances to the next
        // four-column stop, so `   \t` reaches column four (E4B4 review).
        function indentColumns( line ) {
            var columns = 0;
            var i = 0;
            var ch;
            for ( ; i < line.length; i++ ) {
                ch = line.charAt( i );
                if ( ch === ' ' ) {
                    columns++;
                } else if ( ch === '\t' ) {
                    columns += 4 - ( columns % 4 );
                } else {
                    break;
                }
            }
            return columns;
        }

        // Where a list item's content starts (marker plus 1-4 spaces, or one
        // column when the marker has no following space).
        function listContentIndent( line ) {
            var match = LIST_ITEM.exec( line );
            var spaces;
            var column;

            if ( !match ) {
                return null;
            }
            column = match[ 1 ].length + match[ 2 ].length;
            spaces = match[ 3 ] || '';
            if ( spaces.charAt( 0 ) === '\t' ) {
                return column + ( 4 - ( column % 4 ) );
            }
            if ( !spaces || spaces.length > 4 ) {
                return column + 1;
            }
            return column + spaces.length;
        }

        function isFenceClose( line ) {
            return new RegExp(
                '^ {0,3}' + fenceChar + '{' + fenceLength + ',}[ \\t]*$'
            ).test( line );
        }

        function isFenceOpen( line ) {
            var found = /^ {0,3}(`{3,}|~{3,})/.exec( line );
            if ( found ) {
                fenceChar = found[ 1 ].charAt( 0 );
                fenceLength = found[ 1 ].length;
                return true;
            }
            return false;
        }

        return {
            next: function () {
                var line;
                var text;
                var itemIndent;
                if ( index >= lines.length ) {
                    return null;
                }
                line = lines[ index ];
                index++;
                text = line + ( index < lines.length ? '\n' : '' );

                if ( fenceChar !== null ) {
                    if ( isFenceClose( line ) ) {
                        fenceChar = null;
                        fenceLength = 0;
                        blockBoundary = true;
                    }
                    return { prose: false, text: text };
                }
                if ( isFenceOpen( line ) ) {
                    indentedCode = false;
                    blockBoundary = false;
                    listIndent = null;
                    return { prose: false, text: text };
                }

                // Inside an indented block: blanks and further indented lines
                // belong to it.  The first shallower, non-blank line ends it
                // and is classified normally below.
                if ( indentedCode ) {
                    if ( isBlank( line ) ) {
                        blockBoundary = true;
                        return { prose: false, text: text };
                    }
                    if ( indentColumns( line ) >= indentedRequired ) {
                        return { prose: false, text: text };
                    }
                    indentedCode = false;
                }

                // An indented block opens only where the renderers open one:
                // four columns at the top level, or four past the enclosing
                // list item's content, and never as a lazy paragraph
                // continuation (E4B4 review).
                if ( blockBoundary && !isBlank( line ) ) {
                    indentedRequired = listIndent === null ? 4 : listIndent + 4;
                    if ( indentColumns( line ) >= indentedRequired ) {
                        indentedCode = true;
                        blockBoundary = false;
                        return { prose: false, text: text };
                    }
                }

                if ( isBlank( line ) ) {
                    blockBoundary = true;
                    return { prose: true, text: text };
                }

                // A line indented at or past the item's content indent
                // continues that item, so it stays open and the code
                // threshold stays relative to it; anything shallower ends
                // the item and returns to the top-level threshold.
                itemIndent = listContentIndent( line );
                if ( itemIndent !== null ) {
                    listIndent = itemIndent;
                } else if ( listIndent === null ||
                        indentColumns( line ) < listIndent ) {
                    listIndent = null;
                }
                blockBoundary = ATX_HEADING.test( line ) ||
                    RULE_OR_SETEXT.test( line );
                return { prose: true, text: text };
            }
        };
    }

    /**
     * Wiki token: `[[Page]]`, `[[Page|label]]`, `[[Category:Name]]`,
     * `[[File:Name.png|alt|caption|size]]` (D8 / E3.5S3T1).
     *
     * @type {RegExp}
     */
    var WIKI_TOKEN = /\[\[([^\[\]|]+)((?:\|[^\[\]]*)*)\]\]/g;

    /**
     * MediaWiki file options that are never alt text (E3.5S3T3).
     *
     * @type {RegExp}
     */
    var MEDIA_OPTION = /^(?:thumb|thumbnail|frame|frameless|border|left|right|center|centre|upright|baseline|sub|super|top|text-top|middle|bottom|text-bottom)$/i;

    /**
     * Escape text for insertion into generated HTML.
     *
     * @param {string} value
     * @return {string}
     */
    function escapeHtml( value ) {
        return String( value )
            .replace( /&/g, '&amp;' )
            .replace( /</g, '&lt;' )
            .replace( />/g, '&gt;' )
            .replace( /"/g, '&quot;' );
    }

    /**
     * Split a token's `|arg|arg` tail into arguments.
     *
     * @param {string} rest
     * @return {Array.<string>}
     */
    function wikiArgs( rest ) {
        var parts = String( rest || '' ).split( '|' );
        parts.shift();
        return parts;
    }

    /**
     * Build the HTML for one wiki token (E3.5S3T1/T2/T3).
     *
     * Categories produce no content (they register server-side); files resolve
     * through the server-supplied map, with a visible placeholder when the
     * upload does not exist; everything else becomes a wiki link that
     * navigates the parent (`target="_top"`).
     *
     * @param {string} target Token target (before the first `|`).
     * @param {Array.<string>} args Token arguments.
     * @param {Object} config `{ base: string, files: Object, links: Object }`.
     * @return {string} Replacement HTML, or the token when unrecognised.
     */
    function wikiTokenHtml( target, args, config ) {
        var lower = target.toLowerCase();
        var name;
        var info;
        var alt;
        var size;
        var src;
        var key;
        var exists;
        var page;
        var anchor;
        var hash;
        var i;

        if ( lower.indexOf( 'category:' ) === 0 ) {
            return '';
        }

        if ( lower.indexOf( 'file:' ) === 0 ) {
            // The server trims the name before building its map; do the same
            // so `[[File: Name.png ]]` still resolves. Own-property lookup
            // keeps prototype members from being treated as uploads.
            name = target.substring( 5 ).replace( /^\s+|\s+$/g, '' );
            info = Object.prototype.hasOwnProperty.call( config.files || {}, name )
                ? config.files[ name ]
                : null;
            // `alt` is the first argument that is neither a size nor a
            // MediaWiki option; `thumb`/`200px` must never be read aloud.
            alt = name;
            for ( i = 0; i < args.length; i++ ) {
                if ( !args[ i ] || /^\d+(px)?$/.test( args[ i ] ) ||
                    MEDIA_OPTION.test( args[ i ] ) ) {
                    continue;
                }
                alt = args[ i ];
                break;
            }
            size = '';
            for ( i = 0; i < args.length; i++ ) {
                if ( /^\d+(px)?$/.test( args[ i ] ) ) {
                    size = args[ i ];
                }
            }
            if ( info && info.exists && info.url ) {
                src = escapeHtml( info.url );
                return '<img src="' + src + '" alt="' + escapeHtml( alt ) + '"' +
                    ( size ? ' style="width: ' + escapeHtml( size ) + '; height: auto"' : '' ) +
                    '>';
            }
            // E4B9: neutralise `://` in the visible text so the markdown
            // autolinker cannot turn the placeholder into an outbound anchor.
            // The title attribute keeps the raw name; attributes are not
            // autolinked.  `&#58;` decodes to a colon in the browser, so the
            // reader still sees the URL.
            return '<span class="hbw-missing-file" title="Missing file: ' +
                escapeHtml( name ) + '">[File: ' +
                escapeHtml( name ).replace( /:\/\//g, '&#58;//' ) + ']</span>';
        }

        if ( !config.base ) {
            return '[[' + target + ( args.length ? '|' + args.join( '|' ) : '' ) + ']]';
        }
        // E4B5: the first `#` separates the page title from the anchor.
        // Percent-encoding it into the title parameter produces a link to a
        // page literally named "Page#Section", and the browser never scrolls
        // to the section, so the two parts are encoded separately.  The page
        // part is trimmed here because brewLinkMap() trims on the server;
        // `[[Missing #Part]]` must key `Missing`, not `Missing_`, so the
        // red-link styling survives.
        anchor = '';
        hash = target.indexOf( '#' );
        page = ( ( hash === -1 ) ? target : target.substring( 0, hash ) )
            .replace( /^\s+|\s+$/g, '' );
        if ( hash !== -1 ) {
            anchor = target.substring( hash + 1 ).replace( /^\s+|\s+$/g, '' );
        }
        // E4S1T3: the parent resolves each target's existence (the iframe
        // runs no scripts and cannot query the wiki).  Only a target the
        // parent positively reports as absent becomes a red link; an unknown
        // target keeps the plain link rather than inventing a red one.
        key = page.replace( /\s+/g, '_' );
        // A bare `#Section` is a same-page link: it stays inside the iframe,
        // where `hardenTree` forces `target="_self"`.
        if ( !key ) {
            return '<a href="#' + escapeHtml( encodeURIComponent(
                anchor.replace( /\s+/g, '_' )
            ) ) + '">' +
                escapeHtml( args.length && args[ 0 ] ? args[ 0 ] : target ) + '</a>';
        }
        exists = config.links && Object.prototype.hasOwnProperty.call(
            config.links, key
        ) ? config.links[ key ] : null;
        return '<a href="' + escapeHtml(
            config.base + encodeURIComponent( key ) +
            ( anchor ? '#' + encodeURIComponent( anchor.replace( /\s+/g, '_' ) ) : '' )
        ) +
            '" target="_top" rel="noopener noreferrer"' +
            ( exists === false ? ' class="new"' : '' ) + '>' +
            escapeHtml( args.length && args[ 0 ] ? args[ 0 ] : target ) + '</a>';
    }

    /**
     * Rewrite wiki tokens in one page source (E3.5S3T1). Prose lines only:
     * fenced code and inline code keep their literal `[[...]]` text.
     *
     * @param {string} pageSource
     * @param {Object} config `{ base: string, files: Object }`.
     * @return {string}
     */
    function applyWikiTokens( pageSource, config ) {
        var walker = createProseWalker( pageSource );
        var out = [];
        var step;
        var line;
        var newline;
        var masked;
        var replaced;
        var last;
        var match;

        while ( ( step = walker.next() ) !== null ) {
            newline = step.text.charAt( step.text.length - 1 ) === '\n' ? '\n' : '';
            line = newline ? step.text.substring( 0, step.text.length - 1 ) : step.text;
            if ( !step.prose ) {
                out.push( step.text );
                continue;
            }

            // Inline code spans are masked with NULs (same length), so a token
            // written inside backticks is never rewritten, while offsets still
            // point at the original line (E3B1 rule, applied to wiki tokens).
            masked = maskInlineCode( line );
            replaced = '';
            last = 0;
            WIKI_TOKEN.lastIndex = 0;
            while ( ( match = WIKI_TOKEN.exec( masked ) ) !== null ) {
                replaced += line.substring( last, match.index );
                replaced += wikiTokenHtml(
                    match[ 1 ].replace( /^\s+|\s+$/g, '' ),
                    wikiArgs( match[ 2 ] ),
                    config
                );
                last = match.index + match[ 0 ].length;
            }
            replaced += line.substring( last );
            out.push( replaced + newline );
        }
        return out.join( '' );
    }

    /**
     * Footnote reference (`[^label]`) inside source text.
     *
     * Matches the literal text form only: once a reference has been swapped
     * for a marker span the brackets are gone, so a global scan can never
     * match its own output (which would loop forever).
     *
     * @type {RegExp}
     */
    var FOOTNOTE_REF = /\[\^([^\]\s<>]+)\]/g;

    /**
     * Footnote definition line (`[^label]: note text`), the definition's
     * first line.  Continuation lines belong to the definition below.
     *
     * @type {RegExp}
     */
    var FOOTNOTE_DEF_LINE = /^[ \t]*\[\^([^\]\s]+)\][ \t]*:[ \t]*(.*)$/;

    /**
     * Blank out inline code spans so they cannot look like footnote syntax.
     *
     * The replacement keeps one character per source character, so match
     * offsets stay valid against the unmasked line; only the characters
     * between a pair of backticks are replaced.  The closing run must be the
     * same length as the opening run, so `` ``a `b` `` `` is one span and
     * every span on a line is masked, not just the first.  An unmatched
     * backtick is ordinary prose, matching the walker's rule.
     *
     * @param {string} line source line
     * @return {string} line with code spans masked by NUL characters
     */
    function maskInlineCode( line ) {
        var text = String( line );
        var chars = text.split( '' );
        var i = 0;
        var open;
        var close;
        var run;
        var j;
        var k;
        var c;

        while ( i < text.length ) {
            if ( text.charAt( i ) !== '`' ) {
                i++;
                continue;
            }
            open = i;
            while ( i < text.length && text.charAt( i ) === '`' ) {
                i++;
            }
            run = i - open;

            // CommonMark matches the closing run by length: a one-backtick
            // opener is not closed by two backticks, and vice versa.
            close = -1;
            j = i;
            while ( j < text.length ) {
                if ( text.charAt( j ) !== '`' ) {
                    j++;
                    continue;
                }
                k = j;
                while ( k < text.length && text.charAt( k ) === '`' ) {
                    k++;
                }
                if ( k - j === run ) {
                    close = k;
                    break;
                }
                j = k;
            }
            if ( close === -1 ) {
                // Unmatched opener: ordinary prose; keep scanning after it.
                continue;
            }
            for ( c = open; c < close; c++ ) {
                chars[ c ] = '\u0000';
            }
            i = close;
        }
        return chars.join( '' );
    }

    /**
     * Defined footnote references in one prose line, outside inline code.
     *
     * @param {string} line prose line (fences never reach here)
     * @param {Object.<string, string>} notes footnote bodies by label
     * @return {Array.<Object>} `{ index, length, label }` in source order
     */
    function findFootnoteRefs( line, notes ) {
        var masked = maskInlineCode( line );
        var found = [];
        var match;
        FOOTNOTE_REF.lastIndex = 0;
        while ( ( match = FOOTNOTE_REF.exec( masked ) ) !== null ) {
            if ( notes.hasOwnProperty( match[ 1 ] ) ) {
                found.push( {
                    index: match.index,
                    length: match[ 0 ].length,
                    label: match[ 1 ]
                } );
            }
        }
        return found;
    }

    /**
     * Strip footnote definitions from every page source (E3S3T3 / E3B1).
     *
     * Definitions live brew-wide: a definition on any page resolves
     * references on any page, matching how readers follow a brew.  Definition
     * lines and their indented continuations are removed up front because
     * the pinned renderer would otherwise rewrite `[^label]` text into its
     * own superscript spans before this extension ever sees them.  Bodies
     * stay verbatim so bold, links and tables still apply inside the notes.
     *
     * One pass over the prose walker: fenced blocks never reach the scanner,
     * inline code is masked per line, so no code sample can donate a note
     * body or have its `[^label]` stripped (E3B1).
     *
     * @param {Array.<string>} pages page sources
     * @return {{ pages: Array.<string>, notes: Object.<string, string> }}
     */
    function extractFootnotes( pages ) {
        var notes = {};
        var cleaned = [];
        var kept;
        var walker;
        var step;
        var line;
        var masked;
        var match;
        var offset;
        var openMatch;
        var current;
        var noteFence;
        var fenceChar;
        var fenceLength;
        var p;

        for ( p = 0; p < pages.length; p++ ) {
            kept = [];
            current = null;
            noteFence = false;
            fenceChar = null;
            fenceLength = 0;
            walker = createProseWalker( pages[ p ] );

            while ( ( step = walker.next() ) !== null ) {
                if ( !step.prose ) {
                    line = step.text.replace( /\n$/, '' );

                    if ( fenceChar === null ) {
                        // A non-prose line here either opens a fence or belongs
                        // to an indented code block (E4B4).
                        openMatch = /^ {0,3}(`{3,}|~{3,})/.exec( line );
                        if ( openMatch ) {
                            fenceChar = openMatch[ 1 ].charAt( 0 );
                            fenceLength = openMatch[ 1 ].length;
                            if ( current !== null && /^[ \t]/.test( line ) ) {
                                // Only an indented fence is a lazy
                                // continuation of the note and belongs to it
                                // (E3B1 follow-up).  An unindented fence is
                                // not: it closes the note, as in CommonMark.
                                noteFence = true;
                                notes[ current ] += '\n' + line;
                                continue;
                            }
                            current = null;
                            noteFence = false;
                        }
                        // An indented code block is a block: it ends any open
                        // definition and stays in the page content (E4B4).
                        current = null;
                        noteFence = false;
                        kept.push( step.text );
                        continue;
                    }

                    if ( new RegExp( '^ {0,3}' + fenceChar +
                            '{' + fenceLength + ',}[ \\t]*$' ).test( line ) ) {
                        // Closing fence: hand it to the note when the fence
                        // opened inside it, otherwise it is page content.
                        fenceChar = null;
                        fenceLength = 0;
                        if ( current !== null && noteFence ) {
                            notes[ current ] += '\n' + line;
                            noteFence = false;
                            continue;
                        }
                        current = null;
                        noteFence = false;
                        kept.push( step.text );
                        continue;
                    }

                    // Interior fence line.
                    if ( current !== null && noteFence ) {
                        notes[ current ] += '\n' + line;
                        continue;
                    }
                    current = null;
                    noteFence = false;
                    kept.push( step.text );
                    continue;
                }

                line = step.text.replace( /\n$/, '' );
                masked = maskInlineCode( line );

                if ( current !== null && /^[ \t]/.test( line ) ) {
                    notes[ current ] += '\n' + line;
                    continue;
                }
                if ( current !== null && line === '' ) {
                    // Trailing blanks are harmless inside a note body; a
                    // following block line closes the definition below.
                    notes[ current ] += '\n';
                    continue;
                }
                current = null;
                noteFence = false;

                match = FOOTNOTE_DEF_LINE.exec( masked );
                if ( match ) {
                    current = match[ 1 ];
                    offset = match.index + match[ 0 ].length - match[ 2 ].length;
                    notes[ current ] = line.substring( offset );
                    continue;
                }
                kept.push( step.text );
            }
            cleaned.push( kept.join( '' ) );
        }

        return { pages: cleaned, notes: notes };
    }

    /**
     * Normalise a same-page anchor candidate for matching, ignoring the
     * cosmetic separators the renderers slug differently (spaces, `_`, `-`
     * and surrounding punctuation).  Lowercase; runs collapse to one `-`.
     *
     * @param {string} text heading text, heading id, or fragment
     * @return {string}
     */
    function anchorKey( text ) {
        return String( text )
            .toLowerCase()
            .replace( /^[\s_\-]+|[\s_\-]+$/g, '' )
            .replace( /[\s_\-]+/g, '-' );
    }

    /**
     * E4B5 review fix: a bare `[[#Section]]` (or a `[text](#section)` link)
     * is same-page, so its href must point at the anchor the ACTIVE
     * renderer just emitted.  Wiki tokens are applied *before* the markdown
     * render (see renderPages), so the anchored heading's id does not exist
     * when the token becomes an `<a>`; predicting it in advance would mean
     * replicating two materially different sluggers (the pinned
     * Homebrewery renderer builds unicode-aware ids like `caffè--cream`
     * with `-N` dedupe suffixes, while the marked 0.3.19 fallback emits
     * ASCII-only `caff-cream-` with none).  Instead the rendered page is
     * resolved in one pass against its own headings: the fragment matches
     * the first heading by text (falling back to an explicit id match) and
     * the href is rewritten to that heading's real id.  A fragment with no
     * matching heading is left alone — a dead anchor is the author's
     * problem, not a rewrite problem.
     *
     * @param {string} html sanitized rendered page HTML
     * @return {string}
     */
    function resolveSamePageAnchors( html ) {
        var box = document.createElement( 'div' );
        var headings;
        // Prototype-less maps: a fragment such as `[[#constructor]]` or
        // `[[#__proto__]]` must never hit an inherited Object property.
        var exactIds = Object.create( null );
        var keys = Object.create( null );
        var headingIds = Object.create( null );
        var anchors;
        var resolved;
        var key;
        var fragment;
        var i;

        box.innerHTML = html;
        anchors = box.querySelectorAll( 'a[href^="#"]' );
        if ( !anchors.length ) {
            return html;
        }
        headings = box.querySelectorAll( 'h1, h2, h3, h4, h5, h6' );
        for ( i = 0; i < headings.length; i++ ) {
            if ( !headings[ i ].id ) {
                continue;
            }
            // An emitted id always wins over a normalized key: a page may
            // carry both `target-section` and `target_section`, and the
            // fragment that names the second exactly must reach it.
            if ( !( headings[ i ].id in exactIds ) ) {
                exactIds[ headings[ i ].id ] = headings[ i ].id;
            }
            key = anchorKey( headings[ i ].textContent );
            if ( key && !( key in keys ) ) {
                keys[ key ] = headings[ i ].id;
            }
            key = anchorKey( headings[ i ].id );
            if ( key && !( key in headingIds ) ) {
                headingIds[ key ] = headings[ i ].id;
            }
        }
        for ( i = 0; i < anchors.length; i++ ) {
            try {
                // The emitter percent-encodes the fragment; the heading ids
                // are plain.  Decode so both sides compare equal.
                fragment = decodeURIComponent( anchors[ i ].getAttribute( 'href' ).substring( 1 ) );
            } catch ( e ) {
                fragment = anchors[ i ].getAttribute( 'href' ).substring( 1 );
            }
            if ( fragment in exactIds ) {
                resolved = exactIds[ fragment ];
            } else {
                key = anchorKey( fragment );
                resolved = ( key && ( keys[ key ] || headingIds[ key ] ) ) || '';
            }
            if ( resolved ) {
                anchors[ i ].setAttribute( 'href', '#' + resolved );
            }
        }
        return box.innerHTML;
    }

    /**
     * Render pages to sanitized HTML (E3S1 + E3S2T1 + E3.5).
     *
     * A page is rendered in a single call so the pinned renderer's per-page
     * state (variable definitions, heading ids) spans both CSS columns.
     * Column breaks arrive as upstream `.columnSplit` elements.  Footnote
     * markers that landed inside fenced code are restored to source text
     * after sanitizing (E3S3 review).  Same-page anchors are resolved
     * against the page's rendered headings (E4B5 review).
     *
     * @param {Array.<string>} pages page sources
     * @param {Object.<string, string>} footnoteNotes footnote bodies by label
     * @return {Array.<string>|null} sanitized page HTML in document order
     */
    function renderPages( pages, footnoteNotes, wikiConfig ) {
        var renderedPages = [];
        var pageMarked;
        var html;
        var p;

        for ( p = 0; p < pages.length; p++ ) {
            pageMarked = replaceColumnMarkers(
                markFootnoteRefs(
                    applyWikiTokens( pages[ p ], wikiConfig ),
                    footnoteNotes
                )
            );
            html = renderMarkdown( pageMarked, p );
            if ( html === null ) {
                return null;
            }
            renderedPages.push( resolveSamePageAnchors( html ) );
        }

        return renderedPages;
    }

    /**
     * Footnote reference marker: `<span class="hbw-footnote-mark"
     * data-hbw-footnote="label">` with no content.  The span survives the
     * pinned renderer untouched in prose (although DOMPurify drops the
     * attribute), so references are resolved by walking the source
     * references and the rendered marker spans side by side in document
     * order.  Inside fenced or inline code the renderer escapes the span to
     * text, which the restore pass below turns back into the source.
     *
     * @type {RegExp}
     */
    var FOOTNOTE_MARKER = /<span class="hbw-footnote-mark"[^>]*><\/span>/g;

    /**
     * Replace defined footnote references in one page source with empty
     * marker spans (E3S3T3).  Only references with a matching definition
     * become markers; anything without one (including `[^nope]`) stays
     * verbatim so readers see the source text instead of a broken link.
     * Fenced code blocks and inline code spans are never marked: the prose
     * walker skips them, so `[^demo]` inside a fence or backticks reaches
     * the renderer untouched (E3B1).
     *
     * @param {string} pageSource page source
     * @param {Object.<string, string>} notes footnote bodies by label
     * @return {string} page source with markers
     */
    function markFootnoteRefs( pageSource, notes ) {
        var walker = createProseWalker( pageSource );
        var marked = [];
        var step;
        var refs;
        var text;
        var ordinal = 0;
        var i;

        while ( ( step = walker.next() ) !== null ) {
            if ( !step.prose ) {
                marked.push( step.text );
                continue;
            }
            refs = findFootnoteRefs( step.text, notes );
            text = step.text;
            for ( i = refs.length - 1; i >= 0; i-- ) {
                // The ordinal is the reference's position in the prose
                // stream, carried into the rendered DOM so pairing still
                // works when the renderer destroys a marker (an indented
                // code line is escaped into <pre><code> text).
                text = text.substring( 0, refs[ i ].index ) +
                    '<span class="hbw-footnote-mark hbw-fm-' +
                    ( ordinal + i ) + '"></span>' +
                    text.substring( refs[ i ].index + refs[ i ].length );
            }
            ordinal += refs.length;
            marked.push( text );
        }

        return marked.join( '' );
    }

    /**
     * Ordered defined references that live in prose, ignoring code (E3B1).
     *
     * `markFootnoteRefs` replaces exactly these references with markers, so
     * this list pairs one-to-one with the rendered markers.  Code that
     * happens to contain `[^label]` neither becomes a marker nor consumes a
     * position here.
     *
     * @param {string} pageSource page source
     * @param {Object.<string, string>} notes footnote bodies by label
     * @return {Array.<string>} labels in document order
     */
    function collectProseFootnoteRefs( pageSource, notes ) {
        var walker = createProseWalker( pageSource );
        var labels = [];
        var step;
        var refs;
        var i;

        while ( ( step = walker.next() ) !== null ) {
            if ( !step.prose ) {
                continue;
            }
            refs = findFootnoteRefs( step.text, notes );
            for ( i = 0; i < refs.length; i++ ) {
                labels.push( refs[ i ].label );
            }
        }
        return labels;
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
     * @param {number} pageIndex zero-based page index; note and reference
     *                          ids are scoped to the page so identical labels
     *                          on different pages stay document-unique
     * @param {Object} wikiConfig `{ base: string, files: Object }` used to
     *                            expand wiki tokens in note bodies
     * @return {void}
     */
    function linkFootnotes( pageSource, pageNode, notes, pageIndex, wikiConfig ) {
        var doc = pageNode.ownerDocument || document;
        var pageNumber = pageIndex + 1;
        var order = [];
        var seen = {};
        var notesNode;
        var listNode;
        var itemNode;
        var backLink;
        var refLink;
        var refIdUsed = {};
        var markers;
        var labels;
        var marker;
        var label;
        var ordinal;
        var i;
        var marked;

        // Defined references in prose only (E3B1): code refs never became
        // markers, so they must not take a pairing slot.
        labels = collectProseFootnoteRefs( pageSource, notes );

        for ( i = 0; i < labels.length; i++ ) {
            if ( seen[ labels[ i ] ] ) {
                continue;
            }
            seen[ labels[ i ] ] = true;
            order.push( labels[ i ] );
        }

        // Marker spans keep no attribute through sanitizing; they are
        // recognised by class-name and paired with the prose reference list
        // in document order.
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

        // Pair each marker with the prose reference that produced it,
        // by source ordinal rather than DOM position: a marker inside an
        // indented code line is escaped into <pre><code> text, so
        // positional pairing would hand every later marker the previous
        // label.  A marker without a usable ordinal is skipped, never
        // mis-linked (E3B1 follow-up).
        i = 0;
        while ( i < markers.length ) {
            marker = markers[ i ];
            i++;
            ordinal = /(?:^| )hbw-fm-(\d+)(?: |$)/.exec( marker.className );
            if ( !ordinal || !labels.hasOwnProperty( ordinal[ 1 ] ) ) {
                continue;
            }
            label = labels[ ordinal[ 1 ] ];
            refLink = doc.createElement( 'a' );
            refLink.setAttribute( 'href', '#hbw-fn-' + pageNumber + '-' + encodeURIComponent( label ) );
            // No selector lookup: encoded labels can carry `.`, `(`, `)`
            // and friends, which throw inside querySelector.  The first
            // reference for a label on this page keeps the id.
            if ( !Object.prototype.hasOwnProperty.call( refIdUsed, label ) ) {
                refIdUsed[ label ] = true;
                refLink.setAttribute( 'id', 'hbw-fnref-' + pageNumber + '-' + encodeURIComponent( label ) );
            }
            refLink.className = FOOTNOTE_REF_CLASS;
            refLink.appendChild( doc.createTextNode( '[' + label + ']' ) );
            marker.parentNode.replaceChild( refLink, marker );
        }

        if ( !order.length ) {
            return;
        }

        notesNode = doc.createElement( 'div' );
        notesNode.className = FOOTNOTE_NOTES_CLASS;
        listNode = doc.createElement( 'ol' );
        listNode.className = FOOTNOTE_LIST_CLASS;
        notesNode.appendChild( listNode );

        for ( i = 0; i < order.length; i++ ) {
            label = order[ i ];
            itemNode = doc.createElement( 'li' );
            itemNode.setAttribute( 'id', 'hbw-fn-' + pageNumber + '-' + encodeURIComponent( label ) );
            itemNode.className = FOOTNOTE_ITEM_CLASS;
            // Note bodies are prose too: expand wiki tokens before rendering
            // so the footnote agrees with the link tables the save hook wrote.
            itemNode.innerHTML = renderMarkdown(
                applyWikiTokens( notes[ label ], wikiConfig ), 0
            ) || '';
            backLink = doc.createElement( 'a' );
            backLink.setAttribute( 'href', '#hbw-fnref-' + pageNumber + '-' + encodeURIComponent( label ) );
            backLink.className = FOOTNOTE_BACK_CLASS;
            backLink.setAttribute( 'aria-label', 'Back to reference' );
            backLink.appendChild( doc.createTextNode( '\u21A9' ) );
            itemNode.appendChild( doc.createTextNode( ' ' ) );
            itemNode.appendChild( backLink );
            listNode.appendChild( itemNode );
        }

        pageNode.appendChild( notesNode );
    }

    /**
     * Seed the iframe document with the upstream page DOM (E3.5S1).
     *
     * The shell is a static same-origin document. Every node is created with
     * that document's factory and only sanitized page HTML is assigned, so no
     * user HTML ever enters the parent document. Structure is upstream's:
     * `.brewRenderer > .pages > .page > .columnWrapper`.
     *
     * @param {Document} doc iframe document
     * @param {Array.<string>} renderedPages sanitized page HTML
     * @param {Array.<string>} pageSources page sources (footnote order)
     * @param {Object.<string,string>} notes footnote bodies by label
     * @param {Object} wikiConfig `{ base: string, files: Object }` for tokens
     * @return {HTMLElement} the `.pages` element
     */
    function buildPagesInto( doc, renderedPages, pageSources, notes, wikiConfig ) {
        var body = doc.body;
        var rendererNode = doc.querySelector( '.' + BREW_RENDERER_CLASS );
        var pagesNode = rendererNode
            ? rendererNode.querySelector( '.' + PAGES_CLASS )
            : null;
        var pageNode;
        var wrapper;
        var numberNode;
        var p;

        if ( !rendererNode ) {
            rendererNode = doc.createElement( 'div' );
            rendererNode.className = BREW_RENDERER_CLASS;
            body.appendChild( rendererNode );
        }
        if ( !pagesNode ) {
            pagesNode = doc.createElement( 'div' );
            pagesNode.className = PAGES_CLASS;
            pagesNode.id = 'hbw-pages';
            rendererNode.appendChild( pagesNode );
        }

        // A preview can render more than once: start from an empty page set.
        while ( pagesNode.firstChild ) {
            pagesNode.removeChild( pagesNode.firstChild );
        }

        for ( p = 0; p < renderedPages.length; p++ ) {
            pageNode = doc.createElement( 'div' );
            pageNode.className = PAGE_CLASS;
            pageNode.id = 'p' + ( p + 1 );
            pageNode.setAttribute( 'data-index', String( p ) );

            wrapper = doc.createElement( 'div' );
            wrapper.className = COLUMN_WRAPPER_CLASS;
            wrapper.innerHTML = renderedPages[ p ];
            pageNode.appendChild( wrapper );

            linkFootnotes( pageSources[ p ], pageNode, notes, p, wikiConfig );

            // Upstream page number: `.pageNumber.auto` uses the theme's CSS
            // counter, so no number is hard-coded here (E3.5S4 / E3S3T2).
            numberNode = doc.createElement( 'div' );
            numberNode.className = PAGE_NUMBER_CLASS + ' auto';
            pageNode.appendChild( numberNode );

            pagesNode.appendChild( pageNode );
        }

        return pagesNode;
    }

    /**
     * Millimetres to CSS pixels, measured in the parent document so the result
     * matches the browser's own mm unit. Falls back to the CSS definition of
     * 96 px per inch when layout is unavailable (jsdom).
     *
     * @param {number} mm
     * @return {number} pixels
     */
    function mmToPx( mm ) {
        var probe = document.createElement( 'div' );
        var px;
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.width = mm + 'mm';
        document.body.appendChild( probe );
        px = probe.getBoundingClientRect
            ? probe.getBoundingClientRect().width
            : 0;
        document.body.removeChild( probe );
        return px || ( mm * 96 / 25.4 );
    }

    /**
     * Add the theme stylesheet to the iframe document (E3.5S2). The parent
     * writes the link because the iframe runs no scripts; the URL comes from
     * the host data attribute, so the build's asset base stays configurable.
     *
     * @param {Document} doc iframe document
     * @param {string} href configured theme CSS URL
     * @return {void}
     */
    function injectTheme( doc, href ) {
        var links;
        var link;
        var i;
        if ( !href ) {
            return;
        }
        links = doc.querySelectorAll( 'link[rel="stylesheet"]' );
        for ( i = 0; i < links.length; i++ ) {
            if ( links[ i ].getAttribute( 'href' ) === href ) {
                return;
            }
        }
        link = doc.createElement( 'link' );
        link.setAttribute( 'rel', 'stylesheet' );
        link.setAttribute( 'href', href );
        ( doc.head || doc.documentElement ).appendChild( link );
    }

    /**
     * Lift a leading ` ```css ` fence out of the brew source (E4B6).
     *
     * Only a fence that opens the brew counts: an author who puts CSS in the
     * middle of a page meant a code sample, and markdown says so too. An
     * unclosed fence stays in the source for the same reason — there is no
     * block to lift, and swallowing the rest of the brew would be worse.
     *
     * @param {string} text raw brew source
     * @return {{text: string, css: string}} source without the fence and its body
     */
    function extractPageStyle( text ) {
        var source = String( text );
        var lines = source.split( /\r\n|\r|\n/ );
        var open = -1;
        var close = -1;
        var marker;
        var fence;
        var rest;
        var i;

        for ( i = 0; i < lines.length; i++ ) {
            if ( !/^\s*$/.test( lines[ i ] ) ) {
                open = i;
                break;
            }
        }
        if ( open === -1 ) {
            return { text: source, css: '' };
        }
        marker = STYLE_FENCE_OPEN.exec( lines[ open ] );
        if ( !marker ) {
            return { text: source, css: '' };
        }
        fence = marker[ 1 ];
        for ( i = open + 1; i < lines.length; i++ ) {
            marker = STYLE_FENCE_CLOSE.exec( lines[ i ] );
            if ( marker && marker[ 1 ].charAt( 0 ) === fence.charAt( 0 ) &&
                marker[ 1 ].length >= fence.length ) {
                close = i;
                break;
            }
        }
        if ( close === -1 ) {
            return { text: source, css: '' };
        }
        rest = lines.slice( close + 1 );
        while ( rest.length && /^\s*$/.test( rest[ 0 ] ) ) {
            rest.shift();
        }
        return {
            text: rest.join( '\n' ),
            css: lines.slice( open + 1, close ).join( '\n' )
        };
    }

    /**
     * Decode CSS escapes to their literal characters (E4B6).
     *
     * `@\69mport` is `@import` to a CSS parser, so the forbidden constructs
     * have to be looked for after unescaping; otherwise a block is declared
     * applied while the browser still loads what it asked for. Hex escapes
     * are `\` + up to six hex digits + optional whitespace; any other
     * escaped character stands for itself.
     *
     * @param {string} css stylesheet text
     * @return {string} text with escapes resolved
     */
    function decodeCssEscapes( css ) {
        return String( css || '' )
            .replace( /\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/g, function ( match, hex ) {
                var code = parseInt( hex, 16 );
                if ( !( code > 0 && code <= 0xffff ) ) {
                    return '';
                }
                return String.fromCharCode( code );
            } )
            .replace( /\\(.)/g, '$1' );
    }

    /**
     * Decide whether a brew stylesheet may be applied (E4B6).
     *
     * The frame is a sandboxed, script-free document, and its CSP already
     * limits what CSS may load (`img-src 'self' data:`), so the CSS cannot
     * escape the page. What it must not do is pull a second stylesheet with
     * `@import`, or carry legacy script bindings; a block that tries is not
     * applied at all and the fence stays visible as code, which is the honest
     * failure for an author who wrote something the wiki will not run.
     *
     * @param {string} css fence body
     * @return {?string} CSS to apply, or null when the block is refused
     */
    function sanitizePageCss( css ) {
        var cleaned = String( css || '' );
        var decoded;

        if ( cleaned.length > STYLE_MAX_LENGTH ) {
            return null;
        }
        decoded = decodeCssEscapes( cleaned );
        if ( /<\/style/i.test( decoded ) ) {
            return null;
        }
        if ( /@import|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:/i.test( decoded ) ) {
            return null;
        }
        return /\S/.test( decoded ) ? cleaned : '';
    }

    /**
     * Write a brew's page style into the frame document (E4B6).
     *
     * The `<style>` sits in the frame, after the theme link, so the author's
     * rules win at equal specificity and nothing reaches the wiki page itself.
     * `textContent` is used deliberately: the fence body is CSS text, never
     * markup the browser may parse.
     *
     * @param {Document} doc frame document
     * @param {string} css sanitized stylesheet
     * @return {void}
     */
    function applyPageStyle( doc, css ) {
        var style;

        if ( !doc ) {
            return;
        }
        style = doc.querySelector( 'style.' + STYLE_ELEMENT_CLASS );
        if ( !css ) {
            if ( style && style.parentNode ) {
                style.parentNode.removeChild( style );
            }
            return;
        }
        if ( !style ) {
            style = doc.createElement( 'style' );
            style.className = STYLE_ELEMENT_CLASS;
            ( doc.head || doc.documentElement ).appendChild( style );
        }
        style.textContent = css;
    }

    /**
     * Columns a page's content occupies (E4B1).
     *
     * The theme fills columns with `column-fill: auto`, so content past the
     * last one is laid out into further columns and then clipped by
     * `.page { overflow: clip }`: neither lost nor reachable. `scrollWidth` of
     * the wrapper counts every column the content wants, which is what a
     * reader needs to be told about.
     *
     * @param {HTMLElement} wrapper `.columnWrapper` of one page
     * @return {number} columns the content wants; 0 when it fits
     */
    function usedColumns( wrapper ) {
        var view = wrapper.ownerDocument.defaultView || window;
        var client = wrapper.clientWidth;
        var scroll = wrapper.scrollWidth;
        var style = view.getComputedStyle ? view.getComputedStyle( wrapper ) : null;
        var count = style ? parseInt( style.columnCount, 10 ) : 0;
        var gap = style ? parseFloat( style.columnGap ) : 0;
        var column;
        var columns;

        if ( !client || !scroll || scroll <= client + OVERFLOW_SLACK ) {
            return 0;
        }
        // The theme asks for `column-count`, but a brew's own style may ask
        // for `column-width`; either way one used column is `client` wide.
        count = count > 0 ? count : 1;
        gap = isFinite( gap ) ? gap : 0;
        column = ( client - gap * ( count - 1 ) ) / count;
        if ( !( column > 0 ) ) {
            return 0;
        }
        columns = Math.round( ( scroll + gap ) / ( column + gap ) );
        return columns > count ? columns : count + 1;
    }

    /**
     * Show or clear the host-side overflow notice (E4B1).
     *
     * The notice lives in the wiki document, above the frame, not inside the
     * brew: it must not shift the page stack, because page geometry belongs to
     * the theme, and it must not appear in page screenshots or printed sheets.
     *
     * @param {HTMLElement} host wiki brew host
     * @param {string[]} parts one phrase per overfull page
     * @return {void}
     */
    function showOverflowNotice( host, parts ) {
        var notice = host.querySelector
            ? host.querySelector( '.' + OVERFLOW_NOTICE_CLASS )
            : null;
        var text;

        if ( !parts.length ) {
            if ( notice && notice.parentNode ) {
                notice.parentNode.removeChild( notice );
            }
            return;
        }
        if ( !notice ) {
            notice = document.createElement( 'div' );
            notice.className = OVERFLOW_NOTICE_CLASS;
            notice.setAttribute( 'role', 'status' );
        }
        while ( notice.firstChild ) {
            notice.removeChild( notice.firstChild );
        }
        text = 'This brew does not fit its pages: ' + parts.join( '; ' ) +
            '. Move the overrunning text onto another page with \\page.';
        notice.appendChild( document.createTextNode( text ) );
        if ( !notice.parentNode ) {
            host.insertBefore( notice, host.firstChild );
        }
    }

    /**
     * Flag pages whose content overruns the columns that fit (E4B1).
     *
     * The clipping itself stays: it is what upstream does, and re-flowing the
     * excess onto new pages would change page counts, anchors and numbering.
     * What changes is the silence. Each overfull `.page` gets
     * `data-hbw-overflow="<columns>"`; the `.pages` node and the wiki host get
     * the page numbers; a notice above the frame says it in words, because a
     * reader should not have to notice a glyph cut in half.
     *
     * @param {HTMLElement} pagesNode `.pages`
     * @param {HTMLElement} host wiki brew host
     * @return {void}
     */
    function markOverflow( pagesNode, host ) {
        var pages = pagesNode.children || [];
        var overfull = [];
        var parts = [];
        var page;
        var wrapper;
        var columns;
        var i;

        for ( i = 0; i < pages.length; i++ ) {
            page = pages[ i ];
            if ( !page.getAttribute || ( ' ' + ( page.className || '' ) + ' ' )
                .indexOf( ' ' + PAGE_CLASS + ' ' ) === -1 ) {
                continue;
            }
            wrapper = page.querySelector( '.' + COLUMN_WRAPPER_CLASS );
            columns = wrapper ? usedColumns( wrapper ) : 0;
            if ( columns ) {
                page.setAttribute( OVERFLOW_ATTR, String( columns ) );
                overfull.push( i + 1 );
                parts.push( 'page ' + ( i + 1 ) + ' needs ' + columns +
                    ' columns and is clipped at the page edge' );
            } else {
                page.removeAttribute( OVERFLOW_ATTR );
            }
        }

        if ( overfull.length ) {
            pagesNode.setAttribute( OVERFLOW_ATTR, overfull.join( ',' ) );
        } else {
            pagesNode.removeAttribute( OVERFLOW_ATTR );
        }

        if ( host && host.setAttribute ) {
            if ( overfull.length ) {
                host.setAttribute( OVERFLOW_ATTR, overfull.join( ',' ) );
            } else if ( host.removeAttribute ) {
                host.removeAttribute( OVERFLOW_ATTR );
            }
        }
        if ( host && host.querySelector ) {
            showOverflowNotice( host, parts );
        }
    }

    /**
     * Fit the page stack to the pane (E3.5S4T1/T2).
     *
     * Pages stay true letter size inside the iframe; the parent writes a
     * scale rule into the frame and sizes the frame from the scaled page
     * stack. The print route skips scaling so each page prints as a real
     * letter sheet.
     *
     * @param {HTMLElement} frame
     * @param {HTMLElement} pagesNode
     * @param {HTMLElement} host
     * @return {void}
     */
    function fitFrame( frame, pagesNode, host ) {
        var doc = pagesNode.ownerDocument;
        var pageWidth = mmToPx( PAGE_WIDTH_MM );
        var available = host.clientWidth || frame.clientWidth || pageWidth;
        var printMode = host.getAttribute( 'data-hbw-print' ) === '1';
        var scale = printMode ? 1 : Math.min( 1, available / pageWidth );
        var style = doc.getElementById( 'hbw-fit' );
        var css;
        var height;

        if ( !style ) {
            style = doc.createElement( 'style' );
            style.id = 'hbw-fit';
            ( doc.head || doc.documentElement ).appendChild( style );
        }
        while ( style.firstChild ) {
            style.removeChild( style.firstChild );
        }

        css = '.pages{width:' + pageWidth + 'px;' +
            'transform:scale(' + scale + ');transform-origin:top left;}';
        if ( printMode ) {
            css += '.page{margin:0;}';
        }
        style.appendChild( doc.createTextNode( css ) );

        height = Math.ceil(
            ( pagesNode.scrollHeight || pageWidth ) * scale
        );
        frame.style.width = printMode ? pageWidth + 'px' : '100%';
        frame.style.height = height + 'px';
        frame.setAttribute( 'data-hbw-scale', String( scale ) );

        // Column overflow is a layout fact, so it is measured on every refit:
        // the theme stylesheet and the fonts arrive after the first pass and
        // both change how much of the page the text occupies (E4B1).
        markOverflow( pagesNode, host );
    }

    /**
     * Keep the frame fitted on resize (E3.5S4T2): a ResizeObserver on the host
     * where available, a window resize listener otherwise. Font and image
     * loads also refit, because they change the page stack height.
     *
     * @param {HTMLElement} frame
     * @param {HTMLElement} pagesNode
     * @param {HTMLElement} host
     * @return {void}
     */
    function watchFrame( frame, pagesNode, host ) {
        var doc = pagesNode.ownerDocument;
        var images;
        var i;

        function refit() {
            fitFrame( frame, pagesNode, host );
        }

        refit();

        if ( window.ResizeObserver ) {
            try {
                frame.hbwObserver = new window.ResizeObserver( refit );
                frame.hbwObserver.observe( host );
                // The theme stylesheet and fonts arrive after injection; the
                // page stack height changes, so observe it as well.
                frame.hbwObserver.observe( pagesNode );
            } catch ( e ) {
                frame.hbwObserver = null;
            }
        }
        if ( !frame.hbwObserver && window.addEventListener ) {
            window.addEventListener( 'resize', refit, false );
        }
        if ( doc.fonts && doc.fonts.ready && doc.fonts.ready.then ) {
            doc.fonts.ready.then( refit );
        }
        // Late CSS/font application can change the stack without a resize.
        if ( window.setTimeout ) {
            window.setTimeout( refit, 100 );
            window.setTimeout( refit, 500 );
        }
        images = pagesNode.getElementsByTagName( 'img' );
        for ( i = 0; i < images.length; i++ ) {
            images[ i ].onload = refit;
        }
    }

    /**
     * Mark the wiki chrome around the brew host for print (E3.5S4T3/T4).
     *
     * The print route reuses the wiki document, so the skin chrome would keep
     * its layout space and add blank sheets. Every element that is not on the
     * host's ancestor path is tagged `.hbw-print-hide`, which the theme
     * removes from layout (`display: none`) under `@media print`.
     *
     * @param {HTMLElement} host brew host element.
     * @return {void}
     */
    function isolatePrintHost( host ) {
        var node = host;
        var parent;
        var kids;
        var i;
        var cls;
        while ( node && node.parentNode && node.parentNode.nodeType === 1 ) {
            parent = node.parentNode;
            kids = parent.childNodes;
            for ( i = 0; i < kids.length; i++ ) {
                if ( kids[ i ].nodeType !== 1 || kids[ i ] === node ) {
                    continue;
                }
                cls = kids[ i ].getAttribute( 'class' ) || '';
                kids[ i ].setAttribute(
                    'class', ( cls + ' hbw-print-hide' ).replace( /^\s+/, '' )
                );
            }
            node = parent;
        }
    }

    /**
     * Create the sandboxed same-origin render host (E3.5S1 / E3.5S6).
     *
     * @return {HTMLIFrameElement}
     */
    function createFrame() {
        var frame = document.createElement( 'iframe' );
        frame.id = FRAME_ID;
        frame.className = FRAME_CLASS;
        frame.setAttribute( 'title', 'Brew pages' );
        frame.setAttribute( 'sandbox', SANDBOX );
        frame.setAttribute( 'referrerpolicy', 'no-referrer' );
        frame.setAttribute( 'scrolling', 'no' );
        frame.setAttribute(
            'allow',
            "camera 'none'; microphone 'none'; geolocation 'none'; " +
            "payment 'none'; usb 'none'"
        );
        return frame;
    }

    /**
     * Plain-source fallback: never hide the reader's content when the renderer
     * or the frame fails.
     *
     * @param {HTMLElement} host
     * @param {string} text raw brew source
     * @return {void}
     */
    function showFallback( host, text ) {
        var rendered = document.createElement( 'pre' );
        var source = document.getElementById( SOURCE_ID );
        rendered.className = 'hbw-brew-text';
        rendered.id = FALLBACK_ID;
        rendered.appendChild( document.createTextNode( text ) );
        rendered.setAttribute( 'data-hbw-render', 'fallback' );
        host.appendChild( rendered );
        if ( source && source.parentNode ) {
            source.parentNode.removeChild( source );
        }
        host.setAttribute( 'data-hbw-render', 'fallback' );
    }

    /**
     * Build the visible pane content from the hidden source placeholder and
     * inject it into the iframe shell (E3.5S1).
     */
    function renderBrew() {
        var source = document.getElementById( SOURCE_ID );
        var host;
        var text;
        var shell;
        var theme;
        var wikiConfig;
        var frame;
        var done = false;
        var timer = null;

        if ( !source ) {
            // Not a brew view, or already rendered.
            return;
        }
        host = source.parentNode;
        if ( !host ) {
            return;
        }
        text = source.textContent || source.innerText || '';
        shell = host.getAttribute( 'data-hbw-shell' ) || '';
        theme = host.getAttribute( 'data-hbw-theme' ) || '';
        wikiConfig = {
            base: host.getAttribute( 'data-hbw-wiki-base' ) || '',
            files: {},
            links: {}
        };
        try {
            wikiConfig.files = JSON.parse(
                host.getAttribute( 'data-hbw-files' ) || '{}'
            ) || {};
        } catch ( e ) {
            wikiConfig.files = {};
        }
        try {
            wikiConfig.links = JSON.parse(
                host.getAttribute( 'data-hbw-links' ) || '{}'
            ) || {};
        } catch ( e ) {
            wikiConfig.links = {};
        }
        frame = createFrame();

        function fallback() {
            if ( done ) {
                return;
            }
            done = true;
            if ( timer !== null ) {
                clearTimeout( timer );
            }
            if ( frame.parentNode ) {
                frame.parentNode.removeChild( frame );
            }
            showFallback( host, text );
        }

        function finish() {
            var doc;
            var styleBlock;
            var pageCss;
            var styleState = '';
            var pageSources;
            var footnoteData;
            var renderedPages;
            var pagesNode;

            if ( done ) {
                return;
            }
            try {
                doc = frame.contentDocument ||
                    ( frame.contentWindow && frame.contentWindow.document );
            } catch ( e ) {
                doc = null;
            }
            if ( !doc || !doc.body ) {
                fallback();
                return;
            }

            activeRenderer = null;
            // A leading ````css` fence is the brew's stylesheet, not content (E4B6).
            styleBlock = extractPageStyle( text );
            pageCss = styleBlock.css ? sanitizePageCss( styleBlock.css ) : '';
            if ( pageCss === null ) {
                // Refused: keep the fence in the markdown so it stays visible.
                pageCss = '';
                styleBlock = { text: text, css: '' };
                styleState = 'refused';
            } else if ( pageCss ) {
                styleState = 'applied';
            }
            try {
                pageSources = splitPages( styleBlock.text );
                footnoteData = extractFootnotes( pageSources );
                renderedPages = renderPages(
                    footnoteData.pages, footnoteData.notes, wikiConfig
                );
            } catch ( e ) {
                renderedPages = null;
            }
            if ( renderedPages === null ) {
                fallback();
                return;
            }

            done = true;
            if ( timer !== null ) {
                clearTimeout( timer );
            }

            injectTheme( doc, theme );
            applyPageStyle( doc, pageCss );
            pagesNode = buildPagesInto(
                doc, renderedPages, footnoteData.pages, footnoteData.notes,
                wikiConfig
            );
            watchFrame( frame, pagesNode, host );

            host.setAttribute( 'data-hbw-render', 'html' );
            host.setAttribute( 'data-hbw-pages', String( renderedPages.length ) );
            if ( styleState ) {
                host.setAttribute( STYLE_ATTR, styleState );
            }
            if ( activeRenderer ) {
                host.setAttribute( 'data-hbw-renderer', activeRenderer );
            }
            if ( source.parentNode ) {
                source.parentNode.removeChild( source );
            }

            if ( host.getAttribute( 'data-hbw-print' ) === '1' ) {
                if ( document.body ) {
                    document.body.className = ( document.body.className + ' hbw-print-mode' )
                        .replace( /^\s+/, '' );
                }
                isolatePrintHost( host );
                // Give the theme fonts a moment, then print the sheet stack.
                setTimeout( function () {
                    if ( window.print ) {
                        window.print();
                    }
                }, 250 );
            }
        }

        try {
            host.appendChild( frame );
        } catch ( e ) {
            fallback();
            return;
        }

        if ( shell ) {
            frame.setAttribute( 'src', shell );
            if ( frame.addEventListener ) {
                frame.addEventListener( 'load', finish, false );
            } else if ( frame.attachEvent ) {
                frame.attachEvent( 'onload', finish );
            }
            // A shell that never loads must not leave the reader with a blank
            // pane: fall back to the plain source view.
            timer = setTimeout( function () {
                if ( !done ) {
                    fallback();
                }
            }, 10000 );
        } else {
            // Embedded/test path: an iframe without a src is about:blank and
            // already same-origin, so the document exists synchronously.
            finish();
        }
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
