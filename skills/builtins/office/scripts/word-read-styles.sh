#!/bin/bash
# word-read-styles.sh — List all styles and fonts used in a Word document
#
# Usage:
#   ./word-read-styles.sh [file_path]
#
# Outputs JSON with style names, usage counts, and font samples.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE_PATH="${1:-}"

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

readStyles($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"));
JXAEOF
