#!/bin/bash
# word-read-structure.sh — Read Word document outline/structure
#
# Usage:
#   ./word-read-structure.sh [file_path]
#
# If file_path is omitted, reads the currently active document in Word (macOS only).
# Outputs JSON with headings, page count, word count, paragraph count.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE_PATH="${1:-}"

case "$(uname -s)" in
  Darwin)
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

readStructure($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"));
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2
      exit 1
    fi
    python3 "$SCRIPT_DIR/lib/word-docx.py" readStructure "$FILE_PATH"
    ;;
esac
