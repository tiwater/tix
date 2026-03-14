---
name: web-content
description: Extract readable Markdown content from any URL (HTML → Markdown).
version: 1.0.0
requires: ["curl", "node"]
install: ["npm install html-to-markdown jsdom"]
permissions:
  - execute
  - network
skill_api_version: "1.0.0"
entry: scripts/web-fetch.sh
---

# web-content

Extract clean, readable Markdown from URLs.

## Usage

### Fetch PDF or HTML
```bash
./scripts/web-fetch.sh "https://example.com"
```
```bash
./scripts/web-fetch.sh --url "https://news.ycombinator.com" --extract-mode text
```
