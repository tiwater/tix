#!/bin/bash
# excel-read-structure.sh — Read workbook overview (sheets, sizes)
#
# Usage:
#   ./excel-read-structure.sh [file_path]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE_PATH="${1:-}"

case "$(uname -s)" in
  Darwin)
    osascript -l JavaScript <<JXAEOF
$(cat "$SCRIPT_DIR/lib/excel-jxa.js")

readStructure($([ -n "$FILE_PATH" ] && echo "\"$FILE_PATH\"" || echo "null"));
JXAEOF
    ;;
  *)
    if [ -z "$FILE_PATH" ]; then
      echo '{"error": "File path required on this platform"}' >&2; exit 1
    fi
    python3 "$SCRIPT_DIR/lib/excel-openpyxl.py" readStructure "$FILE_PATH"
    ;;
esac
