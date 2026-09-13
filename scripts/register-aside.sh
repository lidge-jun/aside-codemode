#!/bin/sh
set -eu
NODE_BIN="$(command -v node)"
"$NODE_BIN" "$(dirname "$0")/register-aside.mjs"
