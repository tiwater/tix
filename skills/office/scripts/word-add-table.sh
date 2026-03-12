#!/bin/bash
# word-add-table.sh — Add a table to a Word document
#
# Usage:
#   ./word-add-table.sh --data '{"headers":["Name","Age"],"rows":[["Alice","30"]]}' [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
DATA_JSON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)  FILE_PATH="$2"; shift 2 ;;
    --data)  DATA_JSON="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

if [ -z "$DATA_JSON" ]; then
  echo '{"error": "Usage: --data JSON [--file PATH]"}' >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addTable($FILE_ARG, '$DATA_JSON');
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    python3 "$SCRIPT_DIR/lib/word-docx.py" addTable "$FILE_PATH" "$DATA_JSON"
    ;;
esac
