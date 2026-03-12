#!/bin/bash
# word-read-structure.sh — Read Word document outline/structure
#
# Usage:
#   ./word-read-structure.sh [file_path]
#
# If file_path is omitted, reads the currently active document in Word.
# Outputs JSON with headings, page count, word count, paragraph count.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE_PATH="${1:-}"

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

readStructure($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"));
JXAEOF
