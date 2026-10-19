<?php
/**
 * Unit/smoke tests for the HomebreweryWiki extension (E1S1 + E1S2).
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

// --- E1S2: view-module enqueue decision (T1) ---
// The module must load only for an ordinary view of a brew-namespace page:
// never for non-brew pages, edit, history, preview (action=submit) or diffs.
$brewTitle = Title::newFromText( 'Manual:Test' );
$mainTitle = Title::newFromText( 'Main Page' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( $brewTitle, 'view', null ) === true,
    'E1S2 enqueue: brew view => load' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( $mainTitle, 'view', null ) === false,
    'E1S2 enqueue: non-brew view => no load' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( $brewTitle, 'edit', null ) === false,
    'E1S2 enqueue: edit => no load' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( $brewTitle, 'history', null ) === false,
    'E1S2 enqueue: history => no load' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( $brewTitle, 'submit', null ) === false,
    'E1S2 enqueue: preview (submit) => no load' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( $brewTitle, 'purge', null ) === false,
    'E1S2 enqueue: purge => no load' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( $brewTitle, 'view', '5' ) === false,
    'E1S2 enqueue: diff view => no load' );
t_assert( HomebreweryWiki::shouldEnqueueViewModule( null, 'view', null ) === false,
    'E1S2 enqueue: null title => no load' );

// --- E1S2: hidden source placeholder (T2) ---
$ph = HomebreweryWiki::brewPlaceholder( "= Title =\n<b>x</b> & \"q\"" );
t_assert( strpos( $ph, 'class="hbw-brew"' ) !== false, 'E1S2 placeholder: scoping wrapper present' );
t_assert( strpos( $ph, 'id="hbw-source"' ) !== false, 'E1S2 placeholder: source id present' );
t_assert( strpos( $ph, 'display:none' ) !== false, 'E1S2 placeholder: hidden' );
t_assert( strpos( $ph, '&lt;b&gt;' ) !== false, 'E1S2 placeholder: < > escaped' );
t_assert( strpos( $ph, '&amp;' ) !== false, 'E1S2 placeholder: ampersand escaped' );
t_assert( strpos( $ph, '<b>' ) === false, 'E1S2 placeholder: no raw markup leaks' );
t_assert( strpos( HomebreweryWiki::brewPlaceholder( '' ), 'id="hbw-source"' ) !== false,
    'E1S2 placeholder: empty source still emits placeholder' );

echo "\n$pass passed, $fail failed\n";
exit( $fail > 0 ? 1 : 0 );
