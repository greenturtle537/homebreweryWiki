/**
 * HomebreweryWiki view module (E1S2T2).
 *
 * Places the saved brew markdown into the standard MediaWiki content area as
 * plain preformatted text, proving the view plumbing before the Homebrewery
 * renderer lands (E1S3/E1S4 keep the same placeholder contract).
 *
 * Contract:
 *   - The server (HomebreweryWiki_Article view path) emits the raw source into
 *     a hidden placeholder: <div id="hbw-source"> ...escaped markdown... </div>
 *     inside the `.hbw-brew` wrapper, and loads this file only on the view of a
 *     brew-namespace page.  (A <div>, not a <pre>, so a leading newline in the
 *     source survives HTML parsing; this module reads textContent verbatim.)
 *   - This module reads that source, builds the visible <pre class="hbw-brew-text">,
 *     drops it into the wrapper, and removes the hidden placeholder.
 *
 * ES5 only: the desktop browser floor is not pinned yet (Q19 / DESIGN §7), so
 * avoid let/const, arrow functions and template literals.  Loaded from the
 * document head (legacy addScriptFile), hence the DOM-ready guard.
 */
( function () {
    'use strict';

    function renderBrew() {
        var source = document.getElementById( 'hbw-source' );
        if ( !source ) {
            // Not a brew view, or already rendered.
            return;
        }

        var host = source.parentNode;
        if ( !host ) {
            return;
        }

        var pre = document.createElement( 'pre' );
        pre.className = 'hbw-brew-text';
        pre.id = 'hbw-brew-text';
        pre.appendChild( document.createTextNode( source.textContent || source.innerText || '' ) );

        host.appendChild( pre );        // reveal the saved markdown in the pane
        host.removeChild( source );     // drop the hidden placeholder
    }

    if ( document.addEventListener ) {
        document.addEventListener( 'DOMContentLoaded', renderBrew, false );
    } else if ( window.attachEvent ) {
        window.attachEvent( 'onload', renderBrew );
    } else {
        window.onload = renderBrew;
    }
}() );
