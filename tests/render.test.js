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

// --- E3S2 T1: the pinned Homebrewery renderer produces the output ---
( function () {
    var source = '# Brew Title\n\nA paragraph with **bold** text.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var heading = rendered ? rendered.querySelector( 'h1' ) : null;

    ok( typeof page.win.HomebreweryRenderer === 'object',
        'pinned: bundle defines HomebreweryRenderer' );
    ok( !!rendered && rendered.getAttribute( 'data-hbw-renderer' ) === 'homebrewery-3.21.0',
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );

    ok( !!rendered && rendered.getAttribute( 'data-hbw-renderer' ) === 'homebrewery-3.21.0',
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var pages = rendered ? rendered.querySelectorAll( '.hbw-page' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( pages.length === 3, 'aliases: \\pagebreak and \\page both split pages' );
    ok( pages.length === 3 && pages[1].querySelectorAll( '.hbw-column' ).length === 2,
        'aliases: \\columnbreak starts a new column' );
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
    var rendered = doc.getElementById( 'hbw-brew-rendered' );

    ok( !!rendered, 'pinned throw: content still rendered' );
    ok( !!rendered && rendered.getAttribute( 'data-hbw-renderer' ) === 'marked-0.3.19',
        'pinned throw: marked fallback is reported' );
    ok( !!rendered && !!rendered.querySelector( 'h1' ),
        'pinned throw: fallback produced the heading' );
    ok( page.errors.length === 0, 'pinned throw: no console errors' );
}() );

// --- E3S2 review: one render per page keeps variables across columns ---
( function () {
    var source = '[str]: 18\n\n# Stats\n\nSTR $[str]\n\n\\columnbreak\n\nAgain $[str]\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var pages = rendered ? rendered.querySelectorAll( '.hbw-page' ) : [];
    var columns = pages.length ? pages[0].querySelectorAll( '.hbw-column' ) : [];

    ok( columns.length === 2, 'page state: column break made two columns' );
    ok( columns.length === 2 && columns[0].textContent.indexOf( '18' ) !== -1,
        'page state: first column resolves the variable' );
    ok( columns.length === 2 && columns[1].textContent.indexOf( '18' ) !== -1,
        'page state: second column still resolves the variable' );
    ok( page.errors.length === 0, 'page state: no console errors' );
}() );

// --- Degraded path still reports the fallback renderer when the bundle is absent ---
( function () {
    var page = makePage( '# Title\n\nbody\n' );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );

    ok( !!rendered && rendered.getAttribute( 'data-hbw-renderer' ) === 'marked-0.3.19',
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
    var i;
    var leakedAtRule;

    for ( i = 0; i < selectors.length; i++ ) {
        if ( selectors[ i ] && selectors[ i ].indexOf( '.hbw-brew' ) !== 0 ) {
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
    ok( !/#hbw-/.test( themeSource ), 'theme: scoping uses the wrapper class, not ids' );
}() );

// --- E3S2 T3: side-by-side structure matches the raw Homebrewery output ---
( function () {
    var source = '# Reference\n\n'
        + '<div class="note">\n\nA **note** body.\n\n</div>\n\n'
        + '| a | b |\n|---|---|\n| 1 | 2 |\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var column = rendered ? rendered.querySelector( '.hbw-page .hbw-column' ) : null;
    var raw = page.win.HomebreweryRenderer.render( source, 0 );
    var box = page.win.document.createElement( 'div' );

    box.innerHTML = raw;

    /**
     * Flatten an element tree to `depth:tag.class>…` for comparison.
     *
     * @param {HTMLElement} node Root to walk.
     * @return {string} Structure signature.
     */
    function structure( node ) {
        var nodes = node.querySelectorAll( '*' );
        var out = [];
        var i;
        var classes;
        var depth;
        var parent;
        for ( i = 0; i < nodes.length; i++ ) {
            classes = nodes[ i ].className
                ? '.' + String( nodes[ i ].className ).split( /\s+/ ).join( '.' )
                : '';
            depth = 0;
            parent = nodes[ i ].parentNode;
            while ( parent && parent !== node ) {
                depth++;
                parent = parent.parentNode;
            }
            out.push( depth + ':' + nodes[ i ].nodeName.toLowerCase() + classes );
        }
        return out.join( '>' );
    }

    ok( !!column, 'side-by-side: our pane renders the reference brew' );
    ok( !!column && structure( column ) === structure( box ),
        'side-by-side: element structure matches Homebrewery' );
    ok( !!column && column.textContent === box.textContent,
        'side-by-side: text content matches Homebrewery' );
    ok( page.errors.length === 0, 'side-by-side: no console errors' );
}() );

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
            var doc = page.win.document;
            var rendered = doc.getElementById( 'hbw-brew-rendered' );
            var styled = rendered ? rendered.querySelector( 'div[style]' ) : null;
            var value = '';
            if ( styled && page.win.getComputedStyle ) {
                value = page.win.getComputedStyle( styled ).getPropertyValue( spec.prop );
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
        + '<div class="hbw-brew"><div class="hbw-page"><div class="hbw-column">'
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var table = rendered ? rendered.querySelector( 'table' ) : null;
    var headers = table ? table.querySelectorAll( 'th' ) : [];
    var cells = table ? table.querySelectorAll( 'td' ) : [];
    var text = rendered ? rendered.textContent : '';

    ok( rendered && rendered.getAttribute( 'data-hbw-renderer' ) === 'homebrewery-3.21.0',
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var pages = rendered ? rendered.querySelectorAll( '.hbw-page' ) : [];
    var footers = rendered ? rendered.querySelectorAll( '.hbw-page-footer' ) : [];

    ok( pages.length === 3, 'page numbers: three pages' );
    ok( footers.length === 3, 'page numbers: one footer per page' );
    ok( footers.length === 3 &&
        footers[0].textContent === '1' &&
        footers[1].textContent === '2' &&
        footers[2].textContent === '3',
        'page numbers: footers read 1, 2, 3 in document order' );
    ok( footers.length === 3 &&
        pages[0].lastChild === footers[0] &&
        pages[1].lastChild === footers[1] &&
        pages[2].lastChild === footers[2],
        'page numbers: each footer closes its own page' );
    ok( page.errors.length === 0, 'page numbers: no console errors' );
}() );

// --- E3S3 T3: footnote references resolve to their notes ---
( function () {
    var source = 'A claim with a footnote.[^1] Later on the same page.[^2]\n\n'
        + 'An undefined marker [^nope] stays plain.\n\n'
        + '[^1]: The **first** note.\n\n'
        + '[^2]: The second note, continued\n  on another line.\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var pages = rendered ? rendered.querySelectorAll( '.hbw-page' ) : [];

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
    var rendered = doc.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
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

// --- E3S3 T2: data-* hygiene on the hardened tree ---
( function () {
    var source = '<div data-evil="1" data-hbw-footnote="kept">content</div>\n';
    var page = makePage( source, { withHomebrewery: true } );
    var rendered = page.win.document.getElementById( 'hbw-brew-rendered' );
    var divs = rendered ? rendered.querySelectorAll( 'div[data-evil]' ) : [];

    ok( !!rendered, 'data hygiene: content rendered' );
    ok( divs.length === 0, 'data hygiene: author data-* attributes are stripped' );
    ok( page.errors.length === 0, 'data hygiene: no console errors' );
}() );

// --- ES5 floor (Q19): module source stays ES5 ---
ok( !/(=>|\bconst\b|\blet\b|\bclass\s)/.test( renderSource ),
    'ES5: render module uses no ES6 syntax' );

console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
process.exit( fail > 0 ? 1 : 0 );
