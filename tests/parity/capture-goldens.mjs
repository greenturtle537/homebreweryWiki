#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const root = path.resolve( here, '..', '..' );
const fixture = path.join( root, 'tests', 'fixtures', 'three-page-brew.md' );
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
    await page.keyboard.press( 'Control+a' );
    await page.keyboard.insertText( source );
    return 'CodeMirror 6 keyboard input';
}

async function main() {
    const source = fs.readFileSync( fixture, 'utf8' );
    const pagesWanted = expectedPages( source );
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage( { viewport: { width: 1400, height: 1200 } } );
        await page.goto( site, { waitUntil: 'domcontentloaded', timeout: 60000 } );
        await page.waitForTimeout( 3000 );
        const api = await setSource( page, source );

        await page.waitForFunction( ( count ) => {
            const frame = document.querySelector( '#BrewRenderer' );
            const doc = frame && frame.contentDocument;
            const pages = doc
                ? Array.prototype.slice.call( doc.querySelectorAll( '.pages > .page' ) )
                : [];
            return pages.length === count &&
                pages.every( ( node ) => Math.abs( node.offsetWidth - 816 ) <= 1 &&
                    Math.abs( node.offsetHeight - 1056 ) <= 1 ) &&
                doc.querySelector( '.pages' ).textContent.indexOf( 'Page Three' ) !== -1;
        }, pagesWanted, { timeout: 30000 } );

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
            const name = 'three-page-brew-' + ( index + 1 ) + '.png';
            await node.screenshot( { path: path.join( out, name ) } );
            console.log( 'captured ' + path.join( out, name ) );
        }
        console.log( 'source set via ' + api );
    } finally {
        await browser.close();
    }
}

main().catch( ( error ) => {
    console.error( error && error.stack ? error.stack : error );
    process.exitCode = 1;
} );
