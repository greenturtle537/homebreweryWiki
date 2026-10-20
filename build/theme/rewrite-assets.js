/**
 * Rewrite Homebrewery theme asset URLs to a configurable base (E3.5S2T3).
 *
 * The compiled Less keeps the URLs written for the upstream app, where the
 * site is served from the web root:
 *
 *   url('/assets/...')            -> themes/assets/...
 *   url('/fonts/iconFonts/...')   -> themes/fonts/iconFonts/...
 *   url('../../../fonts/...')     -> themes/fonts/... (relative to the Less
 *                                   source, wrong once compiled to one file)
 *
 * The wiki may be installed under a subdirectory, so every one of these is
 * rewritten to `<asset-base>/themes/...`.  Only url() payloads are touched;
 * the rest of the stylesheet is byte-for-byte the compiled upstream output.
 *
 * Usage: node rewrite-assets.js <input.css> <asset-base>
 */
'use strict';

var fs = require( 'fs' );

var input = process.argv[ 2 ];
var base = ( process.argv[ 3 ] || '' ).replace( /\/+$/, '' );

if ( !input || !base ) {
    process.stderr.write( 'usage: node rewrite-assets.js <input.css> <asset-base>\n' );
    process.exit( 2 );
}

var css = fs.readFileSync( input, 'utf8' );
var before = css;

/**
 * Replace one URL prefix inside url(...) payloads, quoted or bare.
 *
 * @param {string} prefix Upstream prefix (e.g. "/assets/").
 * @param {string} target Replacement prefix.
 * @return {void}
 */
function rewrite( prefix, target ) {
    var quoted = prefix.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
    var re = new RegExp( '(url\\(\\s*[\'"]?)' + quoted, 'g' );
    css = css.replace( re, '$1' + target );
}

rewrite( '/assets/', base + '/themes/assets/' );
rewrite( '/fonts/iconFonts/', base + '/themes/fonts/iconFonts/' );
rewrite( '../../../fonts/', base + '/themes/fonts/' );

// Any upstream prefix left in a url() would 404 under a subdirectory install;
// fail the build instead of shipping a theme with dead references.
var leftover = [];
[
    '/assets/',
    '/fonts/iconFonts/',
    '../../../fonts/'
].forEach( function ( prefix ) {
    var quoted = prefix.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
    var re = new RegExp( 'url\\(\\s*[\'\"]?' + quoted, 'g' );
    var match;
    while ( ( match = re.exec( css ) ) !== null ) {
        leftover.push(
            css.substring( match.index, match.index + 80 ).split( '\n' )[ 0 ]
        );
    }
} );
if ( leftover.length ) {
    process.stderr.write(
        'unrewritten root-absolute url() references:\n  ' +
        leftover.slice( 0, 10 ).join( '\n  ' ) + '\n'
    );
    process.exit( 1 );
}

if ( css === before ) {
    process.stderr.write( 'warning: no asset URLs were rewritten\n' );
}

process.stdout.write( css );
