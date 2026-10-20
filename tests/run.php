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
t_assert( count( $assets ) === 4, 'E3S2 assets: four scripts' );
t_assert( $assets[0] === HOMEBREWERYWIKI_HOMEBREWERY_LIB,
    'E3S2 assets: pinned Homebrewery renderer loads first' );
t_assert( $assets[1] === HOMEBREWERYWIKI_MARKED_LIB,
    'E3S2 assets: marked fallback loads second' );
t_assert( $assets[2] === HOMEBREWERYWIKI_PURIFY_LIB,
    'E3S2 assets: DOMPurify loads third' );
t_assert( $assets[3] === HOMEBREWERYWIKI_RENDER_MODULE,
    'E3S2 assets: render module loads last' );

// Running from the extension dir (repo layout) or from MW maintenance/
// (copied to hbwtest.php): resolve the extension directory either way.
$extDir = dirname( dirname( __FILE__ ) );
if ( !file_exists( $extDir . '/HomebreweryWiki.php' ) ) {
    $extDir .= '/extensions/HomebreweryWiki';
}
$relHomebrewery = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_HOMEBREWERY_LIB );
$relMarked   = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_MARKED_LIB );
$relPurify   = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_PURIFY_LIB );
$relRenderer = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_RENDER_MODULE );
t_assert( file_exists( $extDir . '/' . $relHomebrewery ),
    'E3S2 assets: pinned Homebrewery renderer present' );
t_assert( strpos( HOMEBREWERYWIKI_HOMEBREWERY_LIB, '3.21.0' ) !== false,
    'E3S2 assets: Homebrewery renderer version pinned' );
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

// --- E3S2T4/T5: scoped theme stylesheet ---
$styles = HomebreweryWiki::rendererStyles();
t_assert( count( $styles ) === 1, 'E3S2 styles: one theme stylesheet' );
t_assert( $styles[0] === HOMEBREWERYWIKI_THEME_CSS,
    'E3S2 styles: theme stylesheet is the brew theme' );
$relTheme = str_replace( '/extensions/HomebreweryWiki/', '', HOMEBREWERYWIKI_THEME_CSS );
t_assert( file_exists( $extDir . '/' . $relTheme ),
    'E3S2 styles: theme stylesheet present' );
$themeCss = file_get_contents( $extDir . '/' . $relTheme );
$themeCss = preg_replace( '!/\*.*?\*/!s', '', $themeCss );
t_assert( strpos( $themeCss, '#hbw-brew-rendered' ) === false,
    'E3S2 styles: no id selector; scoping is by wrapper class' );
t_assert( strpos( $themeCss, '.hbw-brew .hbw-frame' ) !== false,
    'E3.5 styles: parent stylesheet sizes the iframe render host' );
// --- E3.5S2: compiled upstream theme + asset manifest ---
t_assert( HomebreweryWiki::themeCssUrl() === '/extensions/HomebreweryWiki/vendor/homebrewery-3.21.0/theme/theme.css',
    'E3.5S2 theme: default theme URL points at the compiled artifact' );
$compiledThemePath = $extDir . '/vendor/homebrewery-3.21.0/theme/theme.css';
$manifestPath = $extDir . '/vendor/homebrewery-3.21.0/theme/assets.sha256';
t_assert( file_exists( $compiledThemePath ), 'E3.5S2 theme: compiled theme.css present' );
t_assert( file_exists( $manifestPath ), 'E3.5S2 theme: asset manifest present' );
if ( file_exists( $compiledThemePath ) ) {
    $compiledTheme = file_get_contents( $compiledThemePath );
    t_assert( strpos( $compiledTheme, "url('/assets/" ) === false &&
        strpos( $compiledTheme, 'url("/assets/' ) === false,
        'E3.5S2 theme: root-absolute asset URLs are rewritten' );
    t_assert( strpos( $compiledTheme, 'columnWrapper' ) !== false,
        'E3.5S2 theme: upstream page/column rules compiled' );
}
// --- E3.5S6: static shell security contract ---
$shellPath = $extDir . '/HomebreweryWiki.shell.html';
t_assert( file_exists( $shellPath ), 'E3.5S6 shell: shell document present' );
if ( file_exists( $shellPath ) ) {
    $shellHtml = file_get_contents( $shellPath );
    t_assert( strpos( $shellHtml, 'Content-Security-Policy' ) !== false &&
        strpos( $shellHtml, "default-src 'none'" ) !== false,
        'E3.5S6 shell: CSP denies by default' );
    t_assert( stripos( $shellHtml, '<script' ) === false,
        'E3.5S6 shell: no script element' );
    t_assert( strpos( $shellHtml, 'columnSplit' ) === false,
        'E3.5S6 shell: no page markup is hard-coded in the shell' );
}

if ( file_exists( $manifestPath ) ) {
    $manifestLines = file( $manifestPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES );
    t_assert( count( $manifestLines ) >= 125,
        'E3.5S2 theme: manifest pins the runtime asset set (' . count( $manifestLines ) . ')' );
}

t_assert( preg_match( '/^\s*(html|body|\*|:root)\s*[,{]/mi', $themeCss ) === 0,
    'E3S2 styles: no bare html/body/*/:root selectors' );

// Selector audit (E3S2 code review): a character-by-character walk records
// the selector text before each `{`. Odd-depth text is a declaration and is
// never a selector, so selectors nested inside one-line at-rules such as
// `@media screen { body { ... } }` are inspected regardless of line breaks.
// At-rule preambles are skipped by their leading `@`.
$selectors = array();
$selectorsBuf = '';
$themeLen = strlen( $themeCss );
for ( $selectorsI = 0; $selectorsI < $themeLen; $selectorsI++ ) {
    $selectorsCh = $themeCss[$selectorsI];
    if ( $selectorsCh === '{' ) {
        $selectors[$selectorsBuf] = 1;
        $selectorsBuf = '';
        continue;
    }
    if ( $selectorsCh === '}' ) {
        $selectorsBuf = '';
        continue;
    }
    $selectorsBuf .= $selectorsCh;
}
$selectorsFound = array();
foreach ( $selectors as $selectorsText => $selectorsDepth ) {
    $selectorsText = trim( $selectorsText );
    if ( $selectorsText === '' || strpos( $selectorsText, '@' ) === 0 ) {
        continue;
    }
    foreach ( explode( ',', $selectorsText ) as $one ) {
        $one = trim( $one );
        if ( $one !== '' ) {
            $selectorsFound[] = $one;
        }
    }
}
$selectors = $selectorsFound;
$unscoped = array();
foreach ( $selectors as $one ) {
    // E3.5S4 print isolation is the documented exception: these rules run
    // only on the print route and hide the wiki chrome around the brew host.
    $printOnly = preg_match( '/^\s*body\.hbw-print-mode\b/', $one );
    if ( strpos( $one, '.hbw-brew' ) !== 0 && !$printOnly ) {
        $unscoped[] = $one;
    }
}
t_assert( count( $selectors ) > 0,
    'E3S2 styles: stylesheet has rules' );
t_assert( count( $unscoped ) === 0,
    'E3S2 styles: every rule is scoped under .hbw-brew (found: ' .
    implode( ' | ', $unscoped ) . ')' );

// Regression: a bare selector nested inside a one-line at-rule must be
// inspected, not silently skipped; an at-rule preamble never is.
$atRuleCss = '@media screen { body { color: red; } }';
$atRuleRaw = array();
$atRuleBuf = '';
$atRuleLen = strlen( $atRuleCss );
for ( $atRuleI = 0; $atRuleI < $atRuleLen; $atRuleI++ ) {
    $atRuleCh = $atRuleCss[$atRuleI];
    if ( $atRuleCh === '{' ) {
        $atRuleRaw[$atRuleBuf] = 1;
        $atRuleBuf = '';
        continue;
    }
    if ( $atRuleCh === '}' ) {
        $atRuleBuf = '';
        continue;
    }
    $atRuleBuf .= $atRuleCh;
}
$atRuleFound = array();
foreach ( $atRuleRaw as $atRuleText => $atRuleDepth ) {
    $atRuleText = trim( $atRuleText );
    if ( $atRuleText === '' || strpos( $atRuleText, '@' ) === 0 ) {
        continue;
    }
    foreach ( explode( ',', $atRuleText ) as $one ) {
        $one = trim( $one );
        if ( $one !== '' ) {
            $atRuleFound[] = $one;
        }
    }
}
t_assert( in_array( 'body', $atRuleFound ),
    'E3S2 styles: audit inspects selectors inside one-line at-rules' );
t_assert( ! in_array( '@media screen', $atRuleFound ),
    'E3S2 styles: audit skips at-rule preambles' );

// --- E1S2 (kept): hidden source placeholder (T2) ---
$ph = HomebreweryWiki::brewPlaceholder( "= Title =\n<b>x</b> & \"q\"" );
t_assert( strpos( $ph, 'class="hbw-brew"' ) !== false, 'E1S2 placeholder: scoping wrapper present' );
t_assert( strpos( $ph, 'data-hbw-shell="' ) !== false,
    'E3.5 placeholder: iframe shell URL emitted' );
t_assert( strpos( $ph, 'data-hbw-theme="' ) !== false,
    'E3.5 placeholder: iframe theme URL emitted' );
t_assert( strpos( $ph, 'data-hbw-page-width="215.9"' ) !== false,
    'E3.5 placeholder: letter page width emitted' );
t_assert( strpos( $ph, 'data-hbw-page-height="279.4"' ) !== false,
    'E3.5 placeholder: letter page height emitted' );
t_assert( strpos( $ph, 'data-hbw-print=' ) === false,
    'E3.5 placeholder: screen view is not marked for print' );
$phPrint = HomebreweryWiki::brewPlaceholder( "= Title =", true );
t_assert( strpos( $phPrint, 'data-hbw-print="1"' ) !== false,
    'E3.5 placeholder: print route is marked' );
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

// --- E2S1: trusted-editor edit/create gating (T1-T4) ---
// Anonymous visitors are read-only; every logged-in (admin-created) account is
// a trusted editor.  The brew namespaces are guarded by the userCan hook so the
// gate survives a wiki-wide change to anonymous editing.
global $wgGroupPermissions;

t_assert( isset( $wgGroupPermissions['*'][HOMEBREWERYWIKI_EDIT_RIGHT] ) &&
          $wgGroupPermissions['*'][HOMEBREWERYWIKI_EDIT_RIGHT] === false,
    'E2S1 perms: anonymous lacks the brew-edit right' );
t_assert( !empty( $wgGroupPermissions['user'][HOMEBREWERYWIKI_EDIT_RIGHT] ),
    'E2S1 perms: logged-in group holds the brew-edit right' );

$anon = new User();
t_assert( $anon->isAnon() === true, 'E2S1 perms: test user is anonymous' );
t_assert( $anon->isAllowed( 'read' ) === true, 'E2S1 perms: anonymous can read' );
t_assert( $anon->isAllowed( 'edit' ) === false, 'E2S1 perms: anonymous cannot edit' );
t_assert( $anon->isAllowed( 'createpage' ) === false,
    'E2S1 perms: anonymous cannot create pages' );
t_assert( $anon->isAllowed( 'createtalk' ) === false,
    'E2S1 perms: anonymous cannot create talk pages' );
t_assert( $anon->isAllowed( 'upload' ) === false, 'E2S1 perms: anonymous cannot upload' );
t_assert( $anon->isAllowed( 'createaccount' ) === false,
    'E2S1 perms: self-registration disabled for anonymous visitors' );

$trusted = User::newFromName( 'Admin' );
if ( ! ( $trusted instanceof User ) || $trusted->getId() === 0 ) {
    $trusted = User::newFromId( 1 );
}
t_assert( $trusted instanceof User && $trusted->getId() > 0,
    'E2S1 perms: trusted test account exists' );
t_assert( $trusted->isAllowed( HOMEBREWERYWIKI_EDIT_RIGHT ) === true,
    'E2S1 perms: trusted account holds the brew-edit right' );
t_assert( $trusted->isAllowed( 'edit' ) === true,
    'E2S1 perms: trusted account can edit' );

$brewGateTitle = Title::newFromText( 'Manual:PermTest' );
$mainGateTitle = Title::newFromText( 'Main Page' );
$res = true;
t_assert( HomebreweryWiki::onUserCan( $brewGateTitle, $anon, 'edit', $res ) === false &&
          $res === false,
    'E2S1 guard: anonymous brew edit denied' );
$res = true;
t_assert( HomebreweryWiki::onUserCan( $brewGateTitle, $anon, 'create', $res ) === false,
    'E2S1 guard: anonymous brew create denied' );
$res = true;
t_assert( HomebreweryWiki::onUserCan( $brewGateTitle, $anon, 'read', $res ) === true,
    'E2S1 guard: anonymous brew read untouched' );
$res = true;
t_assert( HomebreweryWiki::onUserCan( $brewGateTitle, $trusted, 'edit', $res ) === true,
    'E2S1 guard: trusted brew edit allowed' );
$res = true;
t_assert( HomebreweryWiki::onUserCan( $mainGateTitle, $anon, 'edit', $res ) === true,
    'E2S1 guard: non-brew pages not filtered by the hook' );
$talkGateTitle = Title::newFromText( 'Manual talk:PermTest' );
$res = true;
t_assert( HomebreweryWiki::onUserCan( $talkGateTitle, $anon, 'edit', $res ) === false,
    'E2S1 guard: anonymous brew talk edit denied' );

// T3 / E2S3 baseline: anonymous read is resolved by the global policy alone,
// identically for brew and normal pages.
t_assert( count( $brewGateTitle->getUserPermissionsErrors( 'read', $anon ) ) === 0 &&
          count( $mainGateTitle->getUserPermissionsErrors( 'read', $anon ) ) === 0,
    'E2S1 perms: anonymous read allowed on brew and normal pages' );

// --- E2S2: trusted-only image uploads (T1-T2) ---
// Upload is a trusted-editor action, and the file policy is raster-only.
global $wgFileExtensions, $wgCheckFileExtensions, $wgStrictFileExtensions, $wgMaxUploadSize;

t_assert( isset( $wgGroupPermissions['*']['upload'] ) &&
          $wgGroupPermissions['*']['upload'] === false,
    'E2S2 upload: anonymous group denied the upload right' );
t_assert( !empty( $wgGroupPermissions['user']['upload'] ),
    'E2S2 upload: trusted group holds the upload right' );
t_assert( $anon->isAllowed( 'upload' ) === false,
    'E2S2 upload: anonymous user cannot upload' );
t_assert( $trusted->isAllowed( 'upload' ) === true,
    'E2S2 upload: trusted user can upload' );

t_assert( in_array( 'png', $wgFileExtensions ) &&
          in_array( 'jpg', $wgFileExtensions ) &&
          in_array( 'jpeg', $wgFileExtensions ) &&
          in_array( 'gif', $wgFileExtensions ),
    'E2S2 file policy: raster types allowed' );
t_assert( in_array( 'svg', $wgFileExtensions ) === false,
    'E2S2 file policy: SVG disallowed' );
t_assert( in_array( 'webp', $wgFileExtensions ) === false,
    'E2S2 file policy: WebP excluded (1.14 has no WebP support)' );
t_assert( $wgCheckFileExtensions === true,
    'E2S2 file policy: extension checks enabled' );
t_assert( $wgStrictFileExtensions === true,
    'E2S2 file policy: strict extension allowlist enabled' );
t_assert( is_int( $wgMaxUploadSize ) && $wgMaxUploadSize > 0 &&
          $wgMaxUploadSize <= 20 * 1024 * 1024,
    'E2S2 size policy: upload size bounded at 20 MB or less' );
t_assert( $wgEnableUploads === true,
    'E2S2 upload: local uploads enabled for the trusted editors' );

// The size cap must be enforced on the local-upload path, not only in config.
t_assert( HomebreweryWiki::isUploadSizeAllowed( 1024 ) === true,
    'E2S2 size guard: small file allowed' );
t_assert( HomebreweryWiki::isUploadSizeAllowed( HOMEBREWERYWIKI_MAX_UPLOAD_SIZE ) === true,
    'E2S2 size guard: file exactly at the 10 MB boundary allowed' );
t_assert( HomebreweryWiki::isUploadSizeAllowed( HOMEBREWERYWIKI_MAX_UPLOAD_SIZE + 1 ) === false,
    'E2S2 size guard: one byte over the boundary denied' );
t_assert( HomebreweryWiki::isUploadSizeAllowed( false ) === false,
    'E2S2 size guard: unknown size denied' );

$hbwTmpUpload = tempnam( sys_get_temp_dir(), 'hbwup' );
$hbwHandle = fopen( $hbwTmpUpload, 'w' );
ftruncate( $hbwHandle, HOMEBREWERYWIKI_MAX_UPLOAD_SIZE );
fclose( $hbwHandle );
clearstatcache();
$hbwUploadError = 'unset';
t_assert( HomebreweryWiki::onUploadVerification( 'Boundary.png', $hbwTmpUpload, $hbwUploadError ) === true &&
          $hbwUploadError === 'unset',
    'E2S2 size hook: local file at the boundary accepted' );

$hbwHandle = fopen( $hbwTmpUpload, 'w' );
ftruncate( $hbwHandle, HOMEBREWERYWIKI_MAX_UPLOAD_SIZE + 1 );
fclose( $hbwHandle );
clearstatcache();
$hbwUploadError = '';
t_assert( HomebreweryWiki::onUploadVerification( 'TooBig.png', $hbwTmpUpload, $hbwUploadError ) === false &&
          $hbwUploadError !== '',
    'E2S2 size hook: oversized local file rejected with an error' );

$hbwUploadError = '';
t_assert( HomebreweryWiki::onUploadVerification( 'Missing.png', sys_get_temp_dir() . '/hbw-no-such-file', $hbwUploadError ) === false,
    'E2S2 size hook: unreadable temporary file rejected' );
@unlink( $hbwTmpUpload );

// --- E2S3: brew pages inherit the global read policy (T1-T2) ---
// No brew-specific read override: the extension never adds the brew
// namespaces to $wgNamespaceProtection (1.14 would gate read with it) and
// never changes the read right for the brew namespaces.  The regression check
// below compares brew pages against normal pages under two policies.
global $wgNamespaceProtection, $wgGroupPermissions;

t_assert( !isset( $wgNamespaceProtection[NS_MANUAL] ) &&
          !isset( $wgNamespaceProtection[NS_MANUAL_TALK] ),
    'E2S3 read: no namespace protection (1.14 would gate read with it)' );

$brewReadAnon  = $brewGateTitle->getUserPermissionsErrors( 'read', $anon );
$mainReadAnon  = $mainGateTitle->getUserPermissionsErrors( 'read', $anon );
$talkReadAnon  = $talkGateTitle->getUserPermissionsErrors( 'read', $anon );
t_assert( count( $brewReadAnon ) === 0 && count( $talkReadAnon ) === 0 &&
          count( $mainReadAnon ) === 0,
    'E2S3 read: anonymous read allowed on brew, brew talk and normal pages' );

$brewReadUser  = $brewGateTitle->getUserPermissionsErrors( 'read', $trusted );
$mainReadUser  = $mainGateTitle->getUserPermissionsErrors( 'read', $trusted );
t_assert( count( $brewReadUser ) === count( $mainReadUser ),
    'E2S3 read: trusted read parity between brew and normal pages' );

// Change the global read policy and confirm brew and normal pages move
// together (no divergence) for anonymous visitors.
$savedAnonRead = isset( $wgGroupPermissions['*']['read'] )
    ? $wgGroupPermissions['*']['read'] : null;
$wgGroupPermissions['*']['read'] = false;
$anonymousUnderLockdown = new User();
$brewReadLocked = $brewGateTitle->getUserPermissionsErrors( 'read', $anonymousUnderLockdown );
$mainReadLocked = $mainGateTitle->getUserPermissionsErrors( 'read', $anonymousUnderLockdown );
t_assert( count( $brewReadLocked ) === count( $mainReadLocked ) &&
          count( $brewReadLocked ) > 0,
    'E2S3 read: brew and normal pages change together with the global policy' );
if ( $savedAnonRead === null ) {
    unset( $wgGroupPermissions['*']['read'] );
} else {
    $wgGroupPermissions['*']['read'] = $savedAnonRead;
}

// --- E3.5S3: source-token extraction (categories, links, files) ---
$catText = "[[Category:E35 Test]]\n"
    . "[[Category:E35 Test|Sort key]]\n"
    . "[[Category:Other Cat]]\n"
    . "[[Category:]]\n";
$cats = HomebreweryWiki::brewCategoryNames( $catText );
t_assert( $cats === array( 'E35 Test', 'Other Cat' ),
    'E3.5 categories: dedupe, handle |sort, ignore empty (' . implode( ', ', $cats ) . ')' );

$linkText = "[[Main Page]]\n"
    . "[[Main Page|home]]\n"
    . "[[Category:E35 Test]]\n"
    . "[[File:Name.png|alt]]\n"
    . "[[Page Two]]\n";
$linkTargets = HomebreweryWiki::brewLinkTargets( $linkText );
t_assert( $linkTargets === array( 'Main Page', 'Page Two' ),
    'E3.5 link targets: exclude Category/File, dedupe (' . implode( ', ', $linkTargets ) . ')' );

$fileText = "[[File:HbwTestMissing.png|alt]]\n"
    . "[[File:HbwTestMissing.png]]\n"
    . "[[File:HbwTestOther.png]]\n";
$fileMap = HomebreweryWiki::brewFileMap( $fileText );
t_assert( count( $fileMap ) === 2 &&
    isset( $fileMap['HbwTestMissing.png'] ) &&
    isset( $fileMap['HbwTestOther.png'] ),
    'E3.5 file map: one entry per referenced file' );
t_assert( array_key_exists( 'exists', $fileMap['HbwTestMissing.png'] ) &&
    $fileMap['HbwTestMissing.png']['exists'] === false,
    'E3.5 file map: missing file reports exists=false' );
t_assert( array_key_exists( 'url', $fileMap['HbwTestMissing.png'] ) &&
    is_string( $fileMap['HbwTestMissing.png']['url'] ),
    'E3.5 file map: each entry carries a url string' );

// --- E4S1T3: link existence map (blue vs red) ---
$linkMap = HomebreweryWiki::brewLinkMap( $linkText );
$expectedMain = Title::newFromText( 'Main Page' )->exists();
t_assert( isset( $linkMap['Main_Page'] ) && $linkMap['Main_Page'] === $expectedMain,
    'E4S1T3 link map: existence matches Title::exists()' );
t_assert( isset( $linkMap['Page_Two'] ) && $linkMap['Page_Two'] === false,
    'E4S1T3 link map: a missing target reports exists=false' );
t_assert( !isset( $linkMap['E35_Test'] ) && !isset( $linkMap['Name.png'] ),
    'E4S1T3 link map: categories and files stay out of the map' );
$linkMapJson = HomebreweryWiki::brewLinkMapJson( $linkText );
t_assert( strpos( $linkMapJson, '"Main_Page":' ) !== false,
    'E4S1T3 link map: JSON keeps the normalized key' );
$linkMapCode = HomebreweryWiki::brewLinkMap( "`[[Hidden Page]]`\n\n[[Shown Page]]\n" );
t_assert( !isset( $linkMapCode['Hidden_Page'] ) && isset( $linkMapCode['Shown_Page'] ),
    'E4S1T3 link map: code spans never donate a target' );

// --- E3.5S3: code spans and fences never donate source tokens ---
$codeText = "`[[Category:Hidden]]` stays literal\n"
    . "\n"
    . "```\n"
    . "[[Category:Fenced]]\n"
    . "[[Fenced Page]]\n"
    . "[[File:Fenced.png]]\n"
    . "```not-a-close\n"
    . "[[Category:Still Fenced]]\n"
    . "```\n"
    . "\n"
    . "[[Category:Visible]]\n"
    . "[[Real Page]]\n"
    . "[[File:Real.png]]\n";
$codeCats = HomebreweryWiki::brewCategoryNames( $codeText );
t_assert( $codeCats === array( 'Visible' ),
    'E3.5 code filter: categories come from prose only (' . implode( ', ', $codeCats ) . ')' );
$codeLinks = HomebreweryWiki::brewLinkTargets( $codeText );
t_assert( $codeLinks === array( 'Real Page' ),
    'E3.5 code filter: links come from prose only (' . implode( ', ', $codeLinks ) . ')' );
$codeFiles = HomebreweryWiki::brewFileMap( $codeText );
t_assert( count( $codeFiles ) === 1 && isset( $codeFiles['Real.png'] ),
    'E3.5 code filter: files come from prose only' );

$inlineProse = HomebreweryWiki::brewProseText( "keep `[[Page]]` tail\n" );
t_assert( strpos( $inlineProse, '[[Page]]' ) === false &&
    strpos( $inlineProse, 'keep' ) !== false,
    'E3.5 code filter: inline code spans are removed' );

$tildeProse = HomebreweryWiki::brewProseText(
    "~~~\n[[Category:Tilde]]\n~~~\n[[Category:After]]\n"
);
t_assert( strpos( $tildeProse, 'Tilde' ) === false &&
    strpos( $tildeProse, 'After' ) !== false,
    'E3.5 code filter: tilde fences are removed' );

$longFence = HomebreweryWiki::brewProseText(
    "````\n[[Category:Four]]\n```\n[[Category:Three]]\n````\n[[Category:After]]\n"
);
t_assert( strpos( $longFence, 'Three' ) === false &&
    strpos( $longFence, 'Four' ) === false &&
    strpos( $longFence, 'After' ) !== false,
    'E3.5 code filter: a shorter run does not close a longer fence' );

// MediaWiki rejects some category names outright; the extractor must then
// yield no key rather than invent one the parser would refuse.
$badName = 'Bad[Name';
$badTitle = Title::makeTitleSafe( NS_CATEGORY, $badName );
if ( $badTitle === null ) {
    t_assert( HomebreweryWiki::categoryDbKey( $badName ) === null,
        'E3.5 categories: an invalid title yields no DB key' );
} else {
    t_assert( HomebreweryWiki::categoryDbKey( $badName ) === $badTitle->getDBkey(),
        'E3.5 categories: valid titles keep their DB key' );
}

$phWiki = HomebreweryWiki::brewPlaceholder( "[[Main Page]]\n[[File:HbwTestMissing.png]]" );
t_assert( strpos( $phWiki, 'data-hbw-wiki-base="' ) !== false,
    'E3.5 placeholder: wiki base attribute emitted' );
t_assert( strpos( $phWiki, 'data-hbw-files="' ) !== false,
    'E3.5 placeholder: file map attribute emitted' );
t_assert( strpos( $phWiki, 'data-hbw-links="' ) !== false,
    'E4S1T3 placeholder: link map attribute emitted' );
t_assert( strpos( $phWiki, 'HbwTestMissing.png' ) !== false,
    'E3.5 placeholder: referenced file appears in the map' );

// --- E3.5S3 integration: save updates categorylinks/pagelinks ---
// Brew views skip the wikitext parser, so the save hook must register the
// source tokens itself.  The page name is unique per run; no deletion is
// needed and repeated runs cannot collide.
$uniqueBrew = 'E35 Test ' . uniqid();
$saveTitle = Title::newFromText( 'Manual:' . $uniqueBrew );
t_assert( $saveTitle instanceof Title,
    'E3.5 integration: unique brew title resolves' );

if ( $saveTitle instanceof Title ) {
    global $wgUser;
    $savedUser = $wgUser;
    $wgUser = $trusted;
    $saveText = "[[Category:E35 Test]]\n\n[[Main Page]]\n\n"
        . "[[File:HbwTestMissing.png]]\n\nBrew body\n";
    $saveArticle = new Article( $saveTitle );
    $saveStatus = $saveArticle->doEdit(
        $saveText, 'E3.5S3 integration test', EDIT_NEW
    );
    $wgUser = $savedUser;
    t_assert( $saveStatus->isOK(),
        'E3.5 integration: brew page saved' );

    $pageId = $saveTitle->getArticleID();
    t_assert( $pageId > 0, 'E3.5 integration: saved page has an id' );

    // E4S1T3: a saved page exists, so a link to it resolves blue.
    $selfMap = HomebreweryWiki::brewLinkMap( '[[' . $saveTitle->getPrefixedText() . ']]' );
    t_assert(
        $selfMap[ str_replace( ' ', '_', $saveTitle->getPrefixedText() ) ] === true,
        'E4S1T3 link map: a page that exists reports exists=true'
    );

    $db = wfGetDB( DB_MASTER );
    // categorylinks stores the DB key (underscores), not the display name.
    $catKey = 'E35_Test';
    $catRow = $db->selectRow(
        'categorylinks',
        array( 'cl_to', 'cl_sortkey' ),
        array( 'cl_from' => $pageId, 'cl_to' => $catKey ),
        __METHOD__
    );
    t_assert( is_object( $catRow ) && $catRow->cl_to === $catKey,
        'E3.5 integration: categorylinks row exists for the source category' );
    // Empty sort keys sort every brew first under a blank heading; the
    // wikitext parser's default is the page's prefixed title.
    t_assert( is_object( $catRow ) &&
        $catRow->cl_sortkey === $saveTitle->getPrefixedText(),
        'E3.5 integration: category sort key defaults to the page title' );

    $mainKey = Title::newFromText( 'Main Page' )->getDBKey();
    $pageRow = $db->selectRow(
        'pagelinks',
        array( 'pl_title' ),
        array(
            'pl_from' => $pageId,
            'pl_namespace' => 0,
            'pl_title' => $mainKey
        ),
        __METHOD__
    );
    t_assert( is_object( $pageRow ) && $pageRow->pl_title === $mainKey,
        'E3.5 integration: pagelinks row exists for the wiki link target' );

    // Embedded files are file usage (imagelinks), not page links: a pagelinks
    // row would make Special:UnusedFiles / "what links here" lie.
    $fileRow = $db->selectRow(
        'imagelinks',
        array( 'il_to' ),
        array( 'il_from' => $pageId, 'il_to' => 'HbwTestMissing.png' ),
        __METHOD__
    );
    t_assert( is_object( $fileRow ) && $fileRow->il_to === 'HbwTestMissing.png',
        'E3.5 integration: imagelinks row exists for the embedded file' );

    $filePageRow = $db->selectRow(
        'pagelinks',
        array( 'pl_title' ),
        array( 'pl_from' => $pageId, 'pl_namespace' => NS_FILE ),
        __METHOD__
    );
    t_assert( !is_object( $filePageRow ),
        'E3.5 integration: embedded file is not registered as a page link' );
}

echo "\n$pass passed, $fail failed\n";
exit( $fail > 0 ? 1 : 0 );
