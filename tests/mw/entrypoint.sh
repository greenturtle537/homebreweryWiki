#!/bin/sh
# Seed a MediaWiki 1.14.1 install and run the extension tests against it.
#
# The extension repository is mounted read-only at /opt/hbw, so this script
# copies the two settings files into place and symlinks the extension rather
# than writing into the checkout.
set -eu

MW_ROOT=/srv/mediawiki
DATA="${MW_DATA_DIR:-/srv/data}"
REPO=/opt/hbw

mkdir -p "$DATA"

if [ ! -f "$DATA/hbw.sqlite" ]; then
    echo "Seeding SQLite schema from maintenance/sqlite/tables.sql"
    MW_DATA_DIR="$DATA" php -r '
        $dir = getenv( "MW_DATA_DIR" );
        $db = new SQLite3( $dir . "/hbw.sqlite" );
        $sql = file_get_contents( "/srv/mediawiki/maintenance/sqlite/tables.sql" );
        if ( $sql === false || !$db->exec( $sql ) ) {
            fwrite( STDERR, "schema seed failed: " . $db->lastErrorMsg() . "\n" );
            exit( 1 );
        }
        $rows = $db->query( "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = \"table\"" );
        $row = $rows->fetchArray();
        echo "tables: " . $row["c"] . "\n";
    '
    chmod 666 "$DATA/hbw.sqlite"
fi

ln -sfn "$REPO" "$MW_ROOT/extensions/HomebreweryWiki"
cp "$REPO/tests/mw/LocalSettings.php" "$MW_ROOT/LocalSettings.php"
cp "$REPO/tests/mw/AdminSettings.php" "$MW_ROOT/AdminSettings.php"

# The tests assume a promoted account exists; a fresh schema has none, which
# turns four "trusted editor" assertions into failures.
if ! php "$MW_ROOT/maintenance/createAndPromote.php" Admin AdminPass123 \
        --bureaucrat --sysop >/dev/null 2>&1; then
    echo "createAndPromote: account already present (or upgrade skipped)"
fi

cp "$REPO/tests/run.php" "$MW_ROOT/maintenance/hbwtest.php"

exec php "$MW_ROOT/maintenance/hbwtest.php"
