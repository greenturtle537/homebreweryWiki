/**
 * HomebreweryWiki render module (E1S3).
 *
 * Replaces the E1S2 plain-text display with rendered, sanitized HTML.  The
 * server still emits the saved source into the hidden placeholder
 * (#hbw-source inside .hbw-brew) and loads the renderer scripts only on a brew
 * page view (see HomebreweryWiki.php / HomebreweryWiki.class.php).
 *
 * Load order (legacy addScriptFile, MW 1.14 has no ResourceLoader):
 *   1. vendor/marked-0.3.19.min.js   markdown -> HTML
 *   2. vendor/dompurify-2.5.8.min.js  HTML sanitizer (D7)
 *   3. this file                     render + inject into the pane
 *
 * Sanitization baseline (DESIGN.md D7 / SECURITY-REVIEW.md F1-F3):
 *   - remove <script>, <iframe>, <object>, <embed>, <form>, <style>, ...
 *   - remove event-handler attributes and unknown protocols (DOMPurify)
 *   - remove CSS `url(...)`, `position: fixed`, `expression(...)` and
 *     `behavior` declarations (no outbound requests / overlay abuse)
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

    var SANITIZE_CONFIG = {
        FORBID_TAGS: [
            'script', 'iframe', 'object', 'embed', 'form', 'input',
            'button', 'textarea', 'select', 'style', 'link', 'meta', 'base'
        ],
        FORBID_ATTR: [ 'srcdoc', 'formaction' ],
        ALLOW_DATA_ATTR: false
    };

    /**
     * Drop CSS declarations that can exfiltrate data or break the pane.
     * MVP baseline (D7); a stricter policy is deferred to Epic J.
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
            var lower = decl.toLowerCase();
            if ( !decl || lower.indexOf( 'url(' ) !== -1 ) {
                continue;
            }
            if ( /position\s*:\s*fixed/.test( lower ) ) {
                continue;
            }
            if ( lower.indexOf( 'expression(' ) !== -1 || lower.indexOf( 'behavior' ) !== -1 ) {
                continue;
            }
            kept.push( decl );
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
        var html = null;
        var rendered = null;

        try {
            html = renderMarkdown( text );
        } catch ( e ) {
            html = null;
        }

        if ( html !== null ) {
            rendered = document.createElement( 'div' );
            rendered.className = RENDERED_CLASS;
            rendered.id = RENDERED_ID;
            rendered.innerHTML = html;
            rendered.setAttribute( 'data-hbw-render', 'html' );
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
