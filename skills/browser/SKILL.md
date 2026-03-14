---
name: browser
description: Full browser automation using Playwright. Fetch, screenshot, and interact with web pages.
version: 1.0.0
requires: ["node", "npx playwright"]
install: ["npm install playwright"]
permissions:
  - execute
  - network
  - filesystem
skill_api_version: "1.0.0"
entry: scripts/browser.mjs
---

# browser

Control a real web browser to interact with complex websites.

## Usage

### Simple Fetch (Markdown)
```bash
./scripts/browser.mjs --action snapshot --url "https://example.com"
```

### Screenshot
```bash
./scripts/browser.mjs --action screenshot --url "https://news.ycombinator.com" --path "hn.png"
```

### Click & Interaction
```bash
./scripts/browser.mjs --action click --selector "button#submit" --url "..."
```
