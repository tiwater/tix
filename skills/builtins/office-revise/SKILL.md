---
name: office-revise
description: Apply a revision plan to a document, producing a revised version with change summary and diff metadata
version: 1.0.0
requires: []
install: []
permissions:
  - read
  - execute
skill_api_version: "1.0.0"
---

# office-revise

Apply revisions to documents based on a revision plan.

## Description

This skill takes an original document and a revision plan (set of changes to apply), then produces the revised document along with a change summary and diff metadata.

## Usage

```
Input:
  - document_path: path to the original document
  - revision_plan: JSON or Markdown description of changes to apply
  - output_path: (optional) where to write the revised document

Output (JSON):
  - revised_document_path: path to the revised file
  - change_summary: human-readable summary of changes made
  - diff: unified diff between original and revised
  - stats: { additions, deletions, modifications }
```

## Error Codes

- `OFFICE_INPUT_INVALID` — document or revision plan missing/unreadable
- `OFFICE_EXECUTION_FAILED` — revision process encountered an error

## Example

```bash
# Apply revisions from a review
office-revise ./report.md --plan '{"changes": [{"line": 5, "action": "replace", "text": "Updated intro"}]}'
```
