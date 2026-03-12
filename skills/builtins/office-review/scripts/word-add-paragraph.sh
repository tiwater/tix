#!/bin/bash
# word-add-paragraph.sh — Add a styled paragraph to a Word document
#
# Usage:
#   ./word-add-paragraph.sh --text "Content here" [--style Normal] [--bold] [--italic] [--file path.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
TEXT=""
STYLE="Normal"
BOLD="false"
ITALIC="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)   FILE_PATH="$2"; shift 2 ;;
    --text)   TEXT="$2"; shift 2 ;;
    --style)  STYLE="$2"; shift 2 ;;
    --bold)   BOLD="true"; shift ;;
    --italic) ITALIC="true"; shift ;;
    *)        shift ;;
  esac
done

[ -z "$TEXT" ] && { echo '{"error":"--text is required"}' >&2; exit 1; }

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addParagraph($FILE_ARG, "$TEXT", "$STYLE", "$BOLD", "$ITALIC");
JXAEOF
