#!/bin/bash
# word-save.sh — Save a Word document (or Save As to a new path/format)
#
# Usage:
#   ./word-save.sh [--file path.docx]
#   ./word-save.sh --save-as /path/to/output.docx [--file path.docx]
#   ./word-save.sh --save-as /path/to/output.pdf --format pdf [--file path.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
SAVE_AS=""
FORMAT="docx"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --save-as) SAVE_AS="$2"; shift 2 ;;
    --format)  FORMAT="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
SAVE_ARG=$([ -n "$SAVE_AS" ] && echo "\"$SAVE_AS\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

saveDocument($FILE_ARG, $SAVE_ARG, "$FORMAT");
JXAEOF
