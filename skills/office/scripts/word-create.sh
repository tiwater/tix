#!/bin/bash
# word-create.sh — Create a new blank Word document
#
# Usage:
#   ./word-create.sh [--title "Title"] [--save-as PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TITLE=""
SAVE_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)   TITLE="$2"; shift 2 ;;
    --save-as) SAVE_PATH="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    TITLE_ARG=$([ -n "$TITLE" ] && echo "\"$TITLE\"" || echo "null")
    SAVE_ARG=$([ -n "$SAVE_PATH" ] && echo "\"$SAVE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

createDocument($TITLE_ARG, $SAVE_ARG);
JXAEOF
    ;;
  *)
    if [ -z "$SAVE_PATH" ]; then
      echo '{"error": "save_path required on this platform (--save-as PATH)"}' >&2
      exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/word-docx.py" "createDocument")
    [ -n "$TITLE" ] && ARGS+=("$TITLE") || ARGS+=("null")
    ARGS+=("$SAVE_PATH")
    python3 "${ARGS[@]}"
    ;;
esac
