#!/bin/bash
# word-page-break.sh — Add a page or section break
#
# Usage:
#   ./word-page-break.sh [--type page|section] [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
BREAK_TYPE="page"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE_PATH="$2"; shift 2 ;;
    --type) BREAK_TYPE="$2"; shift 2 ;;
    *)      shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addPageBreak($FILE_ARG, "$BREAK_TYPE");
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    python3 "$SCRIPT_DIR/lib/word-docx.py" addPageBreak "$FILE_PATH" "$BREAK_TYPE"
    ;;
esac
