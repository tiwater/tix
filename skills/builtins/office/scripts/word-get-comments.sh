#!/bin/bash
# word-get-comments.sh — Read all comments/annotations from a Word document
#
# Usage:
#   ./word-get-comments.sh [file_path]
#
# Outputs JSON with comment author, date, text, and scope.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE_PATH="${1:-}"

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

getComments($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"));
JXAEOF
