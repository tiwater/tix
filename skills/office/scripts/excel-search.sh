#!/bin/bash
# excel-search.sh — Search for text/values across all sheets
#
# Usage:
#   ./excel-search.sh "query" [--file path.xlsx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

QUERY=""
FILE_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE_PATH="$2"; shift 2 ;;
    *)      [ -z "$QUERY" ] && QUERY="$1" || FILE_PATH="$1"; shift ;;
  esac
done

if [ -z "$QUERY" ]; then
  echo '{"error": "Usage: excel-search.sh QUERY [--file path.xlsx]"}' >&2; exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

searchText($FILE_ARG, "$QUERY");
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    python3 "$SCRIPT_DIR/lib/excel-openpyxl.py" searchText "$FILE_PATH" "$QUERY"
    ;;
esac
