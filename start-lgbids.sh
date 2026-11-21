#!/bin/sh
# Start Lgbids on Linux: run ./start-lgbids.sh (or double-click it and choose "Run in Terminal").
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed, or it is not on the PATH."
  echo "Install the LTS version from https://nodejs.org (or your distribution's nodejs 22 package) and then run this again."
  exit 1
fi
exec node scripts/launch.mjs "$@"
