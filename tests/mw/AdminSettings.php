<?php
/**
 * AdminSettings.php for the E3S5 harness.
 *
 * `maintenance/update.php` refuses to run unless these are set. SQLite has no
 * database superuser, so the values only need to exist.
 *
 * @file
 */

$wgDBadminuser     = 'root';
$wgDBadminpassword = '';
