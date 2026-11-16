#!/bin/sh
# Frenemy installer for Mac and Linux.
#
# Run it with:   bash install.sh
# (No sudo needed. It only touches files in your home folder.)
#
# This file only checks that Node.js 18 or newer is here, then hands over to
# install.mjs with the same options. Everything else lives in install.mjs.
case "$0" in
  */*) DIR="${0%/*}" ;;
  *) DIR="." ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Frenemy needs Node.js 18 or newer, and node was not found on this computer. Install it from https://nodejs.org, open a new terminal window, and run this again."
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
case "$MAJOR" in
  ''|*[!0-9]*) MAJOR=0 ;;
esac
if [ "$MAJOR" -lt 18 ]; then
  echo "Frenemy needs Node.js 18 or newer. This computer has $(node --version 2>/dev/null). Install the current one from https://nodejs.org and run this again."
  exit 1
fi

exec node "$DIR/install.mjs" "$@"
