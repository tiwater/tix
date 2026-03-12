#!/bin/bash
# excel-read-range.sh — Read a range of cells from a worksheet
#
# Usage:
#   ./excel-read-range.sh --sheet "Sheet1" --range "A1:D10" [--file path.xlsx]
#   ./excel-read-range.sh --sheet "Sheet1" --all [--file path.xlsx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SHEET=""
RANGE=""
READ_ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)  FILE_PATH="$2"; shift 2 ;;
    --sheet) SHEET="$2"; shift 2 ;;
    --range) RANGE="$2"; shift 2 ;;
    --all)   READ_ALL=true; shift ;;
    *)       FILE_PATH="$1"; shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    SHEET_ARG=$([ -n "$SHEET" ] && echo "\"$SHEET\"" || echo "null")
    RANGE_ARG=$([ -n "$RANGE" ] && echo "\"$RANGE\"" || echo "\"all\"")
    [ "$READ_ALL" = true ] && RANGE_ARG="\"all\""
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

readRange($FILE_ARG, $SHEET_ARG, $RANGE_ARG, $READ_ALL);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/excel-openpyxl.py" "readRange" "$FILE_PATH")
    [ -n "$SHEET" ] && ARGS+=("$SHEET") || ARGS+=("null")
    [ -n "$RANGE" ] && ARGS+=("$RANGE") || ARGS+=("null")
    [ "$READ_ALL" = true ] && ARGS+=("true") || ARGS+=("false")
    python3 "${ARGS[@]}"
    ;;
esac
