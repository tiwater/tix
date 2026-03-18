#!/bin/bash
# excel-format-range.sh — Format cells (bold, colors, number format)
#
# Usage:
#   ./excel-format-range.sh --sheet "Sheet1" --range "A1:D1" --bold --bg-color "4472C4" [--file path.xlsx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SHEET=""
RANGE=""
FORMAT_JSON="{"
FIRST=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)          FILE_PATH="$2"; shift 2 ;;
    --sheet)         SHEET="$2"; shift 2 ;;
    --range)         RANGE="$2"; shift 2 ;;
    --bold)          [ "$FIRST" = true ] && FIRST=false || FORMAT_JSON="$FORMAT_JSON,"; FORMAT_JSON="$FORMAT_JSON\"bold\":true"; shift ;;
    --italic)        [ "$FIRST" = true ] && FIRST=false || FORMAT_JSON="$FORMAT_JSON,"; FORMAT_JSON="$FORMAT_JSON\"italic\":true"; shift ;;
    --font-size)     [ "$FIRST" = true ] && FIRST=false || FORMAT_JSON="$FORMAT_JSON,"; FORMAT_JSON="$FORMAT_JSON\"fontSize\":$2"; shift 2 ;;
    --bg-color)      [ "$FIRST" = true ] && FIRST=false || FORMAT_JSON="$FORMAT_JSON,"; FORMAT_JSON="$FORMAT_JSON\"bgColor\":\"$2\""; shift 2 ;;
    --font-color)    [ "$FIRST" = true ] && FIRST=false || FORMAT_JSON="$FORMAT_JSON,"; FORMAT_JSON="$FORMAT_JSON\"fontColor\":\"$2\""; shift 2 ;;
    --number-format) [ "$FIRST" = true ] && FIRST=false || FORMAT_JSON="$FORMAT_JSON,"; FORMAT_JSON="$FORMAT_JSON\"numberFormat\":\"$2\""; shift 2 ;;
    *)               shift ;;
  esac
done
FORMAT_JSON="$FORMAT_JSON}"

if [ -z "$RANGE" ]; then
  echo '{"error": "Usage: --range RANGE [formatting options] [--sheet NAME] [--file PATH]"}' >&2; exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    SHEET_ARG=$([ -n "$SHEET" ] && echo "\"$SHEET\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

formatRange($FILE_ARG, $SHEET_ARG, "$RANGE", '$FORMAT_JSON');
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/excel-openpyxl.py" "formatRange" "$FILE_PATH")
    [ -n "$SHEET" ] && ARGS+=("$SHEET") || ARGS+=("null")
    ARGS+=("$RANGE" "$FORMAT_JSON")
    python3 "${ARGS[@]}"
    ;;
esac
