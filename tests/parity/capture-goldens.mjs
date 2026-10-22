#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const root = path.resolve( here, '..', '..' );
/**
 * Fixtures whose upstream pages become goldens. Only fixtures the app can
 * render faithfully belong here: `rich-brew` is recorded from this renderer,
 * because the app's stored style tab changes a full page's column height (see
 * tests/parity/README.md). Capturing it from the app would silently replace a
 * correct golden with a wrong one; refresh it with
 * `HBW_PARITY_ACCEPT=1 npm run parity` instead.
 */
const fixtures = [
    { name: 'three-page-brew', marker: 'Page Three' }
];
const site = 'https://homebrewery.naturalcrit.com';
const outIndex = process.argv.indexOf( '--out' );
const out = outIndex !== -1 && process.argv[ outIndex + 1 ]
    ? path.resolve( process.argv[ outIndex + 1 ] )
    : path.join( here, 'goldens' );
const pageWidth = 816;

function expectedPages( source ) {
    return source.split( /^\s*\\page\s*$/m ).length;
}

async function setSource( page, source ) {
    const usedApi = await page.evaluate( ( text ) => {
        const editor = document.querySelector( '.CodeMirror' );
        if ( !editor || !editor.CodeMirror ||
            typeof editor.CodeMirror.setValue !== 'function' ) {
            return false;
        }
        editor.CodeMirror.setValue( text );
        return true;
    }, source );

    if ( usedApi ) {
        return 'CodeMirror.setValue';
    }

    const content = page.locator( '.cm-content' );
    await content.waitFor( { state: 'visible', timeout: 30000 } );
    await content.click();
    await page.keyboard.press( 'ControlOrMeta+a' );
    await page.keyboard.insertText( source );
    return 'CodeMirror 6 keyboard input';
}

async function capture( browser, spec ) {
    const source = fs.readFileSync(
        path.join( root, 'tests', 'fixtures', spec.name + '.md' ), 'utf8'
    );
    const pagesWanted = expectedPages( source );
    {
        const page = await browser.newPage( { viewport: { width: 1400, height: 1200 } } );
        await page.goto( site, { waitUntil: 'domcontentloaded', timeout: 60000 } );
        await page.waitForTimeout( 3000 );
        const api = await setSource( page, source );

        await page.waitForFunction( ( want ) => {
            const frame = document.querySelector( '#BrewRenderer' );
            const doc = frame && frame.contentDocument;
            const pagesNode = doc && doc.querySelector( '.pages' );
            const pages = pagesNode
                ? Array.prototype.slice.call( pagesNode.querySelectorAll( ':scope > .page' ) )
                : [];
            return pages.length === want.count &&
                pages.every( ( node ) => Math.abs( node.offsetWidth - 816 ) <= 1 &&
                    Math.abs( node.offsetHeight - 1056 ) <= 1 ) &&
                pagesNode.textContent.indexOf( want.marker ) !== -1;
        }, { count: pagesWanted, marker: spec.marker }, { timeout: 30000 } );

        await page.evaluate( async () => {
            const frame = document.querySelector( '#BrewRenderer' );
            const doc = frame && frame.contentDocument;
            if ( doc && doc.fonts ) {
                await doc.fonts.ready;
            }
        } );
        await page.waitForTimeout( 500 );

        await page.evaluate( () => {
            const frame = document.querySelector( '#BrewRenderer' );
            frame.style.position = 'fixed';
            frame.style.left = '0';
            frame.style.top = '0';
            frame.style.width = '816px';
            frame.style.height = '1056px';
            frame.style.zIndex = '2147483647';
            const doc = frame.contentDocument;
            doc.body.style.overflow = 'hidden';
            const root = doc.querySelector( '.brewRenderer' );
            if ( root ) {
                root.style.overflow = 'hidden';
            }
        } );

        fs.mkdirSync( out, { recursive: true } );
        const pages = page.frameLocator( '#BrewRenderer' ).locator( '.pages > .page' );
        const count = await pages.count();
        if ( count !== pagesWanted ) {
            throw new Error( 'expected ' + pagesWanted + ' pages, found ' + count );
        }

        for ( let index = 0; index < count; index++ ) {
            await page.evaluate( ( pageIndex ) => {
                const frame = document.querySelector( '#BrewRenderer' );
                const doc = frame.contentDocument;
                const root = doc.querySelector( '.brewRenderer' );
                const node = doc.querySelectorAll( '.pages > .page' )[ pageIndex ];
                const rect = node.getBoundingClientRect();
                root.scrollLeft = 0;
                root.scrollTop = rect.top + root.scrollTop;
            }, index );
            await page.waitForTimeout( 100 );

            const node = pages.nth( index );
            const box = await node.boundingBox();
            if ( !box || Math.abs( box.width - pageWidth ) > 1 ) {
                throw new Error( 'page ' + ( index + 1 ) + ' is not ' +
                    pageWidth + ' CSS px wide (' + ( box && box.width ) + ')' );
            }
            const name = spec.name + '-' + ( index + 1 ) + '.png';
            await node.screenshot( { path: path.join( out, name ) } );
            console.log( 'captured ' + path.join( out, name ) );
        }
        console.log( spec.name + ': source set via ' + api );
        await page.close();
    }
}

async function main() {
    const browser = await chromium.launch();
    try {
        for ( const spec of fixtures ) {
            await capture( browser, spec );
        }
    } finally {
        await browser.close();
    }
}

main().catch( ( error ) => {
    console.error( error && error.stack ? error.stack : error );
    process.exitCode = 1;
} );
