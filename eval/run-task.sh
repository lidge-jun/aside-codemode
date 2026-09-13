#!/bin/sh
# Run one aside exec measurement on macOS (020 D3). Usage: run-task.sh <needle> <label>
set -eu
NEEDLE="${1:-NEEDLE-A3}"
LABEL="${2:-after}"
ASIDE="$HOME/Library/Application Support/Aside/CLI/current/aside"
[ -x "$ASIDE" ] || ASIDE=$(ls -1 "$HOME/Library/Application Support/Aside/CLI/versions/"*/aside 2>/dev/null | sort | tail -1)
REPO=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
EV="$REPO/evidence"
mkdir -p "$EV"
TS=$(date +%Y%m%d-%H%M%S)
DUMP="$EV/$TS-$LABEL.jsonl"
PROMPT="$HOME/.aside/u/0/codemode-eval/corpus 아래에서 $NEEDLE 가 들어있는 파일을 모두 찾아 절대경로로 보고하라. 찾은 각 경로를 한 줄에 하나씩 적어라. Write and edit files only under $HOME/.aside/u/0. Read other local paths only when this prompt names them, and never modify them. This prompt names $HOME/.aside/u/0/codemode-eval as readable. Downloading to $HOME/Downloads is fine; move anything you keep under $HOME/.aside/u/0. Do not ask me any questions. If something is blocked or ambiguous, pick the most reasonable option and continue, or report exactly what blocked you and stop."
"$ASIDE" exec --permission full-access --log-dump "$DUMP" -- "$PROMPT" &
PID=$!
( sleep 600; kill "$PID" 2>/dev/null ) &
WATCHDOG=$!
set +e
wait "$PID"
RC=$?
set -e
kill "$WATCHDOG" 2>/dev/null || true
echo "DUMP=$DUMP"
echo "EXIT=$RC"
