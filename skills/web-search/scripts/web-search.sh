#!/bin/bash
# web-search.sh - Search the web using Perplexity (Synthesis) or Serper (Organic)

set -e

QUERY=""
COUNT=10
PROVIDER="perplexity"

while [[ $# -gt 0 ]]; do
  case $1 in
    --query)
      QUERY="$2"
      shift 2
      ;;
    --count)
      COUNT="$2"
      shift 2
      ;;
    --provider)
      PROVIDER="$2"
      shift 2
      ;;
    *)
      if [[ -z "$QUERY" ]]; then
        QUERY="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$QUERY" ]]; then
  echo "Error: No query provided."
  exit 1
fi

# Load keys
SERPER_API_KEY=${TIX_SERPER_API_KEY:-"893c202c20c4a0c7b1cd123d60ce006c4e792475"}
PERPLEXITY_API_KEY=${TIX_PERPLEXITY_API_KEY:-$(grep -E '^TIX_PERPLEXITY_API_KEY=' .env 2>/dev/null | cut -d '=' -f 2-)}

# Decide on provider and key
if [[ "$PROVIDER" == "perplexity" ]]; then
  if [[ -z "$PERPLEXITY_API_KEY" ]]; then
    echo "Warning: TIX_PERPLEXITY_API_KEY not set. Falling back to Serper."
    PROVIDER="serper"
  fi
fi

if [[ "$PROVIDER" == "perplexity" ]]; then
  # Perplexity Sonar API - Reasoning & Synthesis
  RESPONSE=$(curl -s --request POST \
    --url https://api.perplexity.ai/chat/completions \
    --header "Authorization: Bearer $PERPLEXITY_API_KEY" \
    --header 'content-type: application/json' \
    --data "{
      \"model\": \"sonar-pro\",
      \"messages\": [
        {
          \"role\": \"system\",
          \"content\": \"Search the web and provide a synthesized, well-structured answer with citations. Focus on the latest available information.\"
        },
        {
          \"role\": \"user\",
          \"content\": \"$QUERY\"
        }
      ]
    }")
  
  echo "### Perplexity Search Result (Synthesized)"
  echo ""
  echo "$RESPONSE" | jq -r '.choices[0].message.content'
  
else
  # Serper Search API - Raw Organic Results
  RESPONSE=$(curl -s --request POST \
    --url https://google.serper.dev/search \
    --header "X-API-KEY: $SERPER_API_KEY" \
    --header 'Content-Type: application/json' \
    --data "{
      \"q\": \"$QUERY\",
      \"num\": $COUNT
    }")
  
  echo "### Serper Search Results (Organic)"
  echo ""
  echo "$RESPONSE" | jq -r '.organic[] | "- **\(.title)**\n  \(.snippet)\n  Source: \(.link)\n"'
fi
