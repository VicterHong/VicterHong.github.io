#!/bin/bash
# Refresh private presentation evidence only. The entitlement API reads it on demand.
# This job must never commit, push, or deploy the working tree.
set -u
ROOT="/home/ubuntu/portfolio-victer"
NODE="/home/ubuntu/.hermes/node/bin/node"
LOG="/home/ubuntu/.portfolio-token/sync-metrik.log"
cd "$ROOT" || exit 1
printf '\n-- %s --\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
if "$NODE" scripts/sync-metrik.mjs --check >> "$LOG" 2>&1; then
  printf 'Private metrics unchanged.\n' >> "$LOG"
  exit 0
else
  result=$?
fi
if [ "$result" -ne 1 ]; then
  printf 'Private metrics check failed; refusing writes.\n' >> "$LOG"
  exit "$result"
fi
"$NODE" scripts/sync-metrik.mjs >> "$LOG" 2>&1
