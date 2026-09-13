#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${NODE:-}" ] && [ -x "$NODE" ]; then
  exec "$NODE" "$SCRIPT_DIR/register-aside.mjs"
fi
NODE_BIN=$(command -v node) || {
  echo "node not on PATH; run: /abs/node $SCRIPT_DIR/register-aside.mjs" >&2
  exit 1
}
exec "$NODE_BIN" "$SCRIPT_DIR/register-aside.mjs"
