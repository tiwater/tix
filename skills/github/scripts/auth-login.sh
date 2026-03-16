#!/bin/bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is not installed." >&2
  exit 127
fi

if gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "GitHub is already authenticated."
  exit 0
fi

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [[ -n "${TOKEN}" ]]; then
  printf "%s" "${TOKEN}" | gh auth login --hostname github.com --with-token
  gh auth status --hostname github.com >/dev/null 2>&1
  echo "GitHub authentication succeeded via token."
  exit 0
fi

if [[ -t 0 && -t 1 ]]; then
  echo "Starting interactive GitHub login..."
  gh auth login --hostname github.com --git-protocol https --web
  gh auth status --hostname github.com >/dev/null 2>&1
  echo "GitHub authentication succeeded."
  exit 0
fi

echo "No token provided and interactive login is unavailable." >&2
echo "Set GITHUB_TOKEN (or GH_TOKEN), or run this in a terminal TTY." >&2
exit 2
