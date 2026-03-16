#!/bin/bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is not installed." >&2
  exit 2
fi

if status_output="$(gh auth status --hostname github.com 2>&1)"; then
  echo "${status_output}"
  exit 0
fi

echo "${status_output}" >&2
exit 10
