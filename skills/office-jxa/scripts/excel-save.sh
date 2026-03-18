#!/bin/bash
# excel-save.sh — Save or Save As an Excel workbook
#
# Usage:
#   ./excel-save.sh [--save-as /output.xlsx] [--file path.xlsx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SAVE_AS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --save-as) SAVE_AS="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    SAVE_ARG=$([ -n "$SAVE_AS" ] && echo "\"$SAVE_AS\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

saveWorkbook($FILE_ARG, $SAVE_ARG);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/excel-openpyxl.py" "saveWorkbook" "$FILE_PATH")
    [ -n "$SAVE_AS" ] && ARGS+=("$SAVE_AS")
    python3 "${ARGS[@]}"
    ;;
esac
