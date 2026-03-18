#!/bin/bash
# word-save.sh — Save a Word document (Save / Save As / Export PDF)
#
# Usage:
#   ./word-save.sh [--save-as PATH] [--format docx|pdf] [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SAVE_AS=""
FORMAT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --save-as) SAVE_AS="$2"; shift 2 ;;
    --format)  FORMAT="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    SAVE_ARG=$([ -n "$SAVE_AS" ] && echo "\"$SAVE_AS\"" || echo "null")
    FORMAT_ARG=$([ -n "$FORMAT" ] && echo "\"$FORMAT\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

saveDocument($FILE_ARG, $SAVE_ARG, $FORMAT_ARG);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/word-docx.py" "saveDocument" "$FILE_PATH")
    [ -n "$SAVE_AS" ] && ARGS+=("$SAVE_AS") || ARGS+=("null")
    [ -n "$FORMAT" ] && ARGS+=("$FORMAT") || ARGS+=("null")
    python3 "${ARGS[@]}"
    ;;
esac
