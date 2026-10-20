/**
 * Visual regression baselines for the reference brew (E3S5T2).
 *
 * The jsdom suite proves structure and safety; it cannot prove layout. This
 * script loads the real vendored renderer, render module and theme into
 * headless Chromium, renders `tests/fixtures/three-page-brew.md` through the
 * same placeholder contract the server emits, and checks two things:
 *
 *   1. geometry — page count, letter-size page boxes, no horizontal overflow,
 *      visible page numbers. These are strict and environment-independent.
 *   2. pixels — a tolerant diff against a committed PNG baseline. Font
 *      rasterisation differs between machines, so the threshold is loose
 *      (10% per pixel, 1% of the image) and the baseline is regenerated only
 *      on purpose.
 *
 *   npm run visual          # compare (CI gate)
 *   npm run visual:update   # rewrite baselines, then review the diff
 *
 * Baselines are Linux/Chromium artefacts; regenerate them in the same
 * container the CI job uses if the diff is only font hinting.
 */
'use strict';

var fs = require( 'fs' );
var path = require( 'path' );
var os = require( 'os' );
var chromium = require( 'playwright' ).chromium;
var PNG = require( 'pngjs' ).PNG;
var pixelmatch = require( 'pixelmatch' );

var root = path.join( __dirname, '..', '..' );
var baselineDir = path.join( __dirname, 'baselines' );
var update = process.argv.indexOf( '--update' ) !== -1;

var VIEWPORT = { width: 1280, height: 1024 };
var PIXEL_THRESHOLD = 0.1;
var MAX_DIFF_RATIO = 0.01;

/* The harness serves the real shell and compiled theme over a fake
 * same-origin host, so geometry, fonts and assets are the production path. */

var pass = 0;
var fail = 0;

/**
 * Record one assertion result.
 *
 * @param {boolean} cond Condition that must hold.
 * @param {string} msg  Assertion label.
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
 * Read a repository asset as text.
 *
 * @param {string} rel Path relative to the repo root.
 * @return {string} File contents.
 */
function asset( rel ) {
    return fs.readFileSync( path.join( root, rel ), 'utf8' );
}

/**
 * Escape text for the hidden-source placeholder.
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
 * Compare a screenshot against its baseline, writing a diff on mismatch.
 *
 * @param {Buffer} actual   PNG buffer of the current render.
 * @param {string} name     Baseline file stem.
 * @return {void}
 */
function comparePixels( actual, name ) {
    var baselinePath = path.join( baselineDir, name + '.png' );

    if ( update ) {
        fs.mkdirSync( baselineDir, { recursive: true } );
        fs.writeFileSync( baselinePath, actual );
        ok( true, 'visual: baseline written for ' + name );
        return;
    }

    if ( !fs.existsSync( baselinePath ) ) {
        ok( false, 'visual: missing baseline ' + name + '.png (run npm run visual:update)' );
        return;
    }

    var expected = PNG.sync.read( fs.readFileSync( baselinePath ) );
    var current = PNG.sync.read( actual );

    if ( expected.width !== current.width || expected.height !== current.height ) {
        ok( false, 'visual: ' + name + ' size changed (' +
            expected.width + 'x' + expected.height + ' -> ' +
            current.width + 'x' + current.height + ')' );
        return;
    }

    var diff = new PNG( { width: expected.width, height: expected.height } );
    var changed = pixelmatch(
        expected.data, current.data, diff.data,
        expected.width, expected.height,
        { threshold: PIXEL_THRESHOLD }
    );
    var ratio = changed / ( expected.width * expected.height );

    if ( ratio > MAX_DIFF_RATIO ) {
        var diffPath = path.join( baselineDir, name + '.diff.png' );
        fs.writeFileSync( diffPath, PNG.sync.write( diff ) );
    }

    ok( ratio <= MAX_DIFF_RATIO, 'visual: ' + name + ' pixels within tolerance (' +
        ( ratio * 100 ).toFixed( 3 ) + '% changed)' );
}

/**
 * Render one fixture in Chromium and assert layout + pixels.
 *
 * @param {Object} browser Playwright browser.
 * @param {string} fixture Fixture filename under tests/fixtures.
 * @param {string} name    Baseline stem.
 * @return {Promise<void>} Resolves when assertions are recorded.
 */
async function checkFixture( browser, fixture, name ) {
    var source = fs.readFileSync( path.join( root, 'tests', 'fixtures', fixture ), 'utf8' );
    var escaped = escapeHtml( source );
    var page = await browser.newPage( { viewport: VIEWPORT } );
    var errors = [];

    page.on( 'pageerror', function ( err ) {
        errors.push( String( err ) );
    } );
    page.on( 'console', function ( msg ) {
        if ( msg.type() === 'error' ) {
            errors.push( msg.text() );
        }
    } );

    var harnessHtml =
        '<!doctype html><html><head><meta charset="utf-8">' +
        '<link rel="stylesheet" href="/extensions/HomebreweryWiki/HomebreweryWiki.theme.css">' +
        '</head><body>' +
        '<div id="content"><div class="hbw-brew" id="hbw-brew"' +
        ' data-hbw-shell="/extensions/HomebreweryWiki/HomebreweryWiki.shell.html"' +
        ' data-hbw-theme="/extensions/HomebreweryWiki/vendor/homebrewery-3.21.0/theme/theme.css"' +
        ' data-hbw-page-width="215.9" data-hbw-page-height="279.4">' +
        '<div class="hbw-source" id="hbw-source" style="display:none">' + escaped + '</div>' +
        '<noscript><pre class="hbw-brew-text">\n' + escaped + '</pre></noscript>' +
        '</div></div></body></html>';

    // Serve the repository under a fake same-origin host so the shell URL, the
    // compiled theme and its font/texture URLs all resolve exactly as they do
    // on a wiki install. No network access is used.
    await page.route( 'http://hbw.test/**', function ( route ) {
        var url = new URL( route.request().url() );
        var rel;
        var file;
        var types = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf'
        };
        if ( url.pathname === '/harness.html' ) {
            return route.fulfill( { status: 200, contentType: 'text/html', body: harnessHtml } );
        }
        rel = decodeURIComponent( url.pathname.replace( /^\/extensions\/HomebreweryWiki\//, '' ) );
        file = path.join( root, rel );
        if ( file.indexOf( root ) !== 0 || !fs.existsSync( file ) || fs.statSync( file ).isDirectory() ) {
            return route.fulfill( { status: 404, body: '' } );
        }
        return route.fulfill( {
            status: 200,
            contentType: types[ path.extname( file ).toLowerCase() ] || 'application/octet-stream',
            path: file
        } );
    } );

    await page.goto( 'http://hbw.test/harness.html', { waitUntil: 'load' } );

    await page.addScriptTag( { content: asset( 'vendor/marked-0.3.19.min.js' ) } );
    await page.addScriptTag( { content: asset( 'vendor/dompurify-2.5.8.min.js' ) } );
    await page.addScriptTag( { content: asset( 'vendor/homebrewery-3.21.0/renderer.min.js' ) } );
    await page.addScriptTag( { content: asset( 'HomebreweryWiki.render.js' ) } );

    await page.waitForFunction( function () {
        var frame = document.getElementById( 'hbw-frame' );
        var doc = frame && frame.contentDocument;
        return !!doc && doc.querySelectorAll( '.pages > .page' ).length === 3;
    }, { timeout: 15000 } );

    // Let the theme fonts settle before the screenshot.
    await page.evaluate( async function () {
        var frame = document.getElementById( 'hbw-frame' );
        if ( frame && frame.contentDocument && frame.contentDocument.fonts ) {
            await frame.contentDocument.fonts.ready;
        }
    } );

    var stats = await page.evaluate( function () {
        var host = document.getElementById( 'hbw-brew' );
        var frame = document.getElementById( 'hbw-frame' );
        var doc = frame && frame.contentDocument;
        var pages;
        var numbers;
        if ( !host || !doc ) {
            return null;
        }
        pages = Array.prototype.slice.call(
            doc.querySelectorAll( '.pages > .page' )
        );
        numbers = Array.prototype.slice.call(
            doc.querySelectorAll( '.pages > .page > .pageNumber' )
        );
        return {
            render: host.getAttribute( 'data-hbw-render' ),
            reportedPages: host.getAttribute( 'data-hbw-pages' ),
            pages: pages.length,
            numbers: numbers.length,
            widths: pages.map( function ( p ) {
                return Math.round( p.getBoundingClientRect().width );
            } ),
            heights: pages.map( function ( p ) {
                return Math.round( p.getBoundingClientRect().height );
            } ),
            scrollWidth: doc.documentElement.scrollWidth,
            viewport: doc.documentElement.clientWidth,
            themeLinks: Array.prototype.slice.call(
                doc.querySelectorAll( 'link[rel="stylesheet"]' )
            ).map( function ( l ) { return l.getAttribute( 'href' ); } )
        };
    } );

    ok( !!stats, 'visual ' + name + ': rendered inside the iframe' );
    if ( !stats ) {
        await page.close();
        return;
    }

    ok( stats.render === 'html', 'visual ' + name + ': host reports html' );
    ok( stats.reportedPages === '3',
        'visual ' + name + ': host reports three pages' );
    ok( stats.pages === 3, 'visual ' + name + ': iframe .pages holds three .page blocks' );
    ok( stats.numbers === 3, 'visual ' + name + ': one .pageNumber per page' );
    ok( stats.themeLinks.some( function ( href ) {
        return /vendor\/homebrewery-3\.21\.0\/theme\/theme\.css$/.test( href || '' );
    } ), 'visual ' + name + ': compiled upstream theme is linked inside the iframe' );
    ok( stats.widths.every( function ( w ) {
        return Math.abs( w - 816 ) <= 1;
    } ), 'visual ' + name + ': pages are 215.9mm wide (' +
        stats.widths.join( ',' ) + ')' );
    ok( stats.heights.every( function ( h ) {
        return Math.abs( h - 1056 ) <= 1;
    } ), 'visual ' + name + ': pages are 279.4mm tall (' +
        stats.heights.join( ',' ) + ')' );
    ok( stats.scrollWidth <= stats.viewport,
        'visual ' + name + ': no horizontal overflow (' + stats.scrollWidth +
        ' <= ' + stats.viewport + ')' );
    ok( errors.length === 0, 'visual ' + name + ': no console errors (' +
        errors.join( ' | ' ) + ')' );

    var shot = await page.locator( '#hbw-brew' ).screenshot();
    comparePixels( shot, name );

    await page.close();
}

( async function main() {
    var browser = await chromium.launch();
    try {
        await checkFixture( browser, 'three-page-brew.md', 'three-page-brew' );
    } finally {
        await browser.close();
    }

    console.log( '\n' + pass + ' passed, ' + fail + ' failed' );
    // eslint-disable-next-line no-process-exit
    process.exit( fail > 0 ? 1 : 0 );
}() ).catch( function ( err ) {
    console.error( err );
    process.exit( 1 );
} );
