#!/bin/bash
# excel-add-sheet.sh — Add a new worksheet
#
# Usage:
#   ./excel-add-sheet.sh --name "NewSheet" [--file path.xlsx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SHEET_NAME="Sheet"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE_PATH="$2"; shift 2 ;;
    --name) SHEET_NAME="$2"; shift 2 ;;
    *)      shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

addSheet($FILE_ARG, "$SHEET_NAME");
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    python3 "$SCRIPT_DIR/lib/excel-openpyxl.py" addSheet "$FILE_PATH" "$SHEET_NAME"
    ;;
esac
