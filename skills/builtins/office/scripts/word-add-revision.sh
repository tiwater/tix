#!/bin/bash
# word-add-revision.sh — Add a tracked change (revision) to a Word document
#
# Usage:
#   ./word-add-revision.sh --index N --old "old text" --new "new text" [--file PATH]
#
# Options:
#   --index N       Paragraph index containing the text to replace
#   --old TEXT      Text to find within the paragraph
#   --new TEXT      Replacement text (will appear as a tracked change)
#   --file PATH     Path to .docx file (default: active document)
#
# This enables Track Changes in Word and performs a find-replace within
# the specified paragraph, so the change appears as a revision.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
PARA_INDEX=""
OLD_TEXT=""
NEW_TEXT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --index)   PARA_INDEX="$2"; shift 2 ;;
    --old)     OLD_TEXT="$2"; shift 2 ;;
    --new)     NEW_TEXT="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

if [ -z "$PARA_INDEX" ] || [ -z "$OLD_TEXT" ] || [ -z "$NEW_TEXT" ]; then
  echo '{"error": "Usage: --index N --old \"old text\" --new \"new text\" [--file PATH]"}' >&2
  exit 1
fi

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addRevision($FILE_ARG, $PARA_INDEX, "$OLD_TEXT", "$NEW_TEXT");
JXAEOF
