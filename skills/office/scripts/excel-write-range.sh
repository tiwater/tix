#!/bin/bash
# excel-write-range.sh — Write data to cells
#
# Usage:
#   ./excel-write-range.sh --sheet "Sheet1" --start "A1" --data '[["Name","Age"],["Alice",30]]' [--file path.xlsx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SHEET=""
START="A1"
DATA_JSON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)  FILE_PATH="$2"; shift 2 ;;
    --sheet) SHEET="$2"; shift 2 ;;
    --start) START="$2"; shift 2 ;;
    --data)  DATA_JSON="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

if [ -z "$DATA_JSON" ]; then
  echo '{"error": "Usage: --data JSON [--sheet NAME] [--start CELL] [--file PATH]"}' >&2; exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    SHEET_ARG=$([ -n "$SHEET" ] && echo "\"$SHEET\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

writeRange($FILE_ARG, $SHEET_ARG, "$START", '$DATA_JSON');
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/excel-openpyxl.py" "writeRange" "$FILE_PATH")
    [ -n "$SHEET" ] && ARGS+=("$SHEET") || ARGS+=("null")
    ARGS+=("$START" "$DATA_JSON")
    python3 "${ARGS[@]}"
    ;;
esac
