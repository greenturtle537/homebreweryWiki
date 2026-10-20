#!/bin/sh
# Build and run the MediaWiki 1.14.1 harness locally.
#
#   sh tests/mw/run.sh
#
# Exits with the test status, so it works as a pre-push check too.
set -eu

REPO=$( cd "$( dirname "$0" )/../.." && pwd )

docker build -t hbw-mw14 "$REPO/tests/mw"
docker run --rm -v "$REPO:/opt/hbw:ro" hbw-mw14
