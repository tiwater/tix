#!/bin/bash
# word-create.sh — Create a new Word document
#
# Usage:
#   ./word-create.sh [--title "My Report"] [--save /path/to/file.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TITLE=""
SAVE_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --save)  SAVE_PATH="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

TITLE_ARG=$([ -n "$TITLE" ] && echo "\"$TITLE\"" || echo "null")
SAVE_ARG=$([ -n "$SAVE_PATH" ] && echo "\"$SAVE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

createDocument($TITLE_ARG, $SAVE_ARG);
JXAEOF
