#!/bin/bash
# word-add-toc.sh — Add a table of contents
#
# Usage:
#   ./word-add-toc.sh [--levels N] [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
LEVELS=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)   FILE_PATH="$2"; shift 2 ;;
    --levels) LEVELS="$2"; shift 2 ;;
    *)        shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addTableOfContents($FILE_ARG, $LEVELS);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    python3 "$SCRIPT_DIR/lib/word-docx.py" addTableOfContents "$FILE_PATH" "$LEVELS"
    ;;
esac
