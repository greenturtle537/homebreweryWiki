#!/usr/bin/env node
/**
 * Fail when the served theme CSS points at an asset that is not on disk.
 *
 * The 5e fonts and textures are licence-gated, so they are not committed:
 * `build/theme/fetch-assets.sh` installs them into
 * `vendor/homebrewery-3.21.0/theme/themes/` at build and deploy time.  A
 * checkout that skipped that step serves a broken theme without any server
 * error, so this check turns the missing step into a loud failure (E4B2).
 *
 * Usage:
 *   node build/theme/verify-assets.js [--css <file>]... [--base <dir>]
 *
 * `--css` defaults to the default theme the extension serves.  `--base` is
 * the document root used for root-absolute URLs (`/fonts/...`), which the
 * vendored theme does not use but the build themes do when they are compiled
 * with an absolute `HBW_ASSET_BASE`.  `--base` falls back to the web server's
 * `DOCUMENT_ROOT`, so that build mode verifies with no extra flag; without
 * either, root-absolute URLs are reported as unresolvable rather than assumed
 * present.
 *
 * @file
 */

'use strict';

var fs = require( 'fs' );
var path = require( 'path' );

var repoRoot = path.resolve( __dirname, '..', '..' );
var DEFAULT_CSS = [ path.join( repoRoot, 'vendor/homebrewery-3.21.0/theme/theme.css' ) ];

/**
 * Read `--css` / `--base` arguments.
 *
 * @param {string[]} argv process arguments after the script path
 * @return {{ css: string[], base: string|null }} parsed options
 */
function parseArgs( argv ) {
    var options = { css: [], base: null };
    var i;

    for ( i = 0; i < argv.length; i++ ) {
        if ( argv[ i ] === '--css' && i + 1 < argv.length ) {
            i++;
            options.css.push( path.resolve( process.cwd(), argv[ i ] ) );
        } else if ( argv[ i ] === '--base' && i + 1 < argv.length ) {
            i++;
            options.base = path.resolve( process.cwd(), argv[ i ] );
        } else if ( argv[ i ] === '--help' || argv[ i ] === '-h' ) {
            options.help = true;
        } else {
            options.error = 'unknown argument: ' + argv[ i ];
        }
    }

    // A theme built with an absolute `HBW_ASSET_BASE` writes root-absolute
    // URLs, which only the server's document root can resolve.  Take it from
    // the environment so that build mode verifies without an extra flag; an
    // explicit `--base` still wins.
    if ( options.base === null && process.env.DOCUMENT_ROOT ) {
        options.base = path.resolve( process.env.DOCUMENT_ROOT );
    }

    if ( !options.css.length ) {
        options.css = DEFAULT_CSS;
    }

    return options;
}

/**
 * Every `url(...)` target in a stylesheet, unquoted and without query or
 * fragment, with its position.  Data, remote and fragment-only URLs are not
 * files.
 *
 * @param {string} css stylesheet text
 * @return {Array.<{ url: string, index: number, skip: boolean }>} targets
 */
function urlTargets( css ) {
    var pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    var targets = [];
    var match;
    var url;

    while ( ( match = pattern.exec( css ) ) !== null ) {
        url = match[ 2 ].trim();
        targets.push( {
            url: url,
            index: match.index,
            // Test the raw value: stripping the fragment first would turn
            // `#id` into an empty string, which resolves to the stylesheet
            // directory and counts as a present file.
            skip: /^(?:data:|https?:|\/\/|#)/i.test( url )
        } );
    }

    return targets;
}

/**
 * Character ranges of `@font-face` `src` declarations.
 *
 * A `src` value is an ordered fallback list: the browser uses the first
 * format it supports, so a missing later entry is harmless.  The pinned
 * asset set ships the `.woff2` files only, while `theme.css` still lists the
 * `.ttf` fallbacks — those must not fail the check.
 *
 * @param {string} css stylesheet text
 * @return {Array.<{ start: number, end: number }>} ranges in source order
 */
function srcRanges( css ) {
    var block = /@font-face\s*\{([^}]*)\}/g;
    var ranges = [];
    var match;
    var src;
    var start;
    var end;

    while ( ( match = block.exec( css ) ) !== null ) {
        src = /src\s*:/.exec( match[ 1 ] );
        if ( !src ) {
            continue;
        }
        start = match.index + match[ 0 ].indexOf( '{' ) + 1 + src.index;
        end = match[ 1 ].indexOf( ';', src.index + src[ 0 ].length );
        end = end === -1 ? match[ 1 ].length : end;
        ranges.push( { start: start, end: match.index + match[ 0 ].indexOf( '{' ) + 1 + end } );
    }

    return ranges;
}

/**
 * Whether an absolute path stays inside a directory.
 *
 * @param {string} base directory, absolute
 * @param {string} target path, absolute
 * @return {boolean} true when `target` is `base` or below it
 */
function isInside( base, target ) {
    var relative = path.relative( path.resolve( base ), target );

    return relative === '' ||
        ( relative !== '..' &&
            relative.indexOf( '..' + path.sep ) !== 0 &&
            !path.isAbsolute( relative ) );
}

/**
 * Where a target resolves for a given stylesheet.
 *
 * @param {string} cssFile absolute stylesheet path
 * @param {string} url target as written
 * @param {string|null} base document root for root-absolute URLs
 * @return {string|null} absolute path, or null when it cannot be resolved
 */
function resolveTarget( cssFile, url, base ) {
    var clean = url.replace( /[?#].*$/, '' );
    var normalized;
    var resolved;

    if ( clean.charAt( 0 ) === '/' ) {
        if ( !base ) {
            return null;
        }

        // A browser resolves `/../../x` against the origin, not the
        // filesystem, so traversal above the URL root stops at `/x`.
        // Separators are normalized first, because CSS backslashes reach us
        // verbatim while `path` treats `\` as a separator on Windows only —
        // `url(/assets\..\..\outside)` must not resolve outside the root.
        // The containment check then covers whatever spelling is left: an
        // outside file must never vouch for a missing asset.
        normalized = path.posix.normalize( clean.replace( /\\/g, '/' ) );
        resolved = path.resolve( base, '.' + normalized );

        return isInside( base, resolved ) ? resolved : null;
    }

    return path.resolve( path.dirname( cssFile ), clean );
}

/**
 * Missing and unresolvable targets for one stylesheet.
 *
 * @param {string} cssFile absolute stylesheet path
 * @param {string|null} base document root for root-absolute URLs
 * @return {{ checked: number, missing: string[], unresolved: string[], unsatisfied: string[] }} report
 */
function checkStylesheet( cssFile, base ) {
    var report = { checked: 0, missing: [], unresolved: [], unsatisfied: [] };
    var css;
    var targets;
    var ranges;
    var groups = [];
    var target;
    var resolved;
    var group;
    var range;
    var i;
    var j;

    if ( !fs.existsSync( cssFile ) ) {
        report.missing.push( cssFile );
        return report;
    }

    css = fs.readFileSync( cssFile, 'utf8' );
    targets = urlTargets( css );
    ranges = srcRanges( css );

    for ( i = 0; i < targets.length; i++ ) {
        target = targets[ i ];
        if ( target.skip ) {
            continue;
        }
        report.checked++;
        resolved = resolveTarget( cssFile, target.url, base );

        group = null;
        for ( j = 0; j < ranges.length; j++ ) {
            range = ranges[ j ];
            if ( target.index >= range.start && target.index < range.end ) {
                group = ranges[ j ];
                break;
            }
        }

        if ( group !== null ) {
            group.urls = group.urls || [];
            group.urls.push( { url: target.url, resolved: resolved } );
        } else if ( resolved === null ) {
            report.unresolved.push( target.url );
        } else if ( !fs.existsSync( resolved ) ) {
            report.missing.push( target.url + '  (' + path.relative( repoRoot, resolved ) + ')' );
        }
    }

    for ( j = 0; j < ranges.length; j++ ) {
        range = ranges[ j ];
        if ( !range.urls || !range.urls.length ) {
            continue;
        }
        var satisfied = false;
        for ( i = 0; i < range.urls.length; i++ ) {
            if ( range.urls[ i ].resolved !== null && fs.existsSync( range.urls[ i ].resolved ) ) {
                satisfied = true;
                break;
            }
        }
        if ( !satisfied ) {
            report.unsatisfied.push(
                range.urls.map( function ( entry ) { return entry.url; } ).join( ' | ' )
            );
        }
    }

    return report;
}

/**
 * Whether a path is an existing directory.
 *
 * @param {string} target absolute path
 * @return {boolean} true when the path is a directory
 */
function isDirectory( target ) {
    try {
        return fs.statSync( target ).isDirectory();
    } catch ( error ) {
        return false;
    }
}

/**
 * Entry point.
 *
 * @return {void}
 */
function main() {
    var options = parseArgs( process.argv.slice( 2 ) );
    var total = 0;
    var missing = [];
    var unresolved = [];
    var unsatisfied = [];
    var report;
    var file;
    var i;
    var j;

    if ( options.help ) {
        process.stdout.write(
            'usage: node build/theme/verify-assets.js [--css <file>]... [--base <dir>]\n' +
            '  --base  document root for root-absolute url() targets\n' +
            '          (default: $DOCUMENT_ROOT)\n'
        );
        return;
    }
    if ( options.error ) {
        process.stderr.write( options.error + '\n' );
        process.exitCode = 2;
        return;
    }
    if ( options.base !== null && !isDirectory( options.base ) ) {
        process.stderr.write(
            'theme assets: --base ' + options.base + ' is not a directory.\n' +
            'Point it (or DOCUMENT_ROOT) at the web server document root that serves the theme.\n'
        );
        process.exitCode = 2;
        return;
    }

    for ( i = 0; i < options.css.length; i++ ) {
        file = options.css[ i ];
        report = checkStylesheet( file, options.base );
        total += report.checked;
        for ( j = 0; j < report.missing.length; j++ ) {
            missing.push( path.basename( file ) + ': ' + report.missing[ j ] );
        }
        for ( j = 0; j < report.unresolved.length; j++ ) {
            unresolved.push( path.basename( file ) + ': ' + report.unresolved[ j ] );
        }
        for ( j = 0; j < report.unsatisfied.length; j++ ) {
            unsatisfied.push( path.basename( file ) + ': ' + report.unsatisfied[ j ] );
        }
    }

    if ( unsatisfied.length ) {
        process.stderr.write(
            'theme assets: ' + unsatisfied.length + ' src list(s) have no usable file:\n  ' +
            unsatisfied.join( '\n  ' ) + '\n'
        );
    }

    if ( unresolved.length ) {
        process.stderr.write(
            'theme assets: ' + unresolved.length + ' root-absolute url() target(s) need ' +
            '--base <document root> (or DOCUMENT_ROOT):\n  ' + unresolved.join( '\n  ' ) + '\n'
        );
    }

    if ( missing.length ) {
        process.stderr.write(
            'theme assets: ' + missing.length + ' of ' + total + ' url() target(s) missing.\n' +
            'Run `sh build/theme/fetch-assets.sh` (required for build and deploy), then retry:\n  ' +
            missing.join( '\n  ' ) + '\n'
        );
        process.exitCode = 1;
        return;
    }

    if ( unresolved.length || unsatisfied.length ) {
        process.exitCode = 1;
        return;
    }

    process.stdout.write(
        'theme assets: all ' + total + ' url() target(s) present in ' +
        options.css.length + ' stylesheet(s)\n'
    );
}

main();
