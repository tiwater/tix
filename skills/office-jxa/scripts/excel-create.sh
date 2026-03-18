#!/bin/bash
# excel-create.sh — Create a new workbook
#
# Usage:
#   ./excel-create.sh --save-as /path/to/file.xlsx [--sheets "Sheet1,Data,Summary"]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SAVE_PATH=""
SHEETS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --save-as) SAVE_PATH="$2"; shift 2 ;;
    --sheets)  SHEETS="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    SAVE_ARG=$([ -n "$SAVE_PATH" ] && echo "\"$SAVE_PATH\"" || echo "null")
    SHEETS_ARG=$([ -n "$SHEETS" ] && echo "\"$SHEETS\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

createWorkbook($SAVE_ARG, $SHEETS_ARG);
JXAEOF
    ;;
  *)
    if [ -z "$SAVE_PATH" ]; then
      echo '{"error": "save_path required (--save-as PATH)"}' >&2; exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/excel-openpyxl.py" "createWorkbook" "$SAVE_PATH")
    [ -n "$SHEETS" ] && ARGS+=("$SHEETS")
    python3 "${ARGS[@]}"
    ;;
esac
