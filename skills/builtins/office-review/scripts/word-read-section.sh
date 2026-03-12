#!/bin/bash
# word-read-section.sh — Read a range of paragraphs from a Word document
#
# Usage:
#   ./word-read-section.sh [--file PATH] [--start N] [--count N]
#   ./word-read-section.sh [--file PATH] [--heading "Section Title"]
#
# Options:
#   --file PATH       Path to .docx file (default: active document)
#   --start N         Starting paragraph index (default: 0)
#   --count N         Number of paragraphs to read (default: 50, max: 200)
#   --heading TEXT    Read all paragraphs under this heading

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
START=0
COUNT=50
HEADING=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --start)   START="$2"; shift 2 ;;
    --count)   COUNT="$2"; shift 2 ;;
    --heading) HEADING="$2"; shift 2 ;;
    *)         FILE_PATH="$1"; shift ;;
  esac
done

if [ -n "$HEADING" ]; then
  osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

readByHeading($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"), "$HEADING");
JXAEOF
else
  osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

readSection($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"), $START, $COUNT);
JXAEOF
fi
