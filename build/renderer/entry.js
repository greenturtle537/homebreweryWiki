/**
 * Bundle entry for the pinned Homebrewery renderer (E3S2T1).
 *
 * Upstream `shared/markdown.js` renders one brew page at a time and exposes
 * `render(rawBrewText, pageNumber)`; page splitting is the caller's job (see
 * HomebreweryWiki.render.js).  The wrapper keeps that contract and hangs it
 * off `window.HomebreweryRenderer`.
 */
import Markdown from './upstream/shared/markdown.js';

window.HomebreweryRenderer = {
	render: function ( text, pageNumber ) {
		return Markdown.render( text, pageNumber || 0 );
	},
	marked: Markdown.marked,
	version: '3.21.0'
};
