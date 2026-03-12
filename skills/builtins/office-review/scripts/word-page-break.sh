#!/bin/bash
# word-page-break.sh — Add a page or section break to a Word document
#
# Usage:
#   ./word-page-break.sh [--type page|section] [--file path.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
TYPE="page"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE_PATH="$2"; shift 2 ;;
    --type) TYPE="$2"; shift 2 ;;
    *)      shift ;;
  esac
done

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

addPageBreak($FILE_ARG, "$TYPE");
JXAEOF
