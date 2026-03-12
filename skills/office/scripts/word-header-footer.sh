#!/bin/bash
# word-header-footer.sh — Set header or footer text in a Word document
#
# Usage:
#   ./word-header-footer.sh --position header --text "My Report" [--file path.docx]
#   ./word-header-footer.sh --position footer --text "Page" [--file path.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
POSITION="header"
TEXT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)     FILE_PATH="$2"; shift 2 ;;
    --position) POSITION="$2"; shift 2 ;;
    --text)     TEXT="$2"; shift 2 ;;
    *)          shift ;;
  esac
done

[ -z "$TEXT" ] && { echo '{"error":"--text is required"}' >&2; exit 1; }

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

setHeaderFooter($FILE_ARG, "$POSITION", "$TEXT");
JXAEOF
