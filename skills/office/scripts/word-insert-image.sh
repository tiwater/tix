#!/bin/bash
# word-insert-image.sh — Insert an image into a Word document
#
# Usage:
#   ./word-insert-image.sh --image PATH [--width N] [--height N] [--file PATH]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FILE_PATH=""
IMAGE_PATH=""
WIDTH=""
HEIGHT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)   FILE_PATH="$2"; shift 2 ;;
    --image)  IMAGE_PATH="$2"; shift 2 ;;
    --width)  WIDTH="$2"; shift 2 ;;
    --height) HEIGHT="$2"; shift 2 ;;
    *)        shift ;;
  esac
done

if [ -z "$IMAGE_PATH" ]; then
  echo '{"error": "Usage: --image PATH [--width N] [--height N] [--file PATH]"}' >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
    WIDTH_ARG=$([ -n "$WIDTH" ] && echo "$WIDTH" || echo "null")
    HEIGHT_ARG=$([ -n "$HEIGHT" ] && echo "$HEIGHT" || echo "null")
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

insertImage($FILE_ARG, "$IMAGE_PATH", $WIDTH_ARG, $HEIGHT_ARG);
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform (--file PATH)"}' >&2
      exit 1
    fi
    ARGS=("$SCRIPT_DIR/lib/word-docx.py" "insertImage" "$FILE_PATH" "$IMAGE_PATH")
    [ -n "$WIDTH" ] && ARGS+=("$WIDTH") || ARGS+=("null")
    [ -n "$HEIGHT" ] && ARGS+=("$HEIGHT") || ARGS+=("null")
    python3 "${ARGS[@]}"
    ;;
esac
