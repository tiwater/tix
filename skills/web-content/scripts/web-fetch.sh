#!/bin/bash
# web-fetch.sh - Fetch content using a lightweight HTML to Markdown converter

set -e

URL=""
MODE="markdown"

while [[ $# -gt 0 ]]; do
  case $1 in
    --url)
      URL="$2"
      shift 2
      ;;
    --extract-mode)
      MODE="$2"
      shift 2
      ;;
    *)
      if [[ -z "$URL" ]]; then
        URL="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$URL" ]]; then
  echo "Error: No URL provided."
  exit 1
fi

# Fallback to Jina Reader or Similar if browser isn't needed
# (Using Jina for clean markdown extraction as a first-class lightweight proxy)
# In Ticlaw, we'll keep this simple and let the model handle the Markdown if provided.
# A more robust implementation would use Playwright or a headless browser.

curl -s "https://r.jina.ai/$URL"
