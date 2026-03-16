#!/bin/bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is not installed." >&2
  exit 127
fi

if gh auth status --hostname github.com >/dev/null 2>&1; then
  gh auth logout --hostname github.com --yes
  echo "GitHub authentication cleared."
  exit 0
fi

echo "GitHub was already logged out."
exit 0
