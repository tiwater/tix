---
name: office-review
description: Review a document against rules and style guidelines, producing a structured review summary with suggestions
version: 1.0.0
requires: []
install: []
permissions:
  - read
skill_api_version: "1.0.0"
---

# office-review

Review documents against specified rules and style guidelines.

## Description

This skill reviews a document (Markdown, plain text, or other text-based formats) against a set of rules and/or a style guide. It produces a structured JSON review summary with modification suggestions.

## Usage

```
Input:
  - document_path: path to the document to review
  - rules: (optional) review rules or checklist items
  - style_guide: (optional) reference style guide

Output (JSON):
  - summary: overall review summary
  - score: 0-100 quality score
  - suggestions: array of { location, severity, message, suggested_fix }
  - passed_rules: array of rules that passed
  - failed_rules: array of rules that failed
```

## Error Codes

- `OFFICE_INPUT_INVALID` — document path missing or unreadable
- `OFFICE_EXECUTION_FAILED` — review process encountered an error

## Example

```bash
# Review a README against standard documentation rules
office-review ./README.md --rules "Has title,Has description,Has usage section"
```
