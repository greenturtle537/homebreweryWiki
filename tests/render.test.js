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
 * @param {Object}      options `{ withLibs: false }` omits marked/DOMPurify.
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
        html = '<!doctype html><html><body><div id="content">'
            + '<div class="hbw-brew" id="hbw-brew">'
            + '<div class="hbw-source" id="hbw-source" style="display:none">' + escaped + '</div>'
            + '<noscript><pre class="hbw-brew-text">\n' + escaped + '</pre></noscript>'
            + '</div></div></body></html>';
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

// --- ES5 floor (Q19): module source stays ES5 ---
ok( !/(=>|\bconst\b|\blet\b|\bclass\s)/.test( renderSource ),
    'ES5: render module uses no ES6 syntax' );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail > 0 ? 1 : 0 );
