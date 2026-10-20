<?php
/**
 * Unit/smoke tests for the HomebreweryWiki extension (E1S1 + E1S2 + E1S3 + E1S4).
 *
 * Run under a MediaWiki 1.14.1 install, e.g.:
 *   php maintenance/hbwtest.php
 * (copy this file into the MW maintenance/ directory, or run with include paths).
 *
 * Requires PHP 5.2+ and a working LocalSettings.php (SQLite or MySQL).
 *
 * @file
 */

$mwRoot = null;
if ( file_exists( dirname( __FILE__ ) . '/commandLine.inc' ) ) {
    // Running from inside an MW maintenance/ directory.
    $mwRoot = dirname( __FILE__ );
} else {
    // Repo layout: extensions/HomebreweryWiki/tests/run.php
    $mwRoot = dirname( dirname( dirname( dirname( __FILE__ ) ) ) );
    $mwRoot .= '/maintenance';
}
require_once( $mwRoot . '/commandLine.inc' );

$pass = 0;
$fail = 0;

/**
 * Record one assertion result.
 *
 * @param bool   $cond Condition that must hold.
 * @param string $msg  Human-readable assertion label.
 * @return void
 */
function t_assert( $cond, $msg ) {
    global $pass, $fail;
    if ( $cond ) {
        $pass++;
        echo "PASS: $msg\n";
    } else {
        $fail++;
        echo "FAIL: $msg\n";
    }
}

// --- isValidBrewText ---
t_assert( HomebreweryWiki::isValidBrewText( '' ) === true, 'isValidBrewText: empty valid' );
t_assert( HomebreweryWiki::isValidBrewText( 'hello' ) === true, 'isValidBrewText: ascii valid' );
t_assert( HomebreweryWiki::isValidBrewText( "line\n\ntwo" ) === true, 'isValidBrewText: multiline valid' );
t_assert( HomebreweryWiki::isValidBrewText( null ) === false, 'isValidBrewText: null invalid' );
t_assert( HomebreweryWiki::isValidBrewText( 42 ) === false, 'isValidBrewText: int invalid' );
t_assert( HomebreweryWiki::isValidBrewText( "bad\x80byte" ) === false, 'isValidBrewText: invalid utf8 invalid' );

// --- newFromTitle / ArticleFromTitle ---
$brew = HomebreweryWiki_Article::newFromTitle( Title::newFromText( 'Manual:Test' ) );
t_assert( $brew !== null, 'newFromTitle: returns article for Manual ns' );
t_assert( get_class( $brew ) === 'HomebreweryWiki_Article', 'newFromTitle: correct class' );
$main = HomebreweryWiki_Article::newFromTitle( Title::newFromText( 'Main Page' ) );
t_assert( $main === null, 'newFromTitle: null for Main ns' );

$t = Title::newFromText( 'Manual:Test' ); $a = null;
HomebreweryWiki::onArticleFromTitle( $t, $a );
t_assert( $a instanceof HomebreweryWiki_Article, 'onArticleFromTitle: selects brew article' );

$t2 = Title::newFromText( 'Main Page' ); $a2 = null;
HomebreweryWiki::onArticleFromTitle( $t2, $a2 );
t_assert( $a2 === null, 'onArticleFromTitle: leaves main-ns null' );

// --- onArticleSave ---
$user = User::newFromId( 1 );
$article = new HomebreweryWiki_Article( Title::newFromText( 'Manual:Test' ) );
$flags = 0; $status = new Status(); $summary = '';
$text = 'valid utf-8';
t_assert( HomebreweryWiki::onArticleSave( $article, $user, $text, $summary, false, false, '', $flags, $status ) === true, 'onArticleSave: valid allowed' );
$text = "bad\x80";
t_assert( HomebreweryWiki::onArticleSave( $article, $user, $text, $summary, false, false, '', $flags, $status ) === false, 'onArticleSave: invalid rejected' );
$mainArt = new Article( Title::newFromText( 'Main Page' ) );
$badText2 = "bad\x80";
t_assert( HomebreweryWiki::onArticleSave( $mainArt, $user, $badText2, $summary, false, false, '', $flags, $status ) === true, 'onArticleSave: main-ns untouched' );

// --- getBrewText ---
// Verified by code review + the isValidBrewText tests above.  The accessor is
// a 2-line guard (return '' when isValidBrewText() is false, else the raw
// text).  Exercising it here needs a live DB connection, which this CLI
// context may not have, so it is intentionally not asserted in this suite.

// --- E1S3: renderer enqueue decision (T1) ---
// The bundle loads for an ordinary view of a brew-namespace page: never for
// non-brew pages, plain edit, history, diffs, or a bare submit without a
// preview request (E1S4 adds the preview case below).
$brewTitle = Title::newFromText( 'Manual:Test' );
$mainTitle = Title::newFromText( 'Main Page' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'view', null ) === true,
    'E1S3 enqueue: brew view => load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $mainTitle, 'view', null ) === false,
    'E1S3 enqueue: non-brew view => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'edit', null ) === false,
    'E1S3 enqueue: edit => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'history', null ) === false,
    'E1S3 enqueue: history => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'submit', null ) === false,
    'E1S3 enqueue: preview (submit) => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'purge', null ) === false,
    'E1S3 enqueue: purge => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'view', '5' ) === false,
    'E1S3 enqueue: diff view => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( null, 'view', null ) === false,
    'E1S3 enqueue: null title => no load' );

// --- E1S4: preview runs through the same render path (T1-T3) ---
// A preview post (action=submit) and a preview-on-open (action=edit with
// preview=yes) must load the exact same bundle as a saved view.
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'submit', null, true ) === true,
    'E1S4 enqueue: brew preview (submit) => load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'edit', null, true ) === true,
    'E1S4 enqueue: brew preview-on-open (edit+preview=yes) => load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'edit', null, false ) === false,
    'E1S4 enqueue: plain brew edit => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'history', null, true ) === false,
    'E1S4 enqueue: brew history with preview flag => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $mainTitle, 'submit', null, true ) === false,
    'E1S4 enqueue: non-brew preview => no load' );
t_assert( HomebreweryWiki::shouldEnqueueRenderer( $brewTitle, 'submit', '5', true ) === false,
    'E1S4 enqueue: brew preview diff => no load' );

// Brew-preview recogniser: Manual: page, preview requested, no diff.
t_assert( HomebreweryWiki::isBrewPreview( $brewTitle, true, null ) === true,
    'E1S4 preview: brew preview recognised' );
t_assert( HomebreweryWiki::isBrewPreview( $brewTitle, false, null ) === false,
    'E1S4 preview: no preview request => not a preview' );
t_assert( HomebreweryWiki::isBrewPreview( $mainTitle, true, null ) === false,
    'E1S4 preview: non-brew => not a brew preview' );
t_assert( HomebreweryWiki::isBrewPreview( $brewTitle, true, '5' ) === false,
    'E1S4 preview: diff => not a preview' );
t_assert( HomebreweryWiki::isBrewPreview( null, true, null ) === false,
    'E1S4 preview: null title => not a preview' );

/**
 * Minimal stand-in for WebRequest, covering the accessors the extension and
 * the preview-source helper use.
 */
class HbwTestRequest {
    /** @var bool Whether the request was a POST. */
    var $posted;
    /** @var string Value returned by getText() (the raw textbox). */
    var $text;
    /** @var array Request values keyed by name. */
    var $vals;

    /**
     * @param bool   $posted Whether the request was a POST.
     * @param string $text   Raw wpTextbox1 value.
     * @param array  $vals   Request values (for getCheck/getVal).
     */
    function __construct( $posted, $text, $vals = array() ) {
        $this->posted = $posted;
        $this->text   = $text;
        $this->vals   = $vals;
    }

    /**
     * @return bool Whether the request was a POST.
     */
    function wasPosted() {
        return $this->posted;
    }

    /**
     * @param string $name Field name.
     * @return string Field value (the textbox for wpTextbox1).
     */
    function getText( $name ) {
        return $this->text;
    }

    /**
     * @param string $name Field name.
     * @return mixed Request value or null.
     */
    function getVal( $name ) {
        return isset( $this->vals[$name] ) ? $this->vals[$name] : null;
    }

    /**
     * Mirror WebRequest::getCheck() (1.14): presence connotes truth, so any
     * supplied value — including '' and '0' — counts as true.
     *
     * @param string $name Field name.
     * @return bool
     */
    function getCheck( $name ) {
        return ( $this->getVal( $name ) !== null );
    }
}

/**
 * Minimal OutputPage stand-in for the preview-replacement guard.
 */
class HbwTestOutput {
    /**
     * @param string $text Wikitext.
     * @return string Parsed HTML (identity is enough here).
     */
    function parse( $text ) {
        return $text;
    }
}

// Preview recogniser covers all four 1.14 entry points (E1S4T1).
t_assert( HomebreweryWiki::isPreviewRequest(
        new HbwTestRequest( true, '', array( 'wpPreview' => 'Show preview' ) ) ) === true,
    'E1S4 preview request: wpPreview recognised' );
t_assert( HomebreweryWiki::isPreviewRequest(
        new HbwTestRequest( true, '', array( 'wpLivePreview' => '1' ) ) ) === true,
    'E1S4 preview request: wpLivePreview recognised' );
// 1.14 getCheck() is presence-based, so a present-but-empty flag still counts.
t_assert( HomebreweryWiki::isPreviewRequest(
        new HbwTestRequest( true, '', array( 'wpPreview' => '' ) ) ) === true,
    'E1S4 preview request: empty wpPreview counts (presence connotes truth)' );
t_assert( HomebreweryWiki::isPreviewRequest(
        new HbwTestRequest( false, '', array( 'preview' => 'yes' ) ) ) === true,
    'E1S4 preview request: preview=yes recognised' );
t_assert( HomebreweryWiki::isPreviewRequest(
        new HbwTestRequest( false, '', array() ) ) === false,
    'E1S4 preview request: no flags => not a preview' );
t_assert( HomebreweryWiki::isPreviewRequest( null ) === false,
    'E1S4 preview request: non-object => false' );

// EditPage's own formtype covers preview-on-open via `previewonfirst`, which
// carries no request flag (E1S4T1).
HomebreweryWiki::$editFormPreview = true;
t_assert( HomebreweryWiki::isPreviewRequest(
        new HbwTestRequest( false, '', array() ) ) === true,
    'E1S4 preview request: EditPage preview-on-first state recognised' );
HomebreweryWiki::$editFormPreview = false;

// Posted preview source is trimmed exactly as EditPage::safeUnicodeInput does
// (E1S4T2), so the preview payload matches what a save would store.
$fake = new HbwTestRequest( true, "= Title =\n\nbody\n\n" );
t_assert( HomebreweryWiki::previewSource( $fake, null ) === "= Title =\n\nbody",
    'E1S4 preview source: posted textbox trimmed like EditPage' );
$fakeGet = new HbwTestRequest( false, '' );
t_assert( HomebreweryWiki::previewSource( $fakeGet, null ) === '',
    'E1S4 preview source: no article and no POST => empty' );

// OutputPageBeforeHTML fires for every parsed fragment (edit notices, tools,
// diffs) as well as the preview body, so replacement is armed by the edit form
// and gated on the stock previewnote marker, then disarmed (E1S4T4).
$savedTitle   = isset( $wgTitle ) ? $wgTitle : null;
$savedRequest = isset( $wgRequest ) ? $wgRequest : null;
$savedArticle = isset( $wgArticle ) ? $wgArticle : null;

$wgTitle   = $brewTitle;
$wgArticle = null;
$wgRequest = new HbwTestRequest( true, "= Preview =\n\nbody\n", array( 'wpPreview' => 'Show preview' ) );
$out       = new HbwTestOutput();

$fragment = '<div class="mw-editTools">tools</div>';
HomebreweryWiki::$editFormPreview = true;
HomebreweryWiki::$previewArmed = false;
HomebreweryWiki::$previewSourceText = "= Preview =\n\nbody";

$text = $fragment;
HomebreweryWiki::onOutputPageBeforeHTML( $out, $text );
t_assert( $text === $fragment,
    'E1S4 guard: unarmed handler leaves parsed fragments alone' );

HomebreweryWiki::$previewArmed = true;
$text = $fragment;
HomebreweryWiki::onOutputPageBeforeHTML( $out, $text );
t_assert( $text === $fragment,
    'E1S4 guard: fragment without previewnote is not replaced' );
t_assert( HomebreweryWiki::$previewArmed === true,
    'E1S4 guard: unrelated fragment keeps the handler armed' );

$previewBody = "<h2>Preview</h2>\n<div class='previewnote'>note</div>\n= Preview =\n\nbody";
$text = $previewBody;
HomebreweryWiki::onOutputPageBeforeHTML( $out, $text );
t_assert( strpos( $text, 'id="hbw-source"' ) !== false &&
          strpos( $text, 'hbw-brew' ) !== false,
    'E1S4 guard: stock preview body replaced with the shared placeholder' );
t_assert( strpos( $text, 'previewnote' ) !== false,
    'E1S4 guard: stock preview notice preserved' );
t_assert( HomebreweryWiki::$previewArmed === false,
    'E1S4 guard: handler disarmed after the preview body' );

$again = $previewBody;
HomebreweryWiki::onOutputPageBeforeHTML( $out, $again );
t_assert( $again === $previewBody,
    'E1S4 guard: replacement is single-shot' );

HomebreweryWiki::$editFormPreview = false;
HomebreweryWiki::$previewArmed = false;
HomebreweryWiki::$previewSourceText = null;
$wgTitle   = $savedTitle;
$wgRequest = $savedRequest;
$wgArticle = $savedArticle;

// --- E1S3: renderer asset list & load order (T1) ---
// markdown parser first, sanitizer second, render module last.
$assets = HomebreweryWiki::rendererAssets();
t_assert( count( $assets ) === 3, 'E1S3 assets: three scripts' );
t_assert( $assets[0] === HOMEBREWERYWIKI_MARKED_LIB,
    'E1S3 assets: marked loads first' );
t_assert( $assets[1] === HOMEBREWERYWIKI_PURIFY_LIB,
    'E1S3 assets: DOMPurify loads second' );
t_assert( $assets[2] === HOMEBREWERYWIKI_RENDER_MODULE,
    'E1S3 assets: render module loads last' );

// Running from the extension dir (repo layout) or from MW maintenance/
// (copied to hbwtest.php): resolve the extension directory either way.
$extDir = dirname( dirname( __FILE__ ) );
if ( !file_exists( $extDir . '/HomebreweryWiki.php' ) ) {
    $extDir .= '/extensions/HomebreweryWiki';
}
$relMarked   = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_MARKED_LIB );
$relPurify   = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_PURIFY_LIB );
$relRenderer = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_RENDER_MODULE );
t_assert( file_exists( $extDir . '/' . $relMarked ),
    'E1S3 assets: marked bundle present' );
t_assert( file_exists( $extDir . '/' . $relPurify ),
    'E1S3 assets: DOMPurify bundle present' );
t_assert( file_exists( $extDir . '/' . $relRenderer ),
    'E1S3 assets: render module present' );
t_assert( strpos( HOMEBREWERYWIKI_MARKED_LIB, '0.3.19' ) !== false,
    'E1S3 assets: marked version pinned' );
t_assert( strpos( HOMEBREWERYWIKI_PURIFY_LIB, '2.5.8' ) !== false,
    'E1S3 assets: DOMPurify version pinned' );

// --- E1S2 (kept): hidden source placeholder (T2) ---
$ph = HomebreweryWiki::brewPlaceholder( "= Title =\n<b>x</b> & \"q\"" );
t_assert( strpos( $ph, 'class="hbw-brew"' ) !== false, 'E1S2 placeholder: scoping wrapper present' );
t_assert( strpos( $ph, 'id="hbw-source"' ) !== false, 'E1S2 placeholder: source id present' );
t_assert( strpos( $ph, 'display:none' ) !== false, 'E1S2 placeholder: hidden' );
t_assert( strpos( $ph, '<div class="hbw-source"' ) !== false,
    'E1S2 placeholder: source is a div (leading newline survives parsing)' );
t_assert( strpos( $ph, '<pre class="hbw-source"' ) === false,
    'E1S2 placeholder: source is not a pre' );
t_assert( strpos( $ph, '&lt;b&gt;' ) !== false, 'E1S2 placeholder: < > escaped' );
t_assert( strpos( $ph, '&amp;' ) !== false, 'E1S2 placeholder: ampersand escaped' );
t_assert( strpos( $ph, '<b>' ) === false, 'E1S2 placeholder: no raw markup leaks' );
t_assert( strpos( HomebreweryWiki::brewPlaceholder( '' ), 'id="hbw-source"' ) !== false,
    'E1S2 placeholder: empty source still emits placeholder' );

// Leading newline must be carried verbatim in the hidden div.
$ph_nl = HomebreweryWiki::brewPlaceholder( "\n= Title =" );
t_assert( strpos( $ph_nl, "style=\"display:none\">\n= Title =</div>" ) !== false,
    'E1S2 placeholder: leading newline preserved in source div' );

// No-JS fallback: visible escaped <pre> inside <noscript>, with a sacrificial
// newline directly after the start tag (the parser strips that one, not ours).
t_assert( strpos( $ph, '<noscript><pre class="hbw-brew-text">' . "\n" ) !== false,
    'E1S2 placeholder: noscript fallback present with sacrificial newline' );
t_assert( strpos( $ph, '</pre></noscript>' ) !== false,
    'E1S2 placeholder: noscript fallback is escaped preformatted text' );
$ph_nl2 = HomebreweryWiki::brewPlaceholder( "\n= Title =" );
t_assert( strpos( $ph_nl2, '<noscript><pre class="hbw-brew-text">' . "\n\n= Title =" ) !== false,
    'E1S2 placeholder: noscript keeps a real leading newline' );

echo "\n$pass passed, $fail failed\n";
exit( $fail > 0 ? 1 : 0 );
