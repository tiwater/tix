#!/bin/bash
# word-set-properties.sh — Set document metadata (title, author, etc.)
#
# Usage:
#   ./word-set-properties.sh --title "Title" [--author "Author"] [--subject "Subject"] [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
TITLE=""
AUTHOR=""
SUBJECT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)    FILE_PATH="$2"; shift 2 ;;
    --title)   TITLE="$2"; shift 2 ;;
    --author)  AUTHOR="$2"; shift 2 ;;
    --subject) SUBJECT="$2"; shift 2 ;;
    *)         shift ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    PROPS="{"
    [ -n "$TITLE" ] && PROPS="$PROPS\"title\":\"$TITLE\","
    [ -n "$AUTHOR" ] && PROPS="$PROPS\"author\":\"$AUTHOR\","
    [ -n "$SUBJECT" ] && PROPS="$PROPS\"subject\":\"$SUBJECT\","
    PROPS="${PROPS%,}}"
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

setDocumentProperties($FILE_ARG, $PROPS);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/word-docx.py" "setDocumentProperties" "$FILE_PATH")
    [ -n "$TITLE" ] && ARGS+=("title=$TITLE")
    [ -n "$AUTHOR" ] && ARGS+=("author=$AUTHOR")
    [ -n "$SUBJECT" ] && ARGS+=("subject=$SUBJECT")
    python3 "${ARGS[@]}"
    ;;
esac
