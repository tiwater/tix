#!/bin/bash
# word-add-paragraph.sh — Add a styled paragraph to a Word document
#
# Usage:
#   ./word-add-paragraph.sh --text "Paragraph text" [--bold] [--italic] [--style STYLE] [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
TEXT=""
BOLD=false
ITALIC=false
STYLE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --text)    TEXT="$2"; shift 2 ;;
    --bold)    BOLD=true; shift ;;
    --italic)  ITALIC=true; shift ;;
    --style)   STYLE="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

if [ -z "$TEXT" ]; then
  echo '{"error": "Usage: --text \"Paragraph\" [--bold] [--italic] [--style STYLE] [--file PATH]"}' >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    STYLE_ARG=$([ -n "$STYLE" ] && echo "\"$STYLE\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addParagraph($FILE_ARG, "$TEXT", $BOLD, $ITALIC, $STYLE_ARG);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/word-docx.py" "addParagraph" "$FILE_PATH" "$TEXT" "$BOLD" "$ITALIC")
    [ -n "$STYLE" ] && ARGS+=("$STYLE")
    python3 "${ARGS[@]}"
    ;;
esac
