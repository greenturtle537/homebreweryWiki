/**
 * Build the runtime asset manifest (E3.5S2T4).
 *
 * Reads the compiled theme.css, extracts every url() that points into the
 * configured asset base, and prints the upstream-relative paths it needs
 * (`themes/...`), one per line, sorted. The build hashes exactly these files,
 * so the manifest cannot drift from what the stylesheet actually requests.
 *
 * Usage: node manifest.js <theme.css> <asset-base>
 */
'use strict';

var fs = require( 'fs' );

var cssPath = process.argv[ 2 ];
var base = ( process.argv[ 3 ] || '' ).replace( /\/+$/, '' );
var css = fs.readFileSync( cssPath, 'utf8' );
var paths = {};
var count = 0;

css.replace(
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/g,
    function ( match, url ) {
        var prefix = base + '/';
        if ( url.indexOf( prefix ) !== 0 ) {
            return match;
        }
        paths[ url.substring( prefix.length ) ] = true;
        return match;
    }
);

Object.keys( paths ).sort().forEach( function ( path ) {
    process.stdout.write( path + '\n' );
    count++;
} );

if ( !count ) {
    process.stderr.write( 'manifest: no theme asset URLs found\n' );
    process.exit( 1 );
}
