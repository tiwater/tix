---
name: office-summary
description: Generate structured summaries from one or more documents, including executive and section-level summaries
version: 1.0.0
requires: []
install: []
permissions:
  - read
skill_api_version: "1.0.0"
---

# office-summary

Generate structured summaries from documents.

## Description

This skill reads one or more documents and produces a structured summary with both executive-level and section-level breakdowns. Suitable for meeting notes, reports, or multi-document synthesis.

## Usage

```
Input:
  - document_paths: one or more paths to documents
  - format: (optional) "executive" | "detailed" | "both" (default: "both")
  - max_length: (optional) maximum summary length in words

Output (JSON):
  - executive_summary: brief high-level summary
  - section_summaries: array of { section_title, summary, key_points }
  - key_findings: array of the most important points
  - document_count: number of documents processed
  - total_word_count: word count of source material
```

## Error Codes

- `OFFICE_INPUT_INVALID` — no documents provided or paths unreadable
- `OFFICE_EXECUTION_FAILED` — summarization process encountered an error

## Example

```bash
# Summarize meeting notes
office-summary ./notes/2024-01-15.md ./notes/2024-01-16.md --format both
```
