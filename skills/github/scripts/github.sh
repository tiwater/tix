#!/bin/bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is not installed." >&2
  echo "Install: https://cli.github.com/" >&2
  exit 127
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Error: GitHub is not authenticated." >&2
  echo "Run: tc skills auth login github" >&2
  exit 10
fi

if [[ $# -eq 0 ]]; then
  cat <<'EOF'
Usage: ./scripts/github.sh <gh arguments...>

Examples:
  ./scripts/github.sh repo view owner/repo
  ./scripts/github.sh pr list --repo owner/repo --limit 20
  ./scripts/github.sh api repos/owner/repo/issues
EOF
  exit 1
fi

GH_PAGER=cat gh "$@"
