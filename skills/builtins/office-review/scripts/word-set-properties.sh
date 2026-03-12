#!/bin/bash
# word-set-properties.sh — Set document properties (title, author, etc.)
#
# Usage:
#   ./word-set-properties.sh --props '{"title":"My Report","author":"TiClaw"}' [--file path.docx]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
PROPS_JSON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)  FILE_PATH="$2"; shift 2 ;;
    --props) PROPS_JSON="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

[ -z "$PROPS_JSON" ] && { echo '{"error":"--props JSON is required"}' >&2; exit 1; }

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

setDocumentProperties($FILE_ARG, '$PROPS_JSON');
JXAEOF
