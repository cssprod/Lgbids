#!/bin/bash
# Double-click to start Lgbids on a Mac. Keep this window open while you use the app.
cd "$(dirname "$0")" || exit 1
# Where the Node.js installer and Homebrew put node, in case this window's PATH lacks them.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed, or this window cannot find it."
  echo "Install the LTS version from https://nodejs.org and then double-click this file again."
  read -r -p "Press Return to close this window. " _
  exit 1
fi
node scripts/launch.mjs "$@"
status=$?
if [ "$status" -ne 0 ]; then
  echo "Lgbids stopped because of a problem. The messages above say what went wrong."
  read -r -p "Press Return to close this window. " _
fi
exit "$status"
