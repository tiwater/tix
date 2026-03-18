#!/bin/bash
# word-header-footer.sh — Set header or footer text
#
# Usage:
#   ./word-header-footer.sh --position header|footer --text "Text" [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
POSITION=""
TEXT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)     FILE_PATH="$2"; shift 2 ;;
    --position) POSITION="$2"; shift 2 ;;
    --text)     TEXT="$2"; shift 2 ;;
    *)          shift ;;
  esac
done

if [ -z "$POSITION" ] || [ -z "$TEXT" ]; then
  echo '{"error": "Usage: --position header|footer --text \"Text\" [--file PATH]"}' >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

setHeaderFooter($FILE_ARG, "$POSITION", "$TEXT");
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    python3 "$SCRIPT_DIR/lib/word-docx.py" setHeaderFooter "$FILE_PATH" "$POSITION" "$TEXT"
    ;;
esac
