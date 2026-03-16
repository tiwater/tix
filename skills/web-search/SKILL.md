---
name: web-search
description: Search the web using Perplexity or Brave API.
version: 1.0.0
requires: ["curl", "jq"]
install: []
permissions:
  - execute
  - network
skill_api_version: "1.0.0"
entry: scripts/web-search.sh
---

# web-search

Search the web for real-time information. Supports Perplexity (Sonar) and Brave Search.

## Usage

### Simple Query
```bash
${CLAUDE_SKILL_DIR}/scripts/web-search.sh "current stock price of TSLA"
```

### Advanced Options
```bash
${CLAUDE_SKILL_DIR}/scripts/web-search.sh --query "Apple news" --count 5 --freshness day
```
