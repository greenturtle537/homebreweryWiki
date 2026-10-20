<?php
/**
 * LocalSettings.php for the E3S5 MediaWiki 1.14.1 test harness.
 *
 * `includes/DefaultSettings.php` assigns `$wgDBtype = "mysql"` unconditionally,
 * so it must be required *first*: any override placed before it is reverted.
 *
 * @file
 */

require_once( dirname( __FILE__ ) . '/includes/DefaultSettings.php' );

$wgSitename         = 'HomebreweryWiki Test';
$wgScriptPath       = '';
$wgServer           = 'http://127.0.0.1:8080';
$wgLanguageCode     = 'en';
$wgDefaultSkin      = 'monobook';

// SQLite keeps the harness to a single container.
$wgDBtype           = 'sqlite';
$wgDBname           = 'hbw';
$wgDBuser           = '';
$wgDBpassword       = '';
$wgDBprefix         = '';
$wgSQLiteDataDir    = getenv( 'MW_DATA_DIR' ) ?: '/srv/data';
$wgSQLiteDataDirMode = 0777;

$wgEnableUploads    = false;
$wgUseImageMagick   = false;
$wgShowExceptionDetails = true;

require_once( dirname( __FILE__ ) . '/extensions/HomebreweryWiki/HomebreweryWiki.php' );
