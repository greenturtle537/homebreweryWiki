#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const root = path.resolve( here, '..', '..' );
const goldenDir = path.join( here, 'goldens' );
const host = 'http://hbw.test';
const viewport = { width: 1280, height: 1024 };
const pixelThreshold = 0.1;
const maxDiffRatio = 0.02;

/**
 * Fixture under test. `marker` is text the render must contain before it is
 * measured, so a half-built page is never compared. `overflow` says whether
 * the fixture is meant to overrun its columns (E4B1): the old single fixture
 * was three pages of one sentence, which could never catch clipped content.
 */
const fixtures = [
    { name: 'three-page-brew', marker: 'Page Three', overflow: false, upstream: true },
    // `upstream: false` because the app's capture is contaminated: the editor
    // keeps the demo brew's style tab (`.page { padding-bottom: 1.1cm }`), which
    // changes the column height and therefore every line break on a full page.
    // This golden is a regression baseline recorded from this renderer instead.
    {
        name: 'rich-brew', marker: 'After the Break', overflow: true,
        // Page 1 is the page that overruns; naming it keeps the check from
        // accepting a flag on any other page.
        overflowPages: [ 1 ], upstream: false
    }
];
const acceptGoldens = process.env.HBW_PARITY_ACCEPT === '1';

const result = {
    suite: 'parity',
    passed: 0,
    failed: 0,
    pages: 0,
    assets: 0,
    outbound: 0,
    ok: false
};
let skipped = 0;

function pass( condition, message ) {
    if ( condition ) {
        result.passed++;
        return true;
    }
    result.failed++;
    console.error( 'FAIL: ' + message );
    return false;
}

function skip( message ) {
    skipped++;
    console.error( 'SKIP: ' + message );
}

function escapeHtml( value ) {
    return String( value )
        .replace( /&/g, '&amp;' )
        .replace( /</g, '&lt;' )
        .replace( />/g, '&gt;' )
        .replace( /"/g, '&quot;' )
        .replace( /'/g, '&#39;' );
}

function asset( relative ) {
    return fs.readFileSync( path.join( root, relative ), 'utf8' );
}

function contentType( file ) {
    const types = {
        '.css': 'text/css',
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf'
    };
    return types[ path.extname( file ).toLowerCase() ] || 'application/octet-stream';
}

function compareGolden( shot, name, upstream ) {
    const golden = path.join( goldenDir, name + '.png' );
    if ( acceptGoldens && !upstream ) {
        fs.writeFileSync( golden, shot );
        console.log( 'ACCEPT: recorded ' + name + '.png from this renderer' );
        return;
    }
    if ( !fs.existsSync( golden ) ) {
        skip( name + '.png is absent; run npm run parity:capture to record it' );
        return;
    }

    const expected = PNG.sync.read( fs.readFileSync( golden ) );
    const actual = PNG.sync.read( shot );
    if ( expected.width !== actual.width || expected.height !== actual.height ) {
        pass( false, name + ' size changed (' + expected.width + 'x' +
            expected.height + ' -> ' + actual.width + 'x' + actual.height + ')' );
        return;
    }

    const diff = new PNG( { width: expected.width, height: expected.height } );
    const changed = pixelmatch(
        expected.data, actual.data, diff.data,
        expected.width, expected.height,
        { threshold: pixelThreshold }
    );
    const ratio = changed / ( expected.width * expected.height );

    if ( ratio > maxDiffRatio ) {
        fs.writeFileSync(
            path.join( goldenDir, name + '.diff.png' ),
            PNG.sync.write( diff )
        );
    }
    pass( ratio <= maxDiffRatio, name + ' pixels within tolerance (' +
        ( ratio * 100 ).toFixed( 3 ) + '% changed, limit ' +
        ( maxDiffRatio * 100 ) + '%)' );
}

function manifestAssets() {
    const lines = fs.readFileSync( path.join( root, 'ASSETS.txt' ), 'utf8' )
        .split( /\r?\n/ );
    const assets = [];
    let inAssets = false;

    lines.forEach( ( line ) => {
        const trimmed = line.trim();
        if ( /^(?:Fonts|Images) \(\d+\)$/.test( trimmed ) ) {
            inAssets = true;
            return;
        }
        if ( trimmed === 'License files to vendor' ) {
            inAssets = false;
            return;
        }
        if ( inAssets && /^\s{2}themes\//.test( line ) ) {
            assets.push( trimmed );
        }
    } );

    return assets;
}

function nodeExpectations( source ) {
    const pages = source.split( /^\s*\\page\s*$/m );
    const checks = [];

    pages.forEach( ( page, index ) => {
        if ( /^\s{0,3}#{1,6}\s+\S/m.test( page ) ) {
            checks.push( {
                label: 'header on page ' + ( index + 1 ),
                page: index,
                selector: 'h1, h2, h3, h4, h5, h6'
            } );
        }
        if ( /^\s*\|.*\|\s*$/m.test( page ) ) {
            checks.push( {
                label: 'table on page ' + ( index + 1 ),
                page: index,
                selector: 'table'
            } );
        }
        if ( /class=["'][^"']*\b(?:note|descriptive)\b|\{\{note\b/i.test( page ) ) {
            checks.push( {
                label: 'note/descriptive on page ' + ( index + 1 ),
                page: index,
                selector: '.note, .descriptive'
            } );
        }
        if ( /class=["'][^"']*\b(?:monster|stat-block|statblock)\b|\{\{monster\b|\{\{statblock\b/i.test( page ) ) {
            checks.push( {
                label: 'stat block on page ' + ( index + 1 ),
                page: index,
                selector: '.monster, .stat-block, .statblock'
            } );
        }
    } );

    return checks;
}

function harnessFor( source ) {
    const escaped = escapeHtml( source );
    return '<!doctype html><html><head><meta charset="utf-8">' +
        '<link rel="stylesheet" href="/extensions/HomebreweryWiki/HomebreweryWiki.theme.css">' +
        '</head><body>' +
        '<div id="content"><div class="hbw-brew" id="hbw-brew"' +
        ' data-hbw-shell="/extensions/HomebreweryWiki/HomebreweryWiki.shell.html"' +
        ' data-hbw-theme="/extensions/HomebreweryWiki/vendor/homebrewery-3.21.0/theme/theme.css"' +
        ' data-hbw-page-width="215.9" data-hbw-page-height="279.4">' +
        '<div class="hbw-source" id="hbw-source" style="display:none">' + escaped + '</div>' +
        '<noscript><pre class="hbw-brew-text">\n' + escaped + '</pre></noscript>' +
        '</div></div></body></html>';
}

async function checkAssets( page ) {
    const assets = manifestAssets();
    const statuses = await page.evaluate( async ( spec ) => {
        return Promise.all( spec.files.map( async ( file ) => {
            const encoded = file.split( '/' ).map( encodeURIComponent ).join( '/' );
            const response = await fetch( spec.base + encoded, { cache: 'no-store' } );
            return { file, status: response.status };
        } ) );
    }, {
        base: host + '/extensions/HomebreweryWiki/vendor/homebrewery-3.21.0/theme/',
        files: assets
    } );
    const failedAssets = statuses.filter( ( item ) => item.status !== 200 );
    result.assets = assets.length;

    pass( assets.length === 125,
        'ASSETS.txt manifest lists 125 runtime files (got ' + assets.length + ')' );
    pass( failedAssets.length === 0,
        'every runtime asset responds 200 (' + failedAssets.map( ( item ) => {
            return item.status + ' ' + item.file;
        } ).join( ' | ' ) + ')' );
}

async function runFixture( browser, spec ) {
    const source = fs.readFileSync(
        path.join( root, 'tests', 'fixtures', spec.name + '.md' ), 'utf8'
    );
    const expectedPages = source.split( /^\s*\\page\s*$/m ).length;
    const columnPages = source.split( /^\s*\\page\s*$/m )
        .map( ( page, index ) => ( /^\s*\\column\s*$/m.test( page ) ? index : -1 ) )
        .filter( ( index ) => index !== -1 );
    const outbound = [];
    const assetFailures = [];
    const responseFailures = [];

    const page = await browser.newPage( { viewport } );
    try {
        await page.route( '**/*', async ( route ) => {
            const request = route.request();
            const url = new URL( request.url() );

            if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
                return route.continue();
            }
            if ( url.origin !== host ) {
                outbound.push( url.href );
                return route.abort();
            }
            if ( url.pathname === '/favicon.ico' ) {
                return route.fulfill( { status: 204, body: '' } );
            }
            if ( url.pathname === '/harness.html' ) {
                return route.fulfill( {
                    status: 200,
                    contentType: 'text/html',
                    body: harnessFor( source )
                } );
            }

            const relative = decodeURIComponent(
                url.pathname.replace( /^\/extensions\/HomebreweryWiki\//, '' )
            );
            const file = path.join( root, relative );
            if ( file.indexOf( root ) !== 0 || !fs.existsSync( file ) ||
                fs.statSync( file ).isDirectory() ) {
                assetFailures.push( '404 ' + url.pathname );
                return route.fulfill( { status: 404, body: '' } );
            }

            return route.fulfill( {
                status: 200,
                contentType: contentType( file ),
                path: file
            } );
        } );

        page.on( 'response', ( response ) => {
            if ( response.url().indexOf( host + '/' ) !== 0 ||
                response.url().indexOf( '/harness.html' ) !== -1 ||
                response.url().indexOf( '/favicon.ico' ) !== -1 ) {
                return;
            }
            if ( response.status() !== 200 ) {
                responseFailures.push( response.status() + ' ' + response.url() );
            }
        } );
        page.on( 'requestfailed', ( request ) => {
            if ( request.url().indexOf( host + '/' ) === 0 ) {
                const failure = request.failure();
                responseFailures.push(
                    ( failure && failure.errorText ? failure.errorText : 'failed' ) +
                    ' ' + request.url()
                );
            }
        } );

        await page.goto( host + '/harness.html', { waitUntil: 'load' } );

        await page.addScriptTag( { content: asset( 'vendor/marked-0.3.19.min.js' ) } );
        await page.addScriptTag( { content: asset( 'vendor/dompurify-2.5.8.min.js' ) } );
        await page.addScriptTag( { content: asset( 'vendor/homebrewery-3.21.0/renderer.min.js' ) } );
        await page.addScriptTag( { content: asset( 'HomebreweryWiki.render.js' ) } );

        await page.waitForFunction( ( spec2 ) => {
            const frame = document.getElementById( 'hbw-frame' );
            const doc = frame && frame.contentDocument;
            const pageNode = doc && doc.querySelector( '.pages > .page' );
            return !!pageNode && pageNode.offsetWidth >= 800 &&
                pageNode.offsetHeight >= 1000 &&
                doc.querySelector( '.pages' ).textContent.indexOf( spec2.marker ) !== -1;
        }, { marker: spec.marker }, { timeout: 20000 } );

        await page.evaluate( async () => {
            const frame = document.getElementById( 'hbw-frame' );
            const doc = frame && frame.contentDocument;
            if ( doc && doc.fonts ) {
                await doc.fonts.ready;
            }
            if ( doc ) {
                await Promise.all( Array.prototype.slice.call( doc.images ).map(
                    ( image ) => image.complete ? null : new Promise( ( resolve ) => {
                        image.onload = resolve;
                        image.onerror = resolve;
                    } )
                ) );
            }
        } );
        await page.waitForTimeout( 400 );

        const info = await page.evaluate( () => {
            const frame = document.getElementById( 'hbw-frame' );
            const doc = frame && frame.contentDocument;
            const pagesNode = doc && doc.querySelector( '.pages' );
            const pages = pagesNode
                ? Array.prototype.slice.call( pagesNode.querySelectorAll( ':scope > .page' ) )
                : [];
            const frameEl = document.getElementById( 'hbw-frame' );
            const hbwHost = document.getElementById( 'hbw-brew' );
            const notice = hbwHost ? hbwHost.querySelector( '.hbw-overflow-notice' ) : null;
            return {
                sandbox: frame ? frame.getAttribute( 'sandbox' ) : null,
                referrerpolicy: frame ? frame.getAttribute( 'referrerpolicy' ) : null,
                pageCount: pages.length,
                widths: pages.map( ( pageNode ) => pageNode.offsetWidth ),
                heights: pages.map( ( pageNode ) => pageNode.offsetHeight ),
                wrappers: pages.map( ( pageNode ) => pageNode.querySelectorAll( ':scope > .columnWrapper' ).length ),
                splits: pages.map( ( pageNode ) => pageNode.querySelectorAll( '.columnWrapper .columnSplit' ).length ),
                numbers: pages.map( ( pageNode ) => pageNode.querySelectorAll( '.pageNumber' ).length ),
                overflow: {
                    host: hbwHost ? hbwHost.getAttribute( 'data-hbw-overflow' ) : null,
                    pages: pagesNode ? pagesNode.getAttribute( 'data-hbw-overflow' ) : null,
                    flags: pages.map( ( pageNode ) => pageNode.getAttribute( 'data-hbw-overflow' ) ),
                    notice: notice ? notice.textContent : null,
                    noticeBeforeFrame: !!notice && !!frameEl &&
                        notice.parentNode === hbwHost &&
                        ( notice.compareDocumentPosition( frameEl ) & 4 ) === 4,
                    noticeInFrame: !!notice && !!doc && doc.contains( notice )
                },
                nodes: pages.map( ( pageNode ) => {
                    const select = ( selector ) => pageNode.querySelectorAll( selector ).length;
                    return {
                        headers: select( 'h1, h2, h3, h4, h5, h6' ),
                        tables: select( 'table' ),
                        notes: select( '.note, .descriptive' ),
                        stats: select( '.monster, .stat-block, .statblock' )
                    };
                } )
            };
        } );

        result.pages += info.pageCount;
        result.outbound += outbound.length;

        pass( info.sandbox === 'allow-same-origin allow-top-navigation-by-user-activation',
            spec.name + ': iframe sandbox is exactly "' +
            'allow-same-origin allow-top-navigation-by-user-activation" (got ' +
            JSON.stringify( info.sandbox ) + ')' );
        pass( !String( info.sandbox || '' ).split( /\s+/ ).includes( 'allow-scripts' ),
            spec.name + ': iframe sandbox does not allow scripts' );
        pass( info.referrerpolicy === 'no-referrer',
            spec.name + ': iframe referrerpolicy is no-referrer' );
        pass( info.pageCount === expectedPages,
            spec.name + ': iframe .pages holds ' + expectedPages + ' .page blocks (got ' +
            info.pageCount + ')' );
        pass( info.wrappers.every( ( count ) => count === 1 ),
            spec.name + ': every .page has exactly one direct .columnWrapper (' +
            info.wrappers.join( ',' ) + ')' );
        pass( columnPages.every( ( index ) => info.splits[ index ] >= 1 ),
            spec.name + ': \\column produces .columnSplit on page(s) ' +
            columnPages.map( ( index ) => index + 1 ).join( ',' ) + ' (' +
            info.splits.join( ',' ) + ')' );
        pass( info.numbers.every( ( count ) => count === 1 ),
            spec.name + ': every .page has exactly one .pageNumber (' +
            info.numbers.join( ',' ) + ')' );
        pass( info.widths.every( ( width ) => Math.abs( width - 816 ) <= 1 ),
            spec.name + ': every .page is 816 CSS px wide (' + info.widths.join( ',' ) + ')' );
        pass( info.heights.every( ( height ) => Math.abs( height - 1056 ) <= 1 ),
            spec.name + ': every .page is 1056 CSS px tall (' + info.heights.join( ',' ) + ')' );

        nodeExpectations( source ).forEach( ( expectation ) => {
            const nodes = info.nodes[ expectation.page ] || {};
            const key = expectation.label.indexOf( 'header' ) === 0 ? 'headers'
                : expectation.label.indexOf( 'table' ) === 0 ? 'tables'
                    : expectation.label.indexOf( 'note' ) === 0 ? 'notes' : 'stats';
            pass( ( nodes[ key ] || 0 ) > 0,
                spec.name + ': ' + expectation.label + ' exists (' + expectation.selector + ')' );
        } );

        // Column overflow signal (E4B1).
        if ( spec.overflow ) {
            const flagged = info.overflow.flags
                .map( ( flag, index ) => ( flag ? index + 1 : 0 ) )
                .filter( ( index ) => index );
            pass( flagged.length >= 1,
                spec.name + ': at least one page is flagged as overflowing (' +
                JSON.stringify( info.overflow.flags ) + ')' );
            // A regression that shifted the flag onto the wrong page would
            // still satisfy the checks below, because they follow the flag, so
            // the flagged set has to equal the expected one: no page missing,
            // no page added.
            pass( flagged.join( ',' ) === ( spec.overflowPages || [] ).join( ',' ),
                spec.name + ': flagged pages match the pages that overrun, want ' +
                JSON.stringify( spec.overflowPages || [] ) + ' (got ' +
                JSON.stringify( flagged ) + ')' );
            pass( info.overflow.host === flagged.join( ',' ),
                spec.name + ': host carries the overflowing page numbers (got ' +
                JSON.stringify( info.overflow.host ) + ', want ' +
                JSON.stringify( flagged.join( ',' ) ) + ')' );
            pass( info.overflow.pages === flagged.join( ',' ),
                spec.name + ': .pages carries the overflowing page numbers (got ' +
                JSON.stringify( info.overflow.pages ) + ')' );
            pass( flagged.every( ( index ) => Number( info.overflow.flags[ index - 1 ] ) >= 2 ),
                spec.name + ': each flag reports at least two columns (' +
                JSON.stringify( info.overflow.flags ) + ')' );
            pass( !!info.overflow.notice && /clipped/.test( info.overflow.notice ),
                spec.name + ': overflow notice names the clipping (got ' +
                JSON.stringify( info.overflow.notice ) + ')' );
            pass( info.overflow.noticeBeforeFrame && !info.overflow.noticeInFrame,
                spec.name + ': overflow notice sits in the host above the frame, outside the brew' );
        } else {
            pass( info.overflow.host === null && info.overflow.pages === null,
                spec.name + ': no overflow attribute on the host or .pages (got ' +
                JSON.stringify( info.overflow.host ) + ', ' +
                JSON.stringify( info.overflow.pages ) + ')' );
            pass( info.overflow.flags.every( ( flag ) => flag === null ),
                spec.name + ': no page flagged as overflowing (' +
                JSON.stringify( info.overflow.flags ) + ')' );
            pass( info.overflow.notice === null,
                spec.name + ': no overflow notice for a brew that fits' );
        }

        pass( assetFailures.length === 0,
            spec.name + ': no same-origin asset request returned 404 (' +
            assetFailures.join( ' | ' ) + ')' );
        pass( responseFailures.length === 0,
            spec.name + ': no same-origin asset request failed (' +
            responseFailures.join( ' | ' ) + ')' );
        pass( outbound.length === 0,
            spec.name + ': no outbound requests (' + outbound.join( ' | ' ) + ')' );

        await checkAssets( page );

        const pages = page.frameLocator( '#hbw-frame' ).locator( '.pages > .page' );
        const actualDir = process.env.HBW_PARITY_OUT;
        for ( let index = 0; index < info.pageCount; index++ ) {
            const shot = await pages.nth( index ).screenshot();
            if ( actualDir ) {
                fs.mkdirSync( actualDir, { recursive: true } );
                fs.writeFileSync(
                    path.join( actualDir, spec.name + '-' + ( index + 1 ) + '.png' ),
                    shot
                );
            }
            compareGolden( shot, spec.name + '-' + ( index + 1 ), spec.upstream );
        }
    } finally {
        await page.close();
    }
}

async function main() {
    const browser = await chromium.launch();
    try {
        for ( const spec of fixtures ) {
            await runFixture( browser, spec );
        }
    } finally {
        await browser.close();
    }
}

try {
    await main();
} catch ( error ) {
    result.failed++;
    console.error( 'FAIL: ' + ( error && error.stack ? error.stack : error ) );
}

result.ok = result.failed === 0;
if ( skipped > 0 ) {
    console.error( 'SKIP: ' + skipped +
        ' golden comparison(s) skipped; run npm run parity:capture to record them' );
}
console.log( JSON.stringify( result ) );
process.exitCode = result.ok ? 0 : 1;
