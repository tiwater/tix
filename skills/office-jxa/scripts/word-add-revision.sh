#!/bin/bash
# word-add-revision.sh — Add tracked changes to a Word document
#
# Usage:
#   ./word-add-revision.sh --index N --old "old text" --new "new text" [--file PATH]
#
# Note: Track Changes require Microsoft Word (macOS/Windows). Not supported on Linux.

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

case "$(uname -s)" in
  Darwin)
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addRevision($FILE_ARG, $PARA_INDEX, "$OLD_TEXT", "$NEW_TEXT");
JXAEOF
    ;;
  *)
    echo '{"error": "Track Changes requires Microsoft Word (macOS or Windows)", "suggestion": "Edit text directly with word-add-paragraph.sh"}' >&2
    exit 1
    ;;
esac
