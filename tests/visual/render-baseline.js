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

    await page.setContent(
        '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
        '<div id="content"><div class="hbw-brew" id="hbw-brew">' +
        '<div class="hbw-source" id="hbw-source" style="display:none">' + escaped + '</div>' +
        '<noscript><pre class="hbw-brew-text">\n' + escaped + '</pre></noscript>' +
        '</div></div></body></html>',
        { waitUntil: 'load' }
    );

    await page.addStyleTag( { content: asset( 'HomebreweryWiki.theme.css' ) } );
    await page.addScriptTag( { content: asset( 'vendor/marked-0.3.19.min.js' ) } );
    await page.addScriptTag( { content: asset( 'vendor/dompurify-2.5.8.min.js' ) } );
    await page.addScriptTag( { content: asset( 'vendor/homebrewery-3.21.0/renderer.min.js' ) } );
    await page.addScriptTag( { content: asset( 'HomebreweryWiki.render.js' ) } );
    await page.evaluate( function () {
        document.dispatchEvent( new Event( 'DOMContentLoaded', { bubbles: true } ) );
    } );

    var stats = await page.evaluate( function () {
        var rendered = document.getElementById( 'hbw-brew-rendered' );
        if ( !rendered ) {
            return null;
        }
        var pages = Array.prototype.slice.call( rendered.querySelectorAll( '.hbw-page' ) );
        var footers = Array.prototype.slice.call(
            rendered.querySelectorAll( '.hbw-page-footer' )
        );
        return {
            pages: pages.length,
            widths: pages.map( function ( p ) {
                return Math.round( p.getBoundingClientRect().width );
            } ),
            footers: footers.map( function ( f ) {
                return f.textContent.trim();
            } ),
            scrollWidth: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            height: Math.round( rendered.getBoundingClientRect().height )
        };
    } );

    ok( !!stats, 'visual ' + name + ': rendered' );
    if ( !stats ) {
        await page.close();
        return;
    }

    ok( stats.pages === 3, 'visual ' + name + ': three page blocks' );
    // Fixed letter-page geometry is E5S2's job; at E3 every page fills the
    // pane and all pages share one width.
    ok( stats.widths.every( function ( w ) {
        return w === stats.widths[ 0 ] && w > 600;
    } ), 'visual ' + name + ': pages share a pane-filling width (' +
        stats.widths.join( ',' ) + ')' );
    ok( stats.footers.join( ',' ) === '1,2,3',
        'visual ' + name + ': page numbers visible (' + stats.footers.join( ',' ) + ')' );
    ok( stats.scrollWidth <= stats.viewport,
        'visual ' + name + ': no horizontal overflow (' + stats.scrollWidth +
        ' <= ' + stats.viewport + ')' );
    ok( errors.length === 0, 'visual ' + name + ': no console errors (' +
        errors.join( ' | ' ) + ')' );

    var shot = await page.locator( '#hbw-brew-rendered' ).screenshot();
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
