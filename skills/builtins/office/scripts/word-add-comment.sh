#!/bin/bash
# word-add-comment.sh — Add a review comment to a paragraph in a Word document
#
# Usage:
#   ./word-add-comment.sh --index N --text "Comment text" [--file PATH]
#   ./word-add-comment.sh --batch '[{"paraIndex":5,"commentText":"Fix this"}]' [--file PATH]
#
# Options:
#   --index N       Paragraph index to attach the comment to
#   --text TEXT     Comment text
#   --batch JSON    JSON array of {paraIndex, commentText} for bulk comments
#   --file PATH     Path to .docx file (default: active document)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
PARA_INDEX=""
COMMENT_TEXT=""
BATCH_JSON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --index)   PARA_INDEX="$2"; shift 2 ;;
    --text)    COMMENT_TEXT="$2"; shift 2 ;;
    --batch)   BATCH_JSON="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

if [ -n "$BATCH_JSON" ]; then
  # Batch mode — add multiple comments at once
  osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addCommentsBatch($FILE_ARG, '$BATCH_JSON');
JXAEOF
else
  # Single comment mode
  if [ -z "$PARA_INDEX" ] || [ -z "$COMMENT_TEXT" ]; then
    echo '{"error": "Usage: --index N --text \"Comment text\" [--file PATH]"}' >&2
    exit 1
  fi

  osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addComment($FILE_ARG, $PARA_INDEX, "$COMMENT_TEXT");
JXAEOF
fi
