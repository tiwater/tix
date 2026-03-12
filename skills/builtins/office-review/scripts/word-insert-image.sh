#!/bin/bash
# word-insert-image.sh — Insert an image into a Word document
#
# Usage:
#   ./word-insert-image.sh --image /path/to/image.png [--width 400] [--height 300] [--file path.docx]

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

[ -z "$IMAGE_PATH" ] && { echo '{"error":"--image path is required"}' >&2; exit 1; }

FILE_ARG=$([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null")
W_ARG=$([ -n "$WIDTH" ] && echo "$WIDTH" || echo "null")
H_ARG=$([ -n "$HEIGHT" ] && echo "$HEIGHT" || echo "null")

osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/word-jxa.js")

insertImage($FILE_ARG, "$IMAGE_PATH", $W_ARG, $H_ARG);
JXAEOF
