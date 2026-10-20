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

var root = path.join( __dirname, '..' );
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
 *                              `{ preview: true }` wraps the placeholder in
 *                              EditPage's #wikiPreview container (E1S4).
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
        var placeholder = '<div class="hbw-brew" id="hbw-brew">'
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
        virtualConsole: virtualConsole
    } );
    var win = dom.window;

    if ( options.withLibs !== false ) {
        win.eval( markedSource );
        win.eval( purifySource );
    }
    win.eval( renderSource );

    // The module listens for DOMContentLoaded when readyState is still
    // "loading"; dispatch synchronously so the assertions are deterministic.
    win.document.dispatchEvent( new win.Event( 'DOMContentLoaded', { bubbles: true } ) );

    return { dom: dom, win: win, errors: consoleErrors };
}

// --- T3: headings and paragraphs become real HTML elements ---
( function () {
    var page = makePage( '# Brew Title\n\nA paragraph with **bold** text.\n' );
    var doc = page.win.document;
    var rendered = doc.getElementById( 'hbw-brew-rendered' );

    ok( doc.getElementById( 'hbw-source' ) === null, 'render: hidden source is removed' );
    ok( !!rendered, 'render: rendered container is created' );
    ok( !!rendered && rendered.getAttribute( 'data-hbw-render' ) === 'html',
        'render: html path is reported' );
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
    var rendered = doc.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    ok( !!fallback && fallback.textContent === source,
        'fallback: source text is byte-identical' );
    ok( page.errors.length === 0, 'fallback: no console errors' );
}() );

// --- Non-brew page: module is a no-op ---
( function () {
    var page = makePage( null );
    var doc = page.win.document;

    ok( doc.getElementById( 'hbw-brew-rendered' ) === null, 'non-brew: no render container' );
    ok( doc.getElementById( 'hbw-source' ) === null, 'non-brew: source untouched/absent' );
    ok( doc.body.textContent.indexOf( 'Main page' ) !== -1, 'non-brew: content untouched' );
    ok( page.errors.length === 0, 'non-brew: no console errors' );
}() );

// --- E1S4 T1-T5: preview and saved view share one render path ---
( function () {
    var source = '# Brew Title\n\nA paragraph with **bold** text.\n';
    var viewPage = makePage( source );
    var previewPage = makePage( source, { preview: true } );
    var viewRendered = viewPage.win.document.getElementById( 'hbw-brew-rendered' );
    var previewRendered = previewPage.win.document.getElementById( 'hbw-brew-rendered' );
    var previewArea = previewPage.win.document.getElementById( 'wikiPreview' );

    ok( !!previewRendered, 'preview: rendered container created' );
    ok( !!previewArea && !!previewRendered && previewArea.contains( previewRendered ),
        'preview: rendered inside #wikiPreview' );
    ok( !!previewRendered && !!previewRendered.parentNode &&
        previewRendered.parentNode.id === 'hbw-brew',
        'preview: same .hbw-brew wrapper as the saved view' );
    ok( previewPage.win.document.getElementById( 'hbw-source' ) === null,
        'preview: hidden source removed' );
    ok( !!previewRendered && !!previewRendered.querySelector( 'h1' ),
        'preview: markdown heading rendered' );
    ok( !!previewRendered && previewRendered.getAttribute( 'data-hbw-render' ) === 'html',
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var pages = rendered ? rendered.querySelectorAll( '.hbw-page' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( pages.length === 2, 'split: \\page starts a new page block' );
    ok( pages.length === 2 && pages[1].querySelectorAll( '.hbw-column' ).length === 2,
        'split: \\column starts a new column inside the page' );
    ok( text.indexOf( '\\page' ) === -1, 'split: \\page marker text does not leak' );
    ok( text.indexOf( '\\column' ) === -1, 'split: \\column marker text does not leak' );
    ok( page.errors.length === 0, 'split: no console errors' );
}() );

// --- E3S1 T2: one page block per page, content stays in its own block ---
( function () {
    var source = '# One\n\nfirst\n\n\\page\n\n# Two\n\nsecond\n\n\\page\n\n# Three\n\nthird\n';
    var page = makePage( source );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var pages = rendered ? rendered.querySelectorAll( '.hbw-page' ) : [];

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
        pages[0].getAttribute( 'data-hbw-page' ) === '1' &&
        pages[1].getAttribute( 'data-hbw-page' ) === '2' &&
        pages[2].getAttribute( 'data-hbw-page' ) === '3',
        'pages: blocks keep document order' );
    ok( page.errors.length === 0, 'pages: no console errors' );
}() );

// --- E3S1 T3: the three-page reference brew renders as three blocks ---
( function () {
    var fixture = fs.readFileSync(
        path.join( __dirname, 'fixtures', 'three-page-brew.md' ), 'utf8'
    );
    var page = makePage( fixture );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var pages = rendered ? rendered.querySelectorAll( '.hbw-page' ) : [];
    var headings = [];

    if ( pages.length === 3 ) {
        headings.push( pages[0].querySelector( 'h1' ) ? pages[0].querySelector( 'h1' ).textContent : '' );
        headings.push( pages[1].querySelector( 'h1' ) ? pages[1].querySelector( 'h1' ).textContent : '' );
        headings.push( pages[2].querySelector( 'h1' ) ? pages[2].querySelector( 'h1' ).textContent : '' );
    }

    ok( pages.length === 3, 'reference brew: three page blocks appear' );
    ok( pages.length === 3 && headings[0] === 'The Three-Page Reference Brew' &&
        headings[1] === 'Page Two' && headings[2] === 'Page Three',
        'reference brew: page blocks appear in document order' );
    ok( pages.length === 3 && pages[1].querySelectorAll( '.hbw-column' ).length === 2,
        'reference brew: \\column is preserved inside its page' );
    ok( page.errors.length === 0, 'reference brew: no console errors' );
}() );

// --- ES5 floor (Q19): module source stays ES5 ---
ok( !/(=>|\bconst\b|\blet\b|\bclass\s)/.test( renderSource ),
    'ES5: render module uses no ES6 syntax' );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail > 0 ? 1 : 0 );
