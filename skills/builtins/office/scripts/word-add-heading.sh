#!/bin/bash
# word-add-heading.sh — Add a heading to a Word document
#
# Usage:
#   ./word-add-heading.sh --text "Chapter 1" [--level 1] [--file path.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
TEXT=""
LEVEL=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)  FILE_PATH="$2"; shift 2 ;;
    --text)  TEXT="$2"; shift 2 ;;
    --level) LEVEL="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

[ -z "$TEXT" ] && { echo '{"error":"--text is required"}' >&2; exit 1; }

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addHeading($FILE_ARG, "$TEXT", $LEVEL);
JXAEOF
