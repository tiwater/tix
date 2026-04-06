---
name: github
description: GitHub operations via GitHub CLI, including issues, pull requests, and API calls.
version: 1.0.0
requires: ["gh", "jq"]
install: []
permissions:
  - execute
  - network
skill_api_version: "1.0.0"
entry: scripts/github.sh
---

# github

Run GitHub workflows with `gh`, with auth guardrails built in.

## Usage

### Common commands
```bash
${CLAUDE_SKILL_DIR}/scripts/github.sh repo view owner/repo
${CLAUDE_SKILL_DIR}/scripts/github.sh pr list --repo owner/repo --limit 20
${CLAUDE_SKILL_DIR}/scripts/github.sh issue list --repo owner/repo --limit 20
${CLAUDE_SKILL_DIR}/scripts/github.sh api repos/owner/repo/pulls
```

## Authentication

Use Tix auth wrappers:

```bash
tc skills auth status github
tc skills auth login github
tc skills auth logout github
```
