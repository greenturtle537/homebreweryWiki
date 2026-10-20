/**
 * DOM tests for HomebreweryWiki.render.js (E1S3 T2-T4).
 *
 * Runs the real vendored bundles (marked 0.3.19 + DOMPurify 2.5.8) and the
 * render module inside jsdom, using the same placeholder contract the server
 * emits.  This is a DOM-level proof; a real-browser screenshot is still a
 * human review step (no headless Chromium in this environment).
 *
 *   npm install
 *   npm test
 */
'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var JSDOM = require( 'jsdom' ).JSDOM;
var VirtualConsole = require( 'jsdom' ).VirtualConsole;
var requestInterceptor = require( 'jsdom' ).requestInterceptor;

/**
 * jsdom `resources` options that record every fetch attempt and answer it
 * with an empty synthetic response, so a test never touches the network.
 *
 * jsdom only asks for fetch-capable resources (scripts, stylesheets, frames,
 * media).  Recording them therefore turns "does the rendered brew make an
 * outbound request?" into an observable list.
 *
 * @param {Array.<string>} log Collector for requested URLs.
 * @return {Object} Value for the JSDOM `resources` option.
 */
function recordingResources( log ) {
    return {
        interceptors: [
            requestInterceptor( function ( request ) {
                log.push( String( request.url ) );
                return new Response( '', { status: 204 } );
            } )
        ]
    };
}

var root = path.join( __dirname, '..' );
var homebrewerySource = fs.readFileSync(
    path.join( root, 'vendor', 'homebrewery-3.21.0', 'renderer.min.js' ), 'utf8'
);
var markedSource = fs.readFileSync( path.join( root, 'vendor', 'marked-0.3.19.min.js' ), 'utf8' );
var purifySource = fs.readFileSync( path.join( root, 'vendor', 'dompurify-2.5.8.min.js' ), 'utf8' );
var renderSource = fs.readFileSync( path.join( root, 'HomebreweryWiki.render.js' ), 'utf8' );

var pass = 0;
var fail = 0;

/**
 * Record one assertion result.
 *
 * @param {boolean} cond Condition that must hold.
 * @param {string} msg  Human-readable assertion label.
 * @return {void}
 */
function ok( cond, msg ) {
    if ( cond ) {
        pass++;
        console.log( 'PASS: ' + msg );
    } else {
        fail++;
        console.log( 'FAIL: ' + msg );
    }
}

/**
 * Escape text for the hidden-server-placeholder fixture.
 *
 * @param {string} value Raw text.
 * @return {string} HTML-escaped text.
 */
function escapeHtml( value ) {
    return String( value )
        .replace( /&/g, '&amp;' )
        .replace( /</g, '&lt;' )
        .replace( />/g, '&gt;' )
        .replace( /"/g, '&quot;' )
        .replace( /'/g, '&#39;' );
}

/**
 * Build a jsdom page with the real placeholder markup and run the real
 * renderer assets inside it.
 *
 * @param {string|null} source  Brew source, or null for a non-brew page.
 * @param {Object}      options `{ withLibs: false }` omits marked/DOMPurify;
 *                              `{ withHomebrewery: true }` also loads the
 *                              pinned Homebrewery renderer bundle (E3S2T1);
 *                              `{ preview: true }` wraps the placeholder in
 *                              EditPage's #wikiPreview container (E1S4);
 *                              `{ resourceLog: [] }` records every resource
 *                              the document tries to fetch and aborts it
 *                              (E3S4: zero outbound requests);
 *                              `{ wikiBase: string }` / `{ files: Object }`
 *                              emit the E3.5S3 host attributes;
 *                              `{ print: true }` marks the print route and
 *                              counts `window.print()` calls;
 *                              `{ clientWidth: number }` stubs the host width
 *                              before the first fit (E3.5S4);
 *                              `{ immediateTimers: true }` runs window timers
 *                              synchronously (print, late refits).
 * @return {{dom: JSDOM, win: Window, errors: Array}} Test fixture.
 */
function makePage( source, options ) {
    options = options || {};
    var consoleErrors = [];
    var virtualConsole = new VirtualConsole();
    virtualConsole.on( 'jsdomError', function ( err ) {
        consoleErrors.push( err );
    } );
    virtualConsole.on( 'error', function () {
        consoleErrors.push( Array.prototype.slice.call( arguments ) );
    } );

    var html;
    if ( source === null ) {
        html = '<!doctype html><html><body><div id="content"><p>Main page</p></div></body></html>';
    } else {
        var escaped = escapeHtml( source );
        var hostAttrs = '';
        if ( options.wikiBase !== undefined ) {
            hostAttrs += ' data-hbw-wiki-base="' + escapeHtml( options.wikiBase ) + '"';
        }
        if ( options.files !== undefined ) {
            hostAttrs += ' data-hbw-files="' + escapeHtml( JSON.stringify( options.files ) ) + '"';
        }
        if ( options.print ) {
            hostAttrs += ' data-hbw-print="1"';
        }
        var placeholder = '<div class="hbw-brew" id="hbw-brew"' + hostAttrs + '>'
            + '<div class="hbw-source" id="hbw-source" style="display:none">' + escaped + '</div>'
            + '<noscript><pre class="hbw-brew-text">\n' + escaped + '</pre></noscript>'
            + '</div>';
        if ( options.preview ) {
            // EditPage::displayPreviewArea() markup: the preview head sits
            // above the shared placeholder inside #wikiPreview.
            html = '<!doctype html><html><body><div id="content"><div id="wikiPreview" class="ontop">'
                + '<h2>Preview</h2><div class="previewnote">preview note</div>'
                + placeholder
                + '</div></div></body></html>';
        } else {
            html = '<!doctype html><html><body><div id="content">'
                + placeholder
                + '</div></body></html>';
        }
    }

    var dom = new JSDOM( html, {
        url: 'http://wiki.example.test/index.php?title=Manual:Test',
        runScripts: 'dangerously',
        virtualConsole: virtualConsole,
        resources: options.resourceLog ? recordingResources( options.resourceLog ) : undefined
    } );
    var win = dom.window;

    if ( options.withHomebrewery ) {
        // The bundle runs on the real browser floor; jsdom's window still has
        // no structuredClone, which upstream's marked hooks use.
        win.structuredClone = win.structuredClone || function ( value ) {
            return JSON.parse( JSON.stringify( value ) );
        };
        win.eval( homebrewerySource );
        if ( options.pinnedThrows ) {
            win.HomebreweryRenderer.render = function () {
                throw new Error( 'pinned renderer exploded' );
            };
        }
    }
    if ( options.withLibs !== false ) {
        win.eval( markedSource );
        win.eval( purifySource );
    }
    win.eval( renderSource );

    if ( options.clientWidth !== undefined ) {
        var hostEl = win.document.getElementById( 'hbw-brew' );
        if ( hostEl ) {
            Object.defineProperty( hostEl, 'clientWidth', {
                value: options.clientWidth,
                configurable: true
            } );
        }
    }
    if ( options.print ) {
        win.__printCount = 0;
        win.print = function () {
            win.__printCount++;
        };
    }
    if ( options.immediateTimers ) {
        win.setTimeout = function ( callback ) {
            callback();
            return 0;
        };
        win.clearTimeout = function () {};
    }

    // The module listens for DOMContentLoaded when readyState is still
    // "loading"; dispatch synchronously so the assertions are deterministic.
    win.document.dispatchEvent( new win.Event( 'DOMContentLoaded', { bubbles: true } ) );

    return { dom: dom, win: win, errors: consoleErrors };
}

/**
 * The parent-side host element for a rendered brew.
 *
 * @param {Object} page Test fixture from makePage().
 * @return {HTMLElement|null} `.hbw-brew` host, if any.
 */
function hostOf( page ) {
    return page.win.document.getElementById( 'hbw-brew' );
}

/**
 * The same-origin render iframe appended to the host.
 *
 * @param {Object} page Test fixture from makePage().
 * @return {HTMLIFrameElement|null} Render frame, if any.
 */
function frameOf( page ) {
    var host = hostOf( page );
    return host ? host.querySelector( 'iframe' ) : null;
}

/**
 * The render iframe's document (the module's visible DOM lives here).
 *
 * @param {Object} page Test fixture from makePage().
 * @return {Document|null} Frame document, if available.
 */
function frameDocOf( page ) {
    var frame = frameOf( page );
    try {
        return frame && frame.contentDocument;
    } catch ( e ) {
        return null;
    }
}

/**
 * Root of the sanitized page DOM inside the iframe.
 *
 * @param {Object} page Test fixture from makePage().
 * @return {HTMLElement|null} `.brewRenderer` root, or null on fallback.
 */
function renderRoot( page ) {
    var doc = frameDocOf( page );
    return doc ? doc.querySelector( '.brewRenderer' ) : null;
}

// --- T3: headings and paragraphs become real HTML elements ---
( function () {
    var page = makePage( '# Brew Title\n\nA paragraph with **bold** text.\n' );
    var doc = page.win.document;
    var rendered = renderRoot( page );
    var host = hostOf( page );
    var frame = frameOf( page );
    var sandbox = frame ? frame.getAttribute( 'sandbox' ) : '';

    ok( doc.getElementById( 'hbw-source' ) === null, 'render: hidden source is removed' );
    ok( !!rendered, 'render: sanitized pages exist inside the iframe' );
    ok( !!host && host.getAttribute( 'data-hbw-render' ) === 'html',
        'render: html path is reported' );
    ok( !!host && host.getAttribute( 'data-hbw-pages' ) === '1',
        'render: page count is reported' );
    ok( !!frame && sandbox.indexOf( 'allow-same-origin' ) !== -1 &&
        sandbox.indexOf( 'allow-top-navigation-by-user-activation' ) !== -1,
        'render: iframe host is same-origin and top-navigation-safe' );
    ok( sandbox.indexOf( 'allow-scripts' ) === -1,
        'render: iframe host does not allow scripts' );
    ok( !!frame && frame.getAttribute( 'referrerpolicy' ) === 'no-referrer',
        'render: iframe host sends no referrer' );
    ok( !!frame && frame.getAttribute( 'scrolling' ) === 'no',
        'render: iframe host does not scroll itself' );
    ok( !!rendered && !!rendered.querySelector( 'h1' ),
        'render: markdown heading becomes an h1' );
    ok( !!rendered && rendered.querySelector( 'h1' ).textContent === 'Brew Title',
        'render: heading text is preserved' );
    ok( !!rendered && !!rendered.querySelector( 'p' ),
        'render: markdown paragraph becomes a p' );
    ok( !!rendered && !!rendered.querySelector( 'p strong' ),
        'render: inline markdown becomes markup' );
    ok( !!rendered && !rendered.querySelector( 'pre' ),
        'render: no preformatted fallback on the happy path' );
    ok( page.errors.length === 0, 'render: no console errors (happy path)' );
}() );

// --- T2: unsafe markup is sanitized before insertion ---
( function () {
    var source = '<script>window.__pwned = true;<\/script>\n\n'
        + '# Safe\n\n'
        + '<img src="x" onerror="window.__pwned = \'img\';">\n\n'
        + '<iframe src="https://evil.example/"></iframe>\n\n'
        + '<div style="background:url(https://evil.example/x.png); position: fixed; color: red">styled</div>\n\n'
        + '<div style="background-image: image-set(\'https://evil.example/track\' 1x); color: blue">image-set</div>\n';
    var page = makePage( source );
    var doc = page.win.document;
    var rendered = renderRoot( page );
    var divs = rendered ? rendered.querySelectorAll( 'div[style]' ) : [];
    var style = divs.length ? divs[0].getAttribute( 'style' ) : '';
    var imageSetStyle = divs.length > 1 ? divs[1].getAttribute( 'style' ) : '';

    ok( !!rendered, 'sanitize: content rendered' );
    ok( !!rendered && !rendered.querySelector( 'script' ), 'sanitize: script removed' );
    ok( !!rendered && !rendered.querySelector( 'iframe' ), 'sanitize: iframe removed' );
    ok( !!rendered && !/onerror/i.test( rendered.innerHTML ), 'sanitize: event handler removed' );
    ok( page.win.__pwned === undefined, 'sanitize: no script executed' );
    ok( style.indexOf( 'color: red' ) !== -1, 'sanitize: safe inline CSS kept' );
    ok( style.toLowerCase().indexOf( 'url(' ) === -1, 'sanitize: css url() removed' );
    ok( style.toLowerCase().indexOf( 'position' ) === -1, 'sanitize: position:fixed removed' );
    ok( imageSetStyle.indexOf( 'color: blue' ) !== -1, 'sanitize: safe colour kept beside image-set' );
    ok( imageSetStyle.toLowerCase().indexOf( 'image-set' ) === -1,
        'sanitize: image-set() removed' );
    ok( page.errors.length === 0, 'sanitize: no console errors' );
}() );

// --- Media elements and resource attributes are forbidden ---
( function () {
    var source = '<video poster="https://evil.example/p.png">'
        + '<source src="https://evil.example/v.mp4"></video>\n\n'
        + '<audio src="https://evil.example/a.mp3"></audio>\n\n'
        + '<picture><source srcset="https://evil.example/p2.png 2x"></picture>\n\n'
        + '<img src="/images/ok.png" srcset="https://evil.example/x.png 2x" alt="ok">\n';
    var page = makePage( source );
    var rendered = renderRoot( page );
    var img = rendered ? rendered.querySelector( 'img' ) : null;

    ok( !!rendered, 'media: content rendered' );
    ok( !!rendered && !rendered.querySelector( 'video' ), 'media: video removed' );
    ok( !!rendered && !rendered.querySelector( 'audio' ), 'media: audio removed' );
    ok( !!rendered && !rendered.querySelector( 'source' ), 'media: source removed' );
    ok( !!rendered && !rendered.querySelector( 'picture' ), 'media: picture removed' );
    ok( !!rendered && !/poster/i.test( rendered.innerHTML ), 'media: poster removed' );
    ok( !!rendered && !/srcset/i.test( rendered.innerHTML ), 'media: srcset removed' );
    ok( !!img && img.getAttribute( 'src' ) === '/images/ok.png',
        'media: legitimate img src kept' );
    ok( page.errors.length === 0, 'media: no console errors' );
}() );

// --- SVG and the legacy background attribute cannot fetch either ---
( function () {
    var source = '<svg><image href="https://evil.example/x.svg"></image>'
        + '<feImage href="https://evil.example/y.svg"></feImage></svg>\n\n'
        + '<table background="https://evil.example/bg.png"><tr><td>cell</td></tr></table>\n';
    var page = makePage( source );
    var rendered = renderRoot( page );
    var table = rendered ? rendered.querySelector( 'table' ) : null;

    ok( !!rendered, 'svg: content rendered' );
    ok( !!rendered && !rendered.querySelector( 'svg' ), 'svg: svg element removed' );
    ok( !!rendered && !/evil\.example/.test( rendered.innerHTML ),
        'svg: external svg refs removed' );
    ok( !!table, 'svg: table content kept' );
    ok( !!table && !table.getAttribute( 'background' ),
        'svg: legacy background attribute removed' );
    ok( page.errors.length === 0, 'svg: no console errors' );
}() );

// --- D2/F3: only same-origin (or inline data) images survive ---
( function () {
    var page = makePage( '![evil](https://evil.example/x.png)\n\n'
        + '![good](/images/x.png)\n\n'
        + '![inline](data:image/png;base64,AAAA)\n' );
    var rendered = renderRoot( page );
    var imgs = rendered ? rendered.querySelectorAll( 'img' ) : [];

    ok( imgs.length === 3, 'images: three img elements rendered' );
    ok( imgs.length === 3 && !imgs[0].getAttribute( 'src' ),
        'images: external src removed' );
    ok( imgs.length === 3 && imgs[0].getAttribute( 'data-hbw-blocked' ) === 'external',
        'images: external src flagged' );
    ok( imgs.length === 3 && imgs[1].getAttribute( 'src' ) === '/images/x.png',
        'images: same-origin src kept' );
    ok( imgs.length === 3 && /^data:image\//.test( imgs[2].getAttribute( 'src' ) ),
        'images: inline data image kept' );
    ok( page.errors.length === 0, 'images: no console errors' );
}() );

// --- E3S4T1: every remaining injection vector is stripped ---
( function () {
    var source = '<style>@import url("https://evil.example/i.css");</style>\n\n'
        + '<link rel="stylesheet" href="https://evil.example/s.css">\n\n'
        + '<meta http-equiv="refresh" content="0;url=https://evil.example/r">\n\n'
        + '<base href="https://evil.example/">\n\n'
        + '<object data="https://evil.example/o"></object>\n\n'
        + '<embed src="https://evil.example/e">\n\n'
        + '<form action="https://evil.example/p"><input name="q"></form>\n\n'
        + '<a href="javascript:window.__pwned=1" ping="https://evil.example/ping">js</a>\n\n'
        + '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data</a>\n\n'
        + '<img src="/images/ok.png" dynsrc="https://evil.example/d.png" '
        + 'lowsrc="https://evil.example/l.png" alt="ok">\n\n'
        + '<div style="background: u\\72l(https://evil.example/x.png); color: green">escaped</div>\n\n'
        + '<div style="width: expression(alert(1)); color: purple">expression</div>\n';
    var page = makePage( source );
    var rendered = renderRoot( page );
    var html = rendered ? rendered.innerHTML : '';
    var divs = rendered ? rendered.querySelectorAll( 'div[style]' ) : [];
    var escapedStyle = divs.length ? divs[0].getAttribute( 'style' ) : '';
    var expressionStyle = divs.length > 1 ? divs[1].getAttribute( 'style' ) : '';
    var img = rendered ? rendered.querySelector( 'img' ) : null;

    ok( !!rendered, 'vectors: content rendered' );
    ok( !!rendered && !rendered.querySelector( 'style' ), 'vectors: style element removed' );
    ok( !!rendered && !rendered.querySelector( 'link' ), 'vectors: link element removed' );
    ok( !!rendered && !rendered.querySelector( 'meta' ), 'vectors: meta refresh removed' );
    ok( !!rendered && !rendered.querySelector( 'base' ), 'vectors: base element removed' );
    ok( !!rendered && !rendered.querySelector( 'object' ), 'vectors: object removed' );
    ok( !!rendered && !rendered.querySelector( 'embed' ), 'vectors: embed removed' );
    ok( !!rendered && !rendered.querySelector( 'form' ),
        'vectors: form removed' );
    ok( html.toLowerCase().indexOf( 'javascript:' ) === -1,
        'vectors: javascript: href removed' );
    ok( html.toLowerCase().indexOf( 'data:text/html' ) === -1,
        'vectors: data:text/html href removed' );
    ok( html.indexOf( 'evil.example' ) === -1,
        'vectors: no external URL survives' );
    ok( escapedStyle.indexOf( 'color: green' ) !== -1,
        'vectors: safe colour kept beside escaped url()' );
    ok( escapedStyle.toLowerCase().indexOf( 'url' ) === -1,
        'vectors: css-escaped url() removed' );
    ok( expressionStyle.indexOf( 'color: purple' ) !== -1,
        'vectors: safe colour kept beside expression()' );
    ok( expressionStyle.toLowerCase().indexOf( 'expression' ) === -1,
        'vectors: expression() removed' );
    ok( !!img && img.getAttribute( 'src' ) === '/images/ok.png',
        'vectors: same-origin img kept' );
    ok( page.errors.length === 0, 'vectors: no console errors' );
}() );

/**
 * Collect fetch-capable attribute values that resolve to another origin.
 *
 * Only attributes a browser fetches without user action are inspected
 * (`href` is limited to elements that load, not anchors the reader clicks).
 *
 * @param {Window} win  jsdom window (for URL resolution).
 * @param {Element} root Rendered container.
 * @return {Array.<string>} Off-origin attribute descriptions.
 */
function offOriginFetches( win, root ) {
    var fetchAttrs = {
        'src': true, 'srcset': true, 'poster': true, 'background': true,
        'data': true, 'ping': true, 'formaction': true, 'action': true,
        'href': true
    };
    var hrefLoaders = { 'link': true, 'use': true, 'image': true, 'base': true };
    var found = [];
    var nodes = root.querySelectorAll( '*' );
    var i;
    var j;
    var attr;
    var tag;
    var parts;
    var a;

    for ( i = 0; i < nodes.length; i++ ) {
        tag = nodes[ i ].nodeName.toLowerCase();
        for ( attr in fetchAttrs ) {
            if ( !fetchAttrs.hasOwnProperty( attr ) || !nodes[ i ].hasAttribute( attr ) ) {
                continue;
            }
            if ( attr === 'href' && !hrefLoaders[ tag ] ) {
                continue;
            }
            parts = String( nodes[ i ].getAttribute( attr ) ).split( /\s+/ );
            for ( j = 0; j < parts.length; j++ ) {
                a = win.document.createElement( 'a' );
                a.href = parts[ j ];
                if ( !a.protocol || !a.host ) {
                    continue;
                }
                if ( a.protocol + '//' + a.host !==
                    win.location.protocol + '//' + win.location.host ) {
                    found.push( tag + '[' + attr + ']=' + parts[ j ] );
                }
            }
        }
    }
    return found;
}

// --- E3S4 story: the attack brew runs no scripts, makes no outbound request ---
( function () {
    var attackSource = fs.readFileSync(
        path.join( __dirname, 'fixtures', 'attack-brew.md' ), 'utf8'
    );
    var requests = [];
    var page = makePage( attackSource, {
        withHomebrewery: true,
        resourceLog: requests
    } );
    var rendered = renderRoot( page );
    var offOrigin = rendered ? offOriginFetches( page.win, rendered ) : [ 'no render' ];

    ok( !!rendered, 'attack brew: content rendered' );
    ok( page.win.__hbw_pwned === undefined, 'attack brew: no script executed' );
    ok( !!rendered && !rendered.querySelector( 'script' ), 'attack brew: no script element' );
    ok( !!rendered && !rendered.querySelector( 'iframe' ), 'attack brew: no frame' );
    ok( requests.length === 0,
        'attack brew: no outbound request (' + requests.join( ', ' ) + ')' );
    ok( offOrigin.length === 0,
        'attack brew: no fetch-capable off-origin attribute (' + offOrigin.join( ', ' ) + ')' );
    ok( !!rendered && rendered.querySelectorAll( '.page' ).length >= 3,
        'attack brew: all pages still render' );
    ok( !!rendered && !!rendered.querySelector( 'h1' ) &&
        rendered.querySelector( 'h1' ).textContent === 'Attack Brew',
        'attack brew: benign prose survives (sanitizer, not escaper)' );
    ok( !!rendered && rendered.querySelectorAll( 'img[src="/images/ok.png"]' ).length >= 2,
        'attack brew: same-origin images survive' );
    ok( !!rendered && !!rendered.querySelector( 'img[src^="data:image/"]' ),
        'attack brew: inline data image survives' );
    ok( page.errors.length === 0, 'attack brew: no console errors' );
}() );

// --- E3S4 story: the reference demo brew is equally inert ---
( function () {
    var demos = [ 'three-page-brew.md', 'attack-brew.md' ];
    var d;
    var source;
    var requests;
    var page;
    var rendered;
    var offOrigin;

    for ( d = 0; d < demos.length; d++ ) {
        source = fs.readFileSync( path.join( __dirname, 'fixtures', demos[ d ] ), 'utf8' );
        requests = [];
        page = makePage( source, { withHomebrewery: true, resourceLog: requests } );
        rendered = renderRoot( page );
        offOrigin = rendered ? offOriginFetches( page.win, rendered ) : [ 'no render' ];

        ok( requests.length === 0 && offOrigin.length === 0,
            'demo brew ' + demos[ d ] + ': inert (no request, no off-origin attribute)' );
    }
}() );


// --- Degraded path: renderer unavailable => plain text, never hidden ---
( function () {
    var source = '# Still Readable\n\nbody text\n';
    var page = makePage( source, { withLibs: false } );
    var doc = page.win.document;
    var fallback = doc.getElementById( 'hbw-brew-text' );

    ok( doc.getElementById( 'hbw-source' ) === null, 'fallback: hidden source is removed' );
    ok( !!fallback, 'fallback: preformatted element created' );
    ok( !!fallback && fallback.getAttribute( 'data-hbw-render' ) === 'fallback',
        'fallback: degraded path is reported' );
    ok( !!hostOf( page ) &&
        hostOf( page ).getAttribute( 'data-hbw-render' ) === 'fallback',
        'fallback: host reports the degraded path' );
    ok( frameOf( page ) === null, 'fallback: no iframe left behind' );
    ok( !!fallback && fallback.textContent === source,
        'fallback: source text is byte-identical' );
    ok( page.errors.length === 0, 'fallback: no console errors' );
}() );

// --- Non-brew page: module is a no-op ---
( function () {
    var page = makePage( null );
    var doc = page.win.document;

    ok( hostOf( page ) === null, 'non-brew: no render container' );
    ok( doc.getElementById( 'hbw-source' ) === null, 'non-brew: source untouched/absent' );
    ok( doc.body.textContent.indexOf( 'Main page' ) !== -1, 'non-brew: content untouched' );
    ok( page.errors.length === 0, 'non-brew: no console errors' );
}() );

// --- E1S4 T1-T5: preview and saved view share one render path ---
( function () {
    var source = '# Brew Title\n\nA paragraph with **bold** text.\n';
    var viewPage = makePage( source );
    var previewPage = makePage( source, { preview: true } );
    var viewRendered = renderRoot( viewPage );
    var previewRendered = renderRoot( previewPage );
    var previewArea = previewPage.win.document.getElementById( 'wikiPreview' );

    ok( !!previewRendered, 'preview: rendered container created' );
    ok( !!previewArea && !!previewRendered && previewArea.contains( hostOf( previewPage ) ),
        'preview: rendered inside #wikiPreview' );
    ok( !!hostOf( previewPage ) &&
        hostOf( previewPage ).parentNode.id === 'wikiPreview',
        'preview: same .hbw-brew wrapper as the saved view' );
    ok( !!frameDocOf( previewPage ), 'preview: same iframe host as the saved view' );
    ok( previewPage.win.document.getElementById( 'hbw-source' ) === null,
        'preview: hidden source removed' );
    ok( !!previewRendered && !!previewRendered.querySelector( 'h1' ),
        'preview: markdown heading rendered' );
    ok( !!hostOf( previewPage ) &&
        hostOf( previewPage ).getAttribute( 'data-hbw-render' ) === 'html',
        'preview: html path is reported' );
    ok( !!viewRendered && !!previewRendered &&
        previewRendered.innerHTML === viewRendered.innerHTML,
        'preview: rendered HTML is identical to the saved view' );
    ok( !!viewRendered && !!previewRendered &&
        previewRendered.className === viewRendered.className,
        'preview: rendered classes are identical to the saved view' );
    ok( !!previewArea && previewArea.querySelector( '.previewnote' ) !== null,
        'preview: stock preview notice is preserved' );
    ok( previewPage.errors.length === 0, 'preview: no console errors' );
}() );

// --- E3S1 T1: \page / \column are recognised as split boundaries ---
( function () {
    var source = 'First page.\n\n'
        + '\\page\n\n'
        + 'Second page, left column.\n\n'
        + '\\column\n\n'
        + 'Second page, right column.\n';
    var page = makePage( source );
    var rendered = renderRoot( page );
    var pages = rendered ? rendered.querySelectorAll( '.page' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( pages.length === 2, 'split: \\page starts a new page block' );
    ok( pages.length === 2 &&
        !!pages[1].querySelector( '.columnWrapper .columnSplit' ) &&
        pages[1].querySelectorAll( '.columnWrapper' ).length === 1,
        'split: \\column starts a new upstream column inside the page' );
    ok( pages.length === 2 && !pages[1].querySelector( '.hbw-column' ),
        'split: no legacy .hbw-column blocks are created' );
    ok( text.indexOf( '\\page' ) === -1, 'split: \\page marker text does not leak' );
    ok( text.indexOf( '\\column' ) === -1, 'split: \\column marker text does not leak' );
    ok( page.errors.length === 0, 'split: no console errors' );
}() );

// --- E3S1 T2: one page block per page, content stays in its own block ---
( function () {
    var source = '# One\n\nfirst\n\n\\page\n\n# Two\n\nsecond\n\n\\page\n\n# Three\n\nthird\n';
    var page = makePage( source );
    var rendered = renderRoot( page );
    var pages = rendered ? rendered.querySelectorAll( '.page' ) : [];

    ok( pages.length === 3, 'pages: two markers produce three page blocks' );
    ok( pages.length === 3 && pages[0].textContent.indexOf( 'first' ) !== -1 &&
        pages[0].textContent.indexOf( 'second' ) === -1 &&
        pages[0].textContent.indexOf( 'third' ) === -1,
        'pages: first block holds only page-one content' );
    ok( pages.length === 3 && pages[1].textContent.indexOf( 'second' ) !== -1 &&
        pages[1].textContent.indexOf( 'first' ) === -1 &&
        pages[1].textContent.indexOf( 'third' ) === -1,
        'pages: second block holds only page-two content' );
    ok( pages.length === 3 && pages[2].textContent.indexOf( 'third' ) !== -1 &&
        pages[2].textContent.indexOf( 'first' ) === -1 &&
        pages[2].textContent.indexOf( 'second' ) === -1,
        'pages: third block holds only page-three content' );
    ok( pages.length === 3 &&
        pages[0].getAttribute( 'data-index' ) === '0' &&
        pages[1].getAttribute( 'data-index' ) === '1' &&
        pages[2].getAttribute( 'data-index' ) === '2',
        'pages: blocks keep document order' );
    ok( page.errors.length === 0, 'pages: no console errors' );
}() );

// --- E3S1 T3: the three-page reference brew renders as three blocks ---
( function () {
    var fixture = fs.readFileSync(
        path.join( __dirname, 'fixtures', 'three-page-brew.md' ), 'utf8'
    );
    var page = makePage( fixture );
    var rendered = renderRoot( page );
    var frameDoc = frameDocOf( page );
    var pagesRoot = frameDoc ? frameDoc.querySelector( '.pages' ) : null;
    var pages = rendered ? rendered.querySelectorAll( '.page' ) : [];
    var headings = [];

    ok( !!pagesRoot && pagesRoot.querySelectorAll( '.page' ).length === 3,
        'reference brew: iframe .pages holds three .page blocks' );

    if ( pages.length === 3 ) {
        headings.push( pages[0].querySelector( 'h1' ) ? pages[0].querySelector( 'h1' ).textContent : '' );
        headings.push( pages[1].querySelector( 'h1' ) ? pages[1].querySelector( 'h1' ).textContent : '' );
        headings.push( pages[2].querySelector( 'h1' ) ? pages[2].querySelector( 'h1' ).textContent : '' );
    }

    ok( pages.length === 3, 'reference brew: three page blocks appear' );
    ok( pages.length === 3 && headings[0] === 'The Three-Page Reference Brew' &&
        headings[1] === 'Page Two' && headings[2] === 'Page Three',
        'reference brew: page blocks appear in document order' );
    ok( pages.length === 3 && pages[1].querySelectorAll( '.columnSplit' ).length === 1 &&
        pages[1].querySelectorAll( '.columnWrapper' ).length === 1,
        'reference brew: \\column is preserved as an upstream column split' );
    ok( pages.length === 3 && !rendered.querySelector( '.hbw-page' ) &&
        !rendered.querySelector( '.hbw-column' ),
        'reference brew: no legacy .hbw-page/.hbw-column blocks remain' );
    ok( page.errors.length === 0, 'reference brew: no console errors' );
}() );

// --- E3S2 T1: the pinned Homebrewery renderer produces the output ---
( function () {
    var source = '# Brew Title\n\nA paragraph with **bold** text.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var heading = rendered ? rendered.querySelector( 'h1' ) : null;

    ok( typeof page.win.HomebreweryRenderer === 'object',
        'pinned: bundle defines HomebreweryRenderer' );
    ok( !!rendered && hostOf( page ).getAttribute( 'data-hbw-renderer' ) === 'homebrewery-3.21.0',
        'pinned: container reports the pinned renderer' );
    ok( !!rendered && !!heading, 'pinned: markdown heading rendered' );
    ok( !!heading && heading.textContent === 'Brew Title', 'pinned: heading text preserved' );
    ok( !!heading && !!heading.getAttribute( 'id' ),
        'pinned: Homebrewery heading ids are emitted (not the marked fallback)' );
    ok( !!rendered && !!rendered.querySelector( 'p strong' ),
        'pinned: inline markdown becomes markup' );
    ok( page.errors.length === 0, 'pinned: no console errors' );
}() );

// --- E3S2 T2: pinned-renderer output is still sanitized before insertion ---
( function () {
    var source = '<script>window.__pwnedPin = true;<\/script>\n\n'
        + '# Safe\n\n'
        + '<img src="x" onerror="window.__pwnedPin = \'img\';">\n\n'
        + '<iframe src="https://evil.example/"></iframe>\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );

    ok( !!rendered && hostOf( page ).getAttribute( 'data-hbw-renderer' ) === 'homebrewery-3.21.0',
        'pinned sanitize: pinned renderer is in use' );
    ok( !!rendered && !rendered.querySelector( 'script' ),
        'pinned sanitize: script removed' );
    ok( !!rendered && !rendered.querySelector( 'iframe' ),
        'pinned sanitize: iframe removed' );
    ok( !!rendered && !/onerror/i.test( rendered.innerHTML ),
        'pinned sanitize: event handler removed' );
    ok( page.win.__pwnedPin === undefined, 'pinned sanitize: no script executed' );
    ok( !!rendered && !!rendered.querySelector( 'h1' ),
        'pinned sanitize: safe content kept' );
    ok( page.errors.length === 0, 'pinned sanitize: no console errors' );
}() );

// --- E3S2 T1: marker aliases match upstream's PAGEBREAK_REGEX_V3 ---
( function () {
    var source = 'One\n\n\\pagebreak\n\nTwo\n\n\\columnbreak\n\nThree\n\n'
        + '\\page {landscape}\n\nFour\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var pages = rendered ? rendered.querySelectorAll( '.page' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( pages.length === 3, 'aliases: \\pagebreak and \\page both split pages' );
    ok( pages.length === 3 && pages[1].querySelectorAll( '.columnSplit' ).length === 1,
        'aliases: \\columnbreak emits the upstream column split' );
    ok( text.indexOf( 'pagebreak' ) === -1 && text.indexOf( 'columnbreak' ) === -1 &&
        text.indexOf( 'landscape' ) === -1,
        'aliases: marker text and attributes do not leak' );
    ok( page.errors.length === 0, 'aliases: no console errors' );
}() );

// --- E3S2 review: a thrown pinned renderer falls back to marked ---
( function () {
    var source = '# Still Here\n\nbody text\n';
    var page = makePage( source, { withHomebrewery: true, pinnedThrows: true } );
    var doc = page.win.document;
    var rendered = renderRoot( page );

    ok( !!rendered, 'pinned throw: content still rendered' );
    ok( !!rendered && hostOf( page ).getAttribute( 'data-hbw-renderer' ) === 'marked-0.3.19',
        'pinned throw: marked fallback is reported' );
    ok( !!rendered && !!rendered.querySelector( 'h1' ),
        'pinned throw: fallback produced the heading' );
    ok( page.errors.length === 0, 'pinned throw: no console errors' );
}() );

// --- E3S2 review: one render per page keeps variables across columns ---
( function () {
    var source = '[str]: 18\n\n# Stats\n\nSTR $[str]\n\n\\columnbreak\n\nAgain $[str]\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var pages = rendered ? rendered.querySelectorAll( '.page' ) : [];
    var wrapper = pages.length ? pages[0].querySelector( '.columnWrapper' ) : null;
    var split = wrapper ? wrapper.querySelector( '.columnSplit' ) : null;
    var text = pages.length ? pages[0].textContent : '';

    ok( !!wrapper && !!split, 'page state: column break emits one upstream split' );
    ok( text.split( '18' ).length - 1 === 2,
        'page state: both columns resolve the variable' );
    ok( page.errors.length === 0, 'page state: no console errors' );
}() );

// --- Degraded path still reports the fallback renderer when the bundle is absent ---
( function () {
    var page = makePage( '# Title\n\nbody\n' );
    var rendered = renderRoot( page );

    ok( !!rendered && hostOf( page ).getAttribute( 'data-hbw-renderer' ) === 'marked-0.3.19',
        'fallback renderer: marked path is reported' );
    ok( page.errors.length === 0, 'fallback renderer: no console errors' );
}() );

// --- E3S2 T4: every theme rule is scoped under .hbw-brew ---
// Shared extractor: a character-by-character walk records the selector text
// before each `{` together with its brace depth. Odd-depth text is a
// declaration and is never a selector, so selectors nested inside one-line
// at-rules (e.g. `@media screen { body { ... } }`) are inspected regardless
// of line breaks. At-rule preambles are skipped by their leading `@`.
( function () {
    /**
     * Return the selector text before every `{`, comments stripped.
     *
     * @param {string} css Stylesheet source, comments stripped.
     * @return {Array.<string>} Selector text in source order.
     */
    function extractSelectors( css ) {
        var raw = {};
        var buffer = '';
        var ch;
        var i;
        var text;
        var parts;
        var j;
        var selectors = [];
        for ( i = 0; i < String( css ).length; i++ ) {
            ch = css.charAt( i );
            if ( ch === '{' ) {
                raw[ buffer ] = 1;
                buffer = '';
                continue;
            }
            if ( ch === '}' ) {
                buffer = '';
                continue;
            }
            buffer += ch;
        }
        for ( text in raw ) {
            if ( !raw.hasOwnProperty( text ) ) {
                continue;
            }
            text = text.replace( /^\s+|\s+$/g, '' );
            if ( !text || text.charAt( 0 ) === '@' ) {
                continue;
            }
            parts = text.split( ',' );
            for ( j = 0; j < parts.length; j++ ) {
                text = parts[ j ].replace( /^\s+|\s+$/g, '' );
                if ( text ) {
                    selectors.push( text );
                }
            }
        }
        return selectors;
    }

    var themeSource = fs.readFileSync(
        path.join( root, 'HomebreweryWiki.theme.css' ), 'utf8'
    ).replace( /\/\*[\s\S]*?\*\//g, '' );
    var selectors = extractSelectors( themeSource );
    var unscoped = [];
    var bare = /^\s*(html|body|\*|:root)\s*$/i;
    // E3.5S4 print isolation is the one documented exception: it only runs in
    // @media print on the print route and hides wiki chrome around the host.
    var printOnly = /^\s*body\.hbw-print-mode\b/;
    var i;
    var leakedAtRule;

    for ( i = 0; i < selectors.length; i++ ) {
        if ( selectors[ i ] && selectors[ i ].indexOf( '.hbw-brew' ) !== 0 &&
            !printOnly.test( selectors[ i ] ) ) {
            unscoped.push( selectors[ i ] );
        }
        if ( bare.test( selectors[ i ] ) ) {
            unscoped.push( selectors[ i ] );
        }
    }

    // Regression: a bare selector hidden inside a one-line at-rule must be
    // found, not silently skipped.
    var evilSelectors = extractSelectors( '@media screen { body { color: red; } }' );
    leakedAtRule = evilSelectors.indexOf( 'body' ) !== -1;

    ok( leakedAtRule, 'theme: audit inspects selectors inside one-line at-rules' );
    ok( evilSelectors.indexOf( '@media screen' ) === -1,
        'theme: audit skips at-rule preambles' );
    ok( unscoped.length === 0,
        'theme: every selector is scoped under .hbw-brew (' + unscoped.join( ' | ' ) + ')' );
    ok( selectors.length > 0, 'theme: stylesheet has rules' );
    ok( themeSource.indexOf( '.hbw-brew .hbw-frame' ) !== -1,
        'theme: parent stylesheet sizes the iframe host' );
    // Ids are allowed only inside the print-mode isolation rules (E3.5S4).
    var idRules = themeSource.match( /[^{}]*#[^{}]*\{[^}]*\}/g ) || [];
    ok( idRules.every( function ( rule ) {
        return rule.indexOf( 'hbw-print-mode' ) !== -1;
    } ), 'theme: ids appear only in print-mode isolation rules' );
}() );

// --- E3B5 / E3.5S5: the old side-by-side harness is retired ---
// Comparing the extension against the raw renderer under the same CSS proved
// only that the renderer matches itself. Structural parity now lives in the
// iframe assertions above and the real-app golden harness (tests/parity/).

// --- E3S2 T4: theme parity extends to computed style values ---
( function () {
    var cases = [
        {
            source: '<div style="width: 840px;">\n\nBlock content.\n\n</div>\n',
            needle: 'width: 840px', prop: 'width', expect: '840px'
        },
        {
            source: '<div style="text-align: justify;">\n\nJustified text.\n\n</div>\n',
            needle: 'text-align: justify', prop: 'text-align', expect: 'justify'
        },
        {
            source: '<div style="background: #123456;">\n\nPainted content.\n\n</div>\n',
            needle: 'background', prop: 'background-color', expect: 'rgb(18, 52, 86)'
        }
    ];
    var i;
    for ( i = 0; i < cases.length; i++ ) {
        ( function ( spec ) {
            var page = makePage( spec.source, { withHomebrewery: true } );
            var frameDoc = frameDocOf( page );
            var view = frameDoc && frameDoc.defaultView;
            var rendered = renderRoot( page );
            var styled = rendered ? rendered.querySelector( 'div[style]' ) : null;
            var value = '';
            if ( styled && view && view.getComputedStyle ) {
                value = view.getComputedStyle( styled ).getPropertyValue( spec.prop );
            }
            ok( !!rendered, 'theme values: ' + spec.needle + ' rendered' );
            ok( !!styled && styled.textContent !== '',
                'theme values: styled div wraps its block' );
            ok( !!styled && styled.getAttribute( 'style' ).indexOf( spec.needle ) !== -1,
                'theme values: sanitizer keeps ' + spec.needle );
            ok( !!styled && String( value ).replace( /^\s+|\s+$/g, '' ) === spec.expect,
                'theme values: ' + spec.prop + ' is ' + spec.expect + ' (got "' + value + '")' );
            ok( page.errors.length === 0, 'theme values: no console errors (' + spec.needle + ')' );
        }( cases[ i ] ) );
    }
}() );

// --- E3S2 T5: no brew rule matches anything outside the wrapper ---
( function () {
    var themeSource = fs.readFileSync(
        path.join( root, 'HomebreweryWiki.theme.css' ), 'utf8'
    ).replace( /\/\*[\s\S]*?\*\//g, '' );
    // Same brace-walk extractor as the T4 audit: selector text before every
    // `{` is inspected, so nested selectors inside one-line at-rules are
    // found regardless of line breaks; declarations and at-rule preambles
    // are never selectors.
    function extractAuditSelectors( auditCss ) {
        var raw = {};
        var buffer = '';
        var ch;
        var i;
        var text;
        var parts;
        var j;
        var selectors = [];
        for ( i = 0; i < String( auditCss ).length; i++ ) {
            ch = auditCss.charAt( i );
            if ( ch === '{' ) {
                raw[ buffer ] = 1;
                buffer = '';
                continue;
            }
            if ( ch === '}' ) {
                buffer = '';
                continue;
            }
            buffer += ch;
        }
        for ( text in raw ) {
            if ( !raw.hasOwnProperty( text ) ) {
                continue;
            }
            text = text.replace( /^\s+|\s+$/g, '' );
            if ( !text || text.charAt( 0 ) === '@' ) {
                continue;
            }
            parts = text.split( ',' );
            for ( j = 0; j < parts.length; j++ ) {
                text = parts[ j ].replace( /^\s+|\s+$/g, '' );
                if ( text ) {
                    selectors.push( text );
                }
            }
        }
        return selectors;
    }

    var selectors = extractAuditSelectors( themeSource );

    // Mixed document: a brew wrapper immediately followed by ordinary page
    // content, so adjacent-selector escapes (`.hbw-brew + .note`) would fire.
    var mixed = new JSDOM(
        '<!doctype html><html><body>'
        + '<div class="hbw-brew"><iframe class="hbw-frame"></iframe>' +
        '<div class="page"><div class="columnWrapper">'
        + '<p>Brew content</p>'
        + '</div></div></div>'
        + '<div class="note">page content after the brew</div>'
        + '<p class="sect1">more content</p>'
        + '</body></html>',
        { url: 'http://wiki.example.test/index.php?title=Manual:Test' }
    );
    var mixedDoc = mixed.window.document;

    // Plain document with no brew wrapper at all.
    var dom = new JSDOM(
        '<!doctype html><html><body>'
        + '<div id="content"><h1>Plain page</h1><p>Text</p>'
        + '<img src="/x.png"><table><tr><td>c</td></tr></table>'
        + '<div class="note">not a brew</div>'
        + '</div></body></html>',
        { url: 'http://wiki.example.test/index.php?title=Main_Page' }
    );
    var doc = dom.window.document;
    var escaped = [];
    var k;
    var hits;
    var h;

    for ( k = 0; k < selectors.length; k++ ) {
        // Plain fixture: nothing may match.
        hits = doc.querySelectorAll( selectors[ k ] );
        for ( h = 0; h < hits.length; h++ ) {
            escaped.push( selectors[ k ] );
        }
        // Mixed fixture: every match must sit inside the wrapper.
        hits = mixedDoc.querySelectorAll( selectors[ k ] );
        for ( h = 0; h < hits.length; h++ ) {
            if ( !hits[ h ].closest( '.hbw-brew' ) ) {
                escaped.push( selectors[ k ] );
            }
        }
    }

    ok( escaped.length === 0,
        'no-leak: no theme rule matches outside .hbw-brew (' + escaped.join( ' | ' ) + ')' );
    ok( doc.querySelectorAll( '.hbw-brew' ).length === 0,
        'no-leak: the non-brew fixture has no brew wrapper at all' );
}() );

// --- E3S3 T1: table contents render through the pipeline ---
( function () {
    var source = '# Tables\n\n'
        + '| Roll | Result |\n|------|--------|\n| 1-5  | Nothing |\n| 6    | Something |\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var table = rendered ? rendered.querySelector( 'table' ) : null;
    var headers = table ? table.querySelectorAll( 'th' ) : [];
    var cells = table ? table.querySelectorAll( 'td' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( rendered && hostOf( page ).getAttribute( 'data-hbw-renderer' ) === 'homebrewery-3.21.0',
        'tables: pinned renderer is in use' );
    ok( !!table, 'tables: table element emitted' );
    ok( headers.length === 2 && headers[0].textContent === 'Roll' &&
        headers[1].textContent === 'Result',
        'tables: header row content preserved' );
    ok( cells.length === 4 && cells[3].textContent === 'Something',
        'tables: body rows and cells preserved' );
    ok( text.indexOf( '| Roll' ) === -1, 'tables: no raw table markup leaks' );
    ok( page.errors.length === 0, 'tables: no console errors' );
}() );

// --- E3S3 T2: every page footer shows its computed page number ---
( function () {
    var source = 'First page.\n\n\\page\n\nSecond page.\n\n\\page\n\nThird page.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var pages = rendered ? rendered.querySelectorAll( '.page' ) : [];
    var numbers = rendered ? rendered.querySelectorAll( '.page > .pageNumber' ) : [];

    ok( pages.length === 3, 'page numbers: three pages' );
    ok( numbers.length === 3, 'page numbers: one .pageNumber per page' );
    ok( numbers.length === 3 &&
        /(^|\s)auto(\s|$)/.test( numbers[ 0 ].className ) &&
        /(^|\s)auto(\s|$)/.test( numbers[ 1 ].className ) &&
        /(^|\s)auto(\s|$)/.test( numbers[ 2 ].className ),
        'page numbers: each uses the upstream auto counter class' );
    ok( numbers.length === 3 &&
        pages[0].lastChild === numbers[0] &&
        pages[1].lastChild === numbers[1] &&
        pages[2].lastChild === numbers[2],
        'page numbers: each .pageNumber closes its own page' );
    ok( pages.length === 3 && !rendered.querySelector( '.hbw-page-footer' ),
        'page numbers: no legacy footer blocks remain' );
    ok( page.errors.length === 0, 'page numbers: no console errors' );
}() );

// --- E3S3 T3: footnote references resolve to their notes ---
( function () {
    var source = 'A claim with a footnote.[^1] Later on the same page.[^2]\n\n'
        + 'An undefined marker [^nope] stays plain.\n\n'
        + '[^1]: The **first** note.\n\n'
        + '[^2]: The second note, continued\n  on another line.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( refs.length === 2, 'footnotes: both defined references link' );
    ok( refs.length === 2 &&
        refs[0].getAttribute( 'href' ) === '#hbw-fn-1-1' &&
        refs[1].getAttribute( 'href' ) === '#hbw-fn-1-2',
        'footnotes: reference links point at their page-scoped notes' );
    ok( notes.length === 2, 'footnotes: two notes emitted' );
    ok( notes.length === 2 &&
        notes[0].getAttribute( 'id' ) === 'hbw-fn-1-1' &&
        notes[1].getAttribute( 'id' ) === 'hbw-fn-1-2',
        'footnotes: notes carry page-scoped linkable ids in reference order' );
    ok( notes.length === 2 &&
        !!notes[0].querySelector( 'strong' ) &&
        notes[1].textContent.indexOf( 'another line' ) !== -1,
        'footnotes: note bodies render (markdown + continuations)' );
    ok( notes.length === 2 &&
        !!notes[0].querySelector( 'a.hbw-footnote-back' ) &&
        notes[0].querySelector( 'a.hbw-footnote-back' )
            .getAttribute( 'href' ) === '#hbw-fnref-1-1',
        'footnotes: notes link back to their references' );
    ok( text.indexOf( '[^1]:' ) === -1 && text.indexOf( '[^2]:' ) === -1,
        'footnotes: definition syntax never renders as body text' );
    ok( text.indexOf( '[^nope]' ) !== -1,
        'footnotes: undefined references stay plain text' );
    ok( page.errors.length === 0, 'footnotes: no console errors' );
}() );

// --- E3S3 T3: footnote definitions resolve across pages ---
( function () {
    var source = 'First page refs one.[^a]\n\n'
        + '\\page\n\n'
        + 'Second page refs two.[^b]\n\n'
        + '[^a]: Note from page one.\n\n'
        + '[^b]: Note from page two.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var pages = rendered ? rendered.querySelectorAll( '.page' ) : [];

    ok( pages.length === 2, 'cross-page footnotes: two pages' );
    ok( pages.length === 2 &&
        !!pages[0].querySelector( 'a[href="#hbw-fn-1-a"]' ) &&
        !!pages[0].querySelector( '#hbw-fn-1-a' ) &&
        !!pages[1].querySelector( 'a[href="#hbw-fn-2-b"]' ) &&
        !!pages[1].querySelector( '#hbw-fn-2-b' ),
        'cross-page footnotes: each page links and lists its own notes' );
    ok( pages.length === 2 &&
        !pages[0].querySelector( '#hbw-fn-2-b' ) &&
        !pages[1].querySelector( '#hbw-fn-1-a' ),
        'cross-page footnotes: no note id is shared across pages' );
    ok( page.errors.length === 0, 'cross-page footnotes: no console errors' );
}() );

// --- E3S3 review: separator-significant labels render without crashing ---
( function () {
    // NOTE: a matching reference/definition pair with literal parentheses in
    // the label cannot be written as a fixture: the HTML placeholder decodes
    // entities like &#40; before the extension runs, so the module can never
    // tell a defended label from an undefended one.  Cover the crash path
    // with the dotted label (. is selector-significant after encoding).
    var source = 'A tricky label.[^n.1] And a repeated one.[^n.1]\n\n'
        + '[^n.1]: Dotted label note.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var doc = page.win.document;
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];

    ok( !doc.getElementById( 'hbw-source' ), 'odd labels: source consumed' );
    ok( refs.length === 2, 'odd labels: both references link' );
    ok( notes.length === 1, 'odd labels: one note emitted' );
    ok( refs.length === 2 &&
        rendered.querySelector( '[href="#hbw-fn-1-n.1"]' ) &&
        refs[1].hasAttribute( 'id' ) === false &&
        notes[0].textContent.indexOf( 'Dotted' ) !== -1,
        'odd labels: dotted label resolves end to end, repeat id-free' );
    ok( page.errors.length === 0, 'odd labels: no console errors' );
}() );

// --- E3S3 review: code before prose, tagged fences, inline code ---
( function () {
    var source = '```markdown\n[^a]: inside a tagged fence\n```\n\n'
        + 'Real prose cites alpha.[^b]\n\n'
        + 'Inline `code [^c]` stays literal.\n\n'
        + '[^a]: the fence note.\n\n'
        + '[^b]: the alpha note.\n\n'
        + '[^c]: inline code is not a reference.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( refs.length === 1, 'code skipping: only the prose reference links' );
    ok( refs.length === 1 &&
        refs[0].getAttribute( 'href' ) === '#hbw-fn-1-b',
        'code skipping: the prose marker keeps its note, not the fence one' );
    ok( notes.length === 1 &&
        notes[0].getAttribute( 'id' ) === 'hbw-fn-1-b' &&
        notes[0].textContent.indexOf( 'alpha' ) !== -1,
        'code skipping: one note, the right one' );
    ok( text.indexOf( '[^a]: inside a tagged fence' ) !== -1,
        'code skipping: tagged fence content renders untouched' );
    ok( text.indexOf( 'code [^c]' ) !== -1,
        'code skipping: inline code renders untouched' );
    ok( text.indexOf( '[^b]: the alpha note' ) === -1,
        'code skipping: the real definition never renders as body text' );
    ok( page.errors.length === 0, 'code skipping: no console errors' );
}() );

// --- E3S3 review: definitions inside fenced code are sample text, not notes ---
( function () {
    var source = 'Before the fence.[^demo]\n\n'
        + '```\n[^demo]: example\n```\n\n'
        + '[^demo]: The real note.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( notes.length === 1, 'fenced definitions: one note emitted' );
    ok( notes.length === 1 &&
        notes[0].textContent.indexOf( 'The real note' ) !== -1,
        'fenced definitions: the prose definition wins, not the code sample' );
    ok( text.indexOf( '[^demo]: example' ) !== -1,
        'fenced definitions: fenced text renders untouched' );
    ok( page.errors.length === 0, 'fenced definitions: no console errors' );
}() );

// --- E3B1 review: every span on a line is code, not just the first ---
( function () {
    var source = 'Text `a` and `[^b]` here, prose cites beta.[^b]\n\n'
        + '[^b]: beta note.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( refs.length === 1 && refs[ 0 ].getAttribute( 'href' ) === '#hbw-fn-1-b',
        'two spans: only the prose reference links' );
    ok( notes.length === 1, 'two spans: one note emitted' );
    ok( text.indexOf( '[^b]' ) !== -1,
        'two spans: the code span renders its brackets literally' );
    ok( text.indexOf( 'hbw-footnote-mark' ) === -1,
        'two spans: no marker leaked as code text' );
    ok( page.errors.length === 0, 'two spans: no console errors' );
}() );

// --- E3B1 review: a double-backtick span is one span, not two ---
( function () {
    var source = 'Has ``a ` [^b]`` span, prose cites beta.[^b]\n\n'
        + '[^b]: beta note.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];

    ok( refs.length === 1 && refs[ 0 ].getAttribute( 'href' ) === '#hbw-fn-1-b',
        'double backticks: only the prose reference links' );
    ok( notes.length === 1, 'double backticks: one note emitted' );
    ok( page.errors.length === 0, 'double backticks: no console errors' );
}() );

// --- E3B1 follow-up: a marker the renderer destroys must not shift pairing ---
( function () {
    var source = 'Prose cites one.[^one]\n\n'
        + '    indented code cites two[^two]\n\n'
        + 'Prose cites three.[^three]\n\n'
        + '[^one]: note one.\n\n'
        + '[^two]: note two.\n\n'
        + '[^three]: note three.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];

    // The renderer escapes the indented line's marker into <pre><code>
    // text, so two links survive; ordinal pairing keeps three -> three
    // instead of three -> two.
    ok( refs.length === 2, 'destroyed marker: two references link' );
    ok( refs.length === 2 && refs[ 0 ].getAttribute( 'href' ) === '#hbw-fn-1-one',
        'destroyed marker: first link keeps its label' );
    ok( refs.length === 2 && refs[ 1 ].getAttribute( 'href' ) === '#hbw-fn-1-three',
        'destroyed marker: later link keeps its label, not the shifted one' );
    ok( notes.length === 3, 'destroyed marker: all three notes are still listed' );
    ok( page.errors.length === 0, 'destroyed marker: no console errors' );
}() );

// --- E3B1: a definition may contain inline code without losing its body ---
( function () {
    var source = 'Cites alpha.[^a]\n\n'
        + '[^a]: uses `code` inline.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];

    ok( refs.length === 1 && refs[0].getAttribute( 'href' ) === '#hbw-fn-1-a',
        'code in note: prose reference links its note' );
    ok( notes.length === 1, 'code in note: one note emitted' );
    ok( notes.length === 1 && notes[0].textContent.indexOf( 'uses' ) !== -1 &&
        notes[0].textContent.indexOf( 'code' ) !== -1,
        'code in note: note body keeps prose and code text' );
    ok( page.errors.length === 0, 'code in note: no console errors' );
}() );

// --- E3B1: an unclosed fence runs to the end of the page ---
( function () {
    var source = 'Before.[^a]\n\n'
        + '```\n'
        + 'still code [^b]\n'
        + '[^b]: not a note\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( refs.length === 0, 'unclosed fence: no reference in prose, so none links' );
    ok( notes.length === 0, 'unclosed fence: code definition is not a note' );
    ok( text.indexOf( 'still code [^b]' ) !== -1,
        'unclosed fence: code body renders' );
    // The pinned renderer itself drops a trailing definition-shaped line in
    // an unclosed fence at EOF; a closed fence keeps it (covered above).
    ok( page.errors.length === 0, 'unclosed fence: no console errors' );
}() );

// --- E3B1 follow-up: a fence inside a note stays in the note ---
( function () {
    var source = 'Prose cites alpha.[^a]\n\n'
        + '[^a]: see this\n'
        + '  ```\n'
        + '  code sample\n'
        + '  ```\n'
        + '  more text\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];
    var columns = rendered ? rendered.querySelectorAll( '.columnWrapper pre' ) : [];
    var noteHtml = notes.length ? notes[ 0 ].innerHTML : '';

    ok( refs.length === 1 && refs[ 0 ].getAttribute( 'href' ) === '#hbw-fn-1-a',
        'note fence: prose reference links its note' );
    ok( notes.length === 1, 'note fence: one note emitted' );
    ok( notes.length === 1 &&
        notes[ 0 ].textContent.indexOf( 'see this' ) !== -1 &&
        notes[ 0 ].textContent.indexOf( 'code sample' ) !== -1 &&
        notes[ 0 ].textContent.indexOf( 'more text' ) !== -1,
        'note fence: the whole block and its text live in the note' );
    ok( columns.length === 0, 'note fence: no stray code block in the page body' );
    ok( noteHtml.indexOf( 'pre' ) !== -1,
        'note fence: the code sample renders as code inside the note' );
    ok( page.errors.length === 0, 'note fence: no console errors' );
}() );

// --- E3B1 follow-up: an unindented fence closes the note ---
( function () {
    var source = 'Prose cites alpha.[^a]\n\n'
        + '[^a]: a note\n\n'
        + '```js\n'
        + 'page code\n'
        + '```\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var refs = rendered ? rendered.querySelectorAll( 'a.hbw-footnote-ref' ) : [];
    var notes = rendered ? rendered.querySelectorAll( '.hbw-footnotes-list li.hbw-footnote' ) : [];
    var bodyPre = rendered ? rendered.querySelectorAll( '.columnWrapper pre' ) : [];

    ok( refs.length === 1 && refs[ 0 ].getAttribute( 'href' ) === '#hbw-fn-1-a',
        'unindented fence: prose reference links its note' );
    ok( notes.length === 1 && notes[ 0 ].textContent.indexOf( 'a note' ) !== -1,
        'unindented fence: the note keeps its own body' );
    ok( notes.length === 1 && notes[ 0 ].textContent.indexOf( 'page code' ) === -1,
        'unindented fence: the page fence does not join the note' );
    ok( bodyPre.length === 1 && bodyPre[ 0 ].textContent.indexOf( 'page code' ) !== -1,
        'unindented fence: the fence stays in the page body' );
    ok( page.errors.length === 0, 'unindented fence: no console errors' );
}() );

// --- E3S3 T2: data-* hygiene on the hardened tree ---
( function () {
    var source = '<div data-evil="1" data-hbw-footnote="kept">content</div>\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = renderRoot( page );
    var divs = rendered ? rendered.querySelectorAll( 'div[data-evil]' ) : [];

    ok( !!rendered, 'data hygiene: content rendered' );
    ok( divs.length === 0, 'data hygiene: author data-* attributes are stripped' );
    ok( page.errors.length === 0, 'data hygiene: no console errors' );
}() );

// --- E3.5S3 T1-T3: wiki links, categories, files become rendered output ---
( function () {
    var base = 'http://wiki.example.test/index.php?title=';
    var files = {
        'Name.png': {
            url: 'http://wiki.example.test/images/Name.png',
            exists: true
        },
        'Absent.png': { url: '', exists: false }
    };
    var source = '# Wiki\n\n'
        + 'See [[Page]] and [[Page Two|Second Page]].\n\n'
        + '[[Category:E35 Test]]\n\n'
        + '[[File:Name.png|alt text|caption|200px]]\n\n'
        + '[[File:Absent.png|missing alt]]\n\n'
        + '```\n[[Code Page]]\n```\n';
    var page = makePage( source, {
        withHomebrewery: true,
        wikiBase: base,
        files: files
    } );
    var rendered = renderRoot( page );
    var links = rendered ? rendered.querySelectorAll( 'a' ) : [];
    var label = rendered ? rendered.querySelector( 'a[href="' + base + 'Page_Two"]' ) : null;
    var img = rendered ? rendered.querySelector( 'img[alt="alt text"]' ) : null;
    var missing = rendered ? rendered.querySelector( '.hbw-missing-file' ) : null;
    var text = rendered ? rendered.textContent : '';
    var hrefs = [];
    var i;

    for ( i = 0; i < links.length; i++ ) {
        hrefs.push( links[ i ].getAttribute( 'href' ) );
    }

    ok( hrefs.indexOf( base + 'Page' ) !== -1,
        'wiki tokens: [[Page]] becomes a same-wiki link' );
    ok( !!label && label.textContent === 'Second Page',
        'wiki tokens: [[Page Two|label]] keeps its label' );
    ok( hrefs.indexOf( base + 'Page_Two' ) !== -1,
        'wiki tokens: spaces in the target become underscores' );
    ok( text.indexOf( 'Category:' ) === -1 &&
        hrefs.join( ' ' ).indexOf( 'E35_Test' ) === -1,
        'wiki tokens: [[Category:...]] produces no content' );
    ok( !!img && img.getAttribute( 'src' ) === files[ 'Name.png' ].url,
        'wiki tokens: [[File:...]] uses the server file map URL' );
    ok( !!img && img.getAttribute( 'alt' ) === 'alt text',
        'wiki tokens: file alt argument wins' );
    ok( !!img && /^width:\s*200px;\s*height:\s*auto$/.test(
        img.getAttribute( 'style' )
    ), 'wiki tokens: numeric file argument sizes the image' );
    ok( !!missing && missing.getAttribute( 'title' ) === 'Missing file: Absent.png' &&
        missing.textContent === '[File: Absent.png]',
        'wiki tokens: missing file renders a visible placeholder' );
    ok( text.indexOf( '[[Code Page]]' ) !== -1 &&
        hrefs.indexOf( base + 'Code_Page' ) === -1,
        'wiki tokens: fenced code stays literal' );
    ok( page.errors.length === 0, 'wiki tokens: no console errors' );
}() );

// PRODUCT BUG (E3.5S3T1): the wiki pass walks fenced blocks but not inline
// backtick spans, so `[[Page]]` inside inline code is rewritten before
// markdown sees it. The assertion below is intentionally left in place.
( function () {
    var base = 'http://wiki.example.test/index.php?title=';
    var source = 'Inline `[[Page]]` stays literal.\n\n'
        + 'Outside [[Page]] links.\n';
    var page = makePage( source, { withHomebrewery: true, wikiBase: base } );
    var rendered = renderRoot( page );
    var code = rendered ? rendered.querySelector( 'code' ) : null;
    var links = rendered ? rendered.querySelectorAll( 'a' ) : [];

    ok( !!code && code.textContent === '[[Page]]',
        'wiki tokens: inline code stays literal' );
    ok( links.length === 1,
        'wiki tokens: only the prose token becomes a link' );
    ok( page.errors.length === 0, 'wiki tokens: inline code has no console errors' );
}() );

// --- E3.5S3 T2: no wiki base leaves the token literal ---
( function () {
    var page = makePage( 'See [[Page]] and [[Page Two|label]] here.\n' );
    var rendered = renderRoot( page );
    var text = rendered ? rendered.textContent : '';
    var links = rendered ? rendered.querySelectorAll( 'a' ) : [];

    ok( text.indexOf( '[[Page]]' ) !== -1 &&
        text.indexOf( '[[Page Two|label]]' ) !== -1,
        'wiki tokens: absent base leaves tokens literal' );
    ok( links.length === 0,
        'wiki tokens: absent base creates no anchors' );
    ok( page.errors.length === 0, 'wiki tokens: absent base has no console errors' );
}() );

// --- E3.5S3 T2: every rendered anchor targets the top document ---
( function () {
    var base = 'http://wiki.example.test/index.php?title=';
    var source = '# Links\n\n'
        + '[Example](http://wiki.example.test/wiki/Example)\n\n'
        + '[[Other Page]]\n';
    var page = makePage( source, { withHomebrewery: true, wikiBase: base } );
    var rendered = renderRoot( page );
    var links = rendered ? rendered.querySelectorAll( 'a' ) : [];
    var hardened = 0;
    var i;

    for ( i = 0; i < links.length; i++ ) {
        if ( links[ i ].getAttribute( 'target' ) === '_top' &&
            links[ i ].getAttribute( 'rel' ) === 'noopener noreferrer' ) {
            hardened++;
        }
    }

    ok( links.length === 2, 'anchors: markdown and wiki links both render' );
    ok( links.length === 2 && hardened === links.length,
        'anchors: every link gets target=_top and rel=noopener noreferrer' );
    ok( page.errors.length === 0, 'anchors: no console errors' );
}() );

// --- E3.5S4 T1/T2: page stack fits the host pane ---
( function () {
    var source = '# Fit\n\nbody text\n';
    var page = makePage( source );
    var frame = frameOf( page );
    var doc = frameDocOf( page );
    var style = doc ? doc.getElementById( 'hbw-fit' ) : null;
    var widthMatch = style ? /\.pages\s*\{[^}]*width:\s*([0-9.]+)px/.exec(
        style.textContent
    ) : null;
    var scale = frame ? parseFloat( frame.getAttribute( 'data-hbw-scale' ) ) : NaN;
    var height = frame ? parseFloat( frame.style.height ) : 0;

    ok( !!style, 'fit: #hbw-fit rule exists inside the frame' );
    ok( !!widthMatch && Math.abs( parseFloat( widthMatch[ 1 ] ) - 816 ) < 1,
        'fit: .pages keeps the true letter width' );
    ok( !!style && style.textContent.indexOf( 'transform:scale(' ) !== -1 &&
        style.textContent.indexOf( 'transform-origin:top left' ) !== -1,
        'fit: rule scales from the top-left corner' );
    ok( !!frame && frame.getAttribute( 'data-hbw-scale' ) !== null,
        'fit: frame reports data-hbw-scale' );
    ok( !isNaN( scale ) && Math.abs( scale - 1 ) < 0.01,
        'fit: wide host uses scale 1 (got ' + scale + ')' );
    ok( height > 0, 'fit: frame height follows the page stack (got ' + height + ')' );
    ok( page.errors.length === 0, 'fit: no console errors' );
}() );

// --- E3.5S4 T2: a narrow host scales the pane below 1 ---
( function () {
    var source = '# Narrow\n\nbody text\n';
    var widePage = makePage( source );
    var narrowPage = makePage( source, { clientWidth: 408 } );
    var wideFrame = frameOf( widePage );
    var narrowFrame = frameOf( narrowPage );
    var wideScale = wideFrame ? parseFloat( wideFrame.getAttribute( 'data-hbw-scale' ) ) : NaN;
    var narrowScale = narrowFrame ? parseFloat( narrowFrame.getAttribute( 'data-hbw-scale' ) ) : NaN;
    var wideHeight = wideFrame ? parseFloat( wideFrame.style.height ) : 0;
    var narrowHeight = narrowFrame ? parseFloat( narrowFrame.style.height ) : 0;

    ok( !isNaN( narrowScale ) && Math.abs( narrowScale - 0.5 ) < 0.01,
        'fit narrow: 408px host scales to ~0.5 (got ' + narrowScale + ')' );
    ok( wideHeight > 0 && narrowHeight > 0,
        'fit narrow: both frames have a positive height' );
    ok( wideHeight > 0 && narrowHeight > 0 &&
        Math.abs( ( narrowHeight / wideHeight ) - 0.5 ) < 0.05,
        'fit narrow: frame height is roughly half the natural stack' );
    ok( widePage.errors.length === 0 && narrowPage.errors.length === 0,
        'fit narrow: no console errors' );
}() );

// --- E3.5S4 T3/T4: print route is unscaled and triggers window.print ---
( function () {
    var page = makePage( '# Print\n\nbody text\n', {
        print: true,
        immediateTimers: true
    } );
    var frame = frameOf( page );
    var doc = page.win.document;
    var frameDoc = frameDocOf( page );
    var style = frameDoc ? frameDoc.getElementById( 'hbw-fit' ) : null;
    var scale = frame ? frame.getAttribute( 'data-hbw-scale' ) : null;
    var width = frame ? parseFloat( frame.style.width ) : 0;

    ok( scale === '1', 'print: print route keeps scale 1' );
    ok( !!style && style.textContent.indexOf( '.page{margin:0;}' ) !== -1,
        'print: pages lose their screen margins' );
    ok( /\bhbw-print-mode\b/.test( doc.body.className ),
        'print: body carries hbw-print-mode' );
    ok( Math.round( width ) === 816,
        'print: iframe is pinned to the letter width (got ' + width + ')' );
    ok( page.win.__printCount === 1,
        'print: window.print() runs once (got ' + page.win.__printCount + ')' );
    ok( page.errors.length === 0, 'print: no console errors' );
}() );

// --- ES5 floor (Q19): module source stays ES5 ---
ok( !/(=>|\bconst\b|\blet\b|\bclass\s)/.test( renderSource ),
    'ES5: render module uses no ES6 syntax' );


// --- E3.5S6: iframe security profile ---
( function () {
    var shell = fs.readFileSync(
        path.join( root, 'HomebreweryWiki.shell.html' ), 'utf8'
    );
    var page;
    var frame;
    var doc;
    var host;
    var anchors;
    var i;

    ok( /Content-Security-Policy/.test( shell ) &&
        /default-src 'none'/.test( shell ),
        'security: shell CSP denies everything by default' );
    ok( /img-src 'self' data:/.test( shell ),
        'security: shell CSP allows same-origin images only' );
    ok( /font-src 'self'/.test( shell ) && /style-src 'self'/.test( shell ),
        'security: shell CSP scopes fonts/styles to the same origin' );
    ok( !/<script/i.test( shell ),
        'security: shell contains no script element' );

    page = makePage( fs.readFileSync(
        path.join( root, 'tests', 'fixtures', 'attack-brew.md' ), 'utf8'
    ), { withHomebrewery: true } );
    frame = frameOf( page );
    doc = frameDocOf( page );
    host = hostOf( page );

    ok( !!frame && frame.getAttribute( 'sandbox' ) ===
        'allow-same-origin allow-top-navigation-by-user-activation',
        'security: iframe sandbox is same-origin + user-activated top nav' );
    ok( !!frame && frame.getAttribute( 'sandbox' ).indexOf( 'allow-scripts' ) === -1,
        'security: iframe sandbox never allows scripts' );
    ok( !!frame && /camera 'none'/.test( frame.getAttribute( 'allow' ) || '' ),
        'security: iframe permissions policy denies device features' );
    ok( !!frame && frame.getAttribute( 'referrerpolicy' ) === 'no-referrer',
        'security: iframe sends no referrer' );

    ok( !!doc && !doc.querySelector( 'script, meta, base, form, iframe, object, embed' ),
        'security: active elements are stripped inside the iframe' );
    // The only style element is the parent's fit rule; the only link is the
    // configured theme. Nothing else can be injected.
    ok( !!doc && doc.querySelectorAll( 'style' ).length === 1 &&
        doc.querySelector( 'style' ).id === 'hbw-fit',
        'security: only the parent fit rule is present' );
    ok( !!doc && doc.querySelectorAll( 'link[rel="stylesheet"]' ).length <= 1,
        'security: at most the configured theme stylesheet is linked' );
    ok( !!doc && !doc.querySelector( 'svg' ),
        'security: inline SVG is stripped inside the iframe' );

    // Author-supplied targets are overridden: the brew cannot choose where it
    // navigates, and it cannot navigate the frame on its own.
    anchors = doc ? doc.querySelectorAll( 'a' ) : [];
    i = 0;
    while ( i < anchors.length && anchors[ i ].getAttribute( 'target' ) === '_top' ) {
        i++;
    }
    ok( anchors.length > 0 && i === anchors.length,
        'security: every anchor is forced to target=_top (' + anchors.length + ')' );

    // No user HTML in the parent: only the frame remains after render.
    ok( !!host && !host.querySelector( '.page, .brewRenderer, img, script' ),
        'security: parent host holds no rendered user HTML' );
    ok( !!host && host.getAttribute( 'data-hbw-render' ) === 'html',
        'security: render path is the iframe path' );

    // External images stay blocked inside the frame.
    ok( !!doc && !doc.querySelector( 'img[src^="http://evil"], img[src^="https://evil"]' ),
        'security: external image sources are stripped in the iframe' );
    ok( page.errors.length === 0,
        'security: hostile brew raises no console errors' );
}() );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail > 0 ? 1 : 0 );
