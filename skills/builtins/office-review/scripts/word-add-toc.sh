#!/bin/bash
# word-add-toc.sh — Add a table of contents to a Word document
#
# Usage:
#   ./word-add-toc.sh [--levels 3] [--file path.docx]

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

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addTableOfContents($FILE_ARG, $LEVELS);
JXAEOF
