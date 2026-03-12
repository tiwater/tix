#!/bin/bash
# word-search.sh — Search for text in a Word document
#
# Usage:
#   ./word-search.sh QUERY [file_path]
#
# Returns up to 100 matching paragraphs with index, style, and text.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUERY="${1:?Usage: word-search.sh QUERY [file_path]}"
FILE_PATH="${2:-}"

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

searchText($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"), "$QUERY");
JXAEOF
