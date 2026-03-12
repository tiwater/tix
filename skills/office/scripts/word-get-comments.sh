#!/bin/bash
# word-get-comments.sh — Extract comments from a Word document
#
# Usage:
#   ./word-get-comments.sh [file_path]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE_PATH="${1:-}"

case "$(uname -s)" in
  Darwin)
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

getComments($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"));
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2
      exit 1
    fi
    python3 "$SCRIPT_DIR/lib/word-docx.py" getComments "$FILE_PATH"
    ;;
esac
