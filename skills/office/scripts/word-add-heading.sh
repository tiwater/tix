#!/bin/bash
# word-add-heading.sh — Add a heading to a Word document
#
# Usage:
#   ./word-add-heading.sh --text "Heading text" [--level N] [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
TEXT=""
LEVEL=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)  FILE_PATH="$2"; shift 2 ;;
    --text)  TEXT="$2"; shift 2 ;;
    --level) LEVEL="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

if [ -z "$TEXT" ]; then
  echo '{"error": "Usage: --text \"Heading\" [--level N] [--file PATH]"}' >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addHeading($FILE_ARG, "$TEXT", $LEVEL);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    python3 "$SCRIPT_DIR/lib/word-docx.py" addHeading "$FILE_PATH" "$TEXT" "$LEVEL"
    ;;
esac
