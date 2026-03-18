#!/bin/bash
# platform.sh — Platform detection and dispatch for office skills
#
# Source this file in shell scripts to get platform-aware dispatch.
#
# Usage:
#   source "$(dirname "$0")/lib/platform.sh"
#   run_backend "word" "readStructure" "$@"

detect_platform() {
  case "$(uname -s)" in
    Darwin)  echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)       echo "linux" ;;
  esac
}

PLATFORM="$(detect_platform)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

# Run a backend function with platform dispatch
# Usage: run_backend <app> <function> [args...]
#   app: "word", "excel", "powerpoint"
#   function: the function name to call
#   remaining args are passed through
run_backend() {
  local app="$1"
  local func="$2"
  shift 2

  case "$PLATFORM" in
    macos)
      run_jxa "$app" "$func" "$@"
      ;;
    windows)
      run_powershell "$app" "$func" "$@"
      ;;
    linux)
      run_python "$app" "$func" "$@"
      ;;
  esac
}

run_jxa() {
  local app="$1"
  local func="$2"
  shift 2
  local lib_file="$LIB_DIR/${app}-jxa.js"

  if [ ! -f "$lib_file" ]; then
    echo "{\"error\": \"JXA backend not found: $lib_file\"}" >&2
    exit 1
  fi

  osascript -l JavaScript <<JXAEOF
$(cat "$lib_file")

${func}($(build_jxa_args "$@"));
JXAEOF
}

run_python() {
  local app="$1"
  local func="$2"
  shift 2
  local lib_file="$LIB_DIR/${app}-docx.py"

  if [ ! -f "$lib_file" ]; then
    echo "{\"error\": \"Python backend not found: $lib_file. Install python-docx: pip install python-docx\"}" >&2
    exit 1
  fi

  # Auto-install required Python modules if missing
  python3 -c "import docx" 2>/dev/null || pip3 install -q python-docx 2>/dev/null
  python3 -c "import openpyxl" 2>/dev/null || pip3 install -q openpyxl 2>/dev/null

  python3 "$lib_file" "$func" "$@"
}

run_powershell() {
  local app="$1"
  local func="$2"
  shift 2
  local lib_file="$LIB_DIR/${app}-com.ps1"

  if [ ! -f "$lib_file" ]; then
    echo "{\"error\": \"PowerShell backend not found: $lib_file\"}" >&2
    exit 1
  fi

  powershell.exe -ExecutionPolicy Bypass -File "$lib_file" "$func" "$@"
}

# Helper: build JXA-compatible argument list from shell args
# Converts --key value pairs and positional args into JS values
build_jxa_args() {
  local args=()
  for arg in "$@"; do
    if [ "$arg" = "null" ]; then
      args+=("null")
    elif [[ "$arg" =~ ^[0-9]+$ ]]; then
      args+=("$arg")
    elif [[ "$arg" =~ ^(true|false)$ ]]; then
      args+=("$arg")
    elif [[ "$arg" =~ ^\[.*\]$ ]] || [[ "$arg" =~ ^\{.*\}$ ]]; then
      # JSON arrays/objects pass through
      args+=("$arg")
    else
      # Quote as string
      args+=("\"$arg\"")
    fi
  done
  echo "${args[*]}"
  # Join with commas
  local IFS=","
  echo "${args[*]}"
}
