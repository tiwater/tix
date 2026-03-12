#!/bin/bash
# word-add-table.sh — Add a table to a Word document
#
# Usage:
#   ./word-add-table.sh --data '{"headers":["Name","Age"],"rows":[["Alice","30"],["Bob","25"]]}' [--file path.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
DATA_JSON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE_PATH="$2"; shift 2 ;;
    --data) DATA_JSON="$2"; shift 2 ;;
    *)      shift ;;
  esac
done

[ -z "$DATA_JSON" ] && { echo '{"error":"--data JSON is required"}' >&2; exit 1; }

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addTable($FILE_ARG, '$DATA_JSON');
JXAEOF
