#!/usr/bin/env bash
# Update a DuckDNS record to this machine's public IP. Free, optional.
# Usage: DUCKDNS_DOMAIN=name DUCKDNS_TOKEN=token ./deploy/duckdns-update.sh
set -euo pipefail
: "${DUCKDNS_DOMAIN:?set DUCKDNS_DOMAIN}"
: "${DUCKDNS_TOKEN:?set DUCKDNS_TOKEN}"
curl -fsS --max-time 10 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip="
