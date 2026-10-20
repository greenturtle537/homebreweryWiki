# MediaWiki 1.14.1 test harness (E3S5T1).
#
# PHP 5.6.40 is the documented substitute for the production PHP 5.2.12 +
# Suhosin stack: Suhosin is a hardening patchset, not a MediaWiki dependency,
# and cannot be built on anything the official images still publish.
#
# MediaWiki 1.14.1 has no CLI installer and its `maintenance/update.php`
# replays MySQL-dialect patches that are fatal on SQLite, so the schema comes
# straight from `maintenance/sqlite/tables.sql` (the current 1.14 schema).
FROM php:5.6-cli

ARG MW_VERSION=1.14.1
ARG MW_SHA256=0c41845e069ce1f3a716892e6c8e529ee7a112a7f9e50ec2a9c9c6b34d0ba690

# No apt-get: php:5.6-cli is Debian *stretch*, whose repositories are archived
# and 404 by now. The image already ships curl, tar, gzip and sha256sum, which
# is everything this harness needs.
WORKDIR /srv

RUN curl -fsSL -o mw.tar.gz \
        "https://releases.wikimedia.org/mediawiki/1.14/mediawiki-${MW_VERSION}.tar.gz" \
    && echo "${MW_SHA256}  mw.tar.gz" | sha256sum -c - \
    && tar xzf mw.tar.gz \
    && mv "mediawiki-${MW_VERSION}" mediawiki \
    && rm mw.tar.gz

COPY entrypoint.sh /usr/local/bin/hbw-entrypoint
RUN chmod +x /usr/local/bin/hbw-entrypoint

ENV MW_DATA_DIR=/srv/data

ENTRYPOINT ["/usr/local/bin/hbw-entrypoint"]
