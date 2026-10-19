<?php
/**
 * Internationalisation for the HomebreweryWiki extension.
 *
 * MediaWiki 1.14 i18n files are plain PHP setting a global $messages array.
 *
 * @file
 */

if ( !defined( 'MEDIAWIKI' ) ) {
    die( 'This file is a MediaWiki extension and must not be loaded directly.' );
}

$messages = array();

/** English (English) */
$messages['en'] = array(
    'homebrewerywiki-desc'                => 'Renders Homebrewery-flavoured markdown (brew pages) inside the standard MediaWiki content pane.',
    'homebrewerywiki-invalid-brew-text'   => 'The brew page source must be valid UTF-8 text.',
);

/** Message documentation (used only by translatewiki.net; ignored by MediaWiki) */
$messages['qqq'] = array(
    'homebrewerywiki-desc' => '{{desc}}',
);
