#!/bin/bash
# excel-set-formula.sh — Set a cell formula
#
# Usage:
#   ./excel-set-formula.sh --sheet "Sheet1" --cell "C1" --formula "=SUM(A1:B1)" [--file path.xlsx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SHEET=""
CELL=""
FORMULA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --sheet)   SHEET="$2"; shift 2 ;;
    --cell)    CELL="$2"; shift 2 ;;
    --formula) FORMULA="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

if [ -z "$CELL" ] || [ -z "$FORMULA" ]; then
  echo '{"error": "Usage: --cell CELL --formula FORMULA [--sheet NAME] [--file PATH]"}' >&2; exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    SHEET_ARG=$([ -n "$SHEET" ] && echo "\"$SHEET\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

setFormula($FILE_ARG, $SHEET_ARG, "$CELL", "$FORMULA");
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/excel-openpyxl.py" "setFormula" "$FILE_PATH")
    [ -n "$SHEET" ] && ARGS+=("$SHEET") || ARGS+=("null")
    ARGS+=("$CELL" "$FORMULA")
    python3 "${ARGS[@]}"
    ;;
esac
