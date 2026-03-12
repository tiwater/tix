---
name: office-review
description: Review Word documents for consistency using macOS Office Automation (JXA)
version: 1.1.0
requires: []
install: []
permissions:
  - read
  - execute
  - level 2
skill_api_version: "1.0.0"
entry: scripts/word-read-structure.sh
---

# office-review

Review Word documents against rules and style guidelines, with full access to document structure, styles, and content via macOS Office Automation.

## Description

This skill uses **JXA (JavaScript for Automation)** to interact with Microsoft Word on macOS. It provides tools to read document structure, content by section, styles, search for patterns, and read comments — enabling chunked review of very large documents (500+ pages).

### Prerequisites

- macOS with Microsoft Word installed
- Word must be running (the skill controls Word via Automation)

## Tools

### `word-read-structure` — Document outline
```bash
./scripts/word-read-structure.sh [file_path]
```
Returns: headings (with levels), page count, word count, paragraph count.
Use this first to understand the document layout.

### `word-read-section` — Read paragraphs
```bash
# By paragraph range:
./scripts/word-read-section.sh --start 0 --count 50 [--file path.docx]

# By heading title:
./scripts/word-read-section.sh --heading "Introduction" [--file path.docx]
```
Returns: paragraphs with index, style name, and text content.
Use `--count` up to 200 paragraphs per call. Read the doc in chunks.

### `word-read-styles` — Style/font audit
```bash
./scripts/word-read-styles.sh [file_path]
```
Returns: all styles used with frequency counts and font samples.
Useful for detecting formatting inconsistencies.

### `word-search` — Find text
```bash
./scripts/word-search.sh "search query" [file_path]
```
Returns: up to 100 matching paragraphs with context.
Use this to check terminology consistency.

### `word-get-comments` — Read comments
```bash
./scripts/word-get-comments.sh [file_path]
```
Returns: all comments with author, date, text, and scope.

### `word-add-comment` — Add review comments
```bash
# Single comment:
./scripts/word-add-comment.sh --index 42 --text "Inconsistent terminology" [--file path.docx]

# Batch (multiple comments at once):
./scripts/word-add-comment.sh --batch '[{"paraIndex":42,"commentText":"Fix this"},{"paraIndex":108,"commentText":"Rephrase"}]'
```
Adds comments to specific paragraphs by index. Use batch mode for efficiency.

### `word-add-revision` — Add tracked changes
```bash
./scripts/word-add-revision.sh --index 42 --old "original text" --new "revised text" [--file path.docx]
```
Enables Track Changes and performs a find-replace within the specified paragraph.
The change appears as a tracked revision in Word's review mode.

## Review Workflow

For a large document consistency review:

1. **Read structure** → get the outline and total paragraph count
2. **Read styles** → identify formatting patterns and inconsistencies
3. **Read section by section** → chunk through the document (50-100 paragraphs at a time)
4. **Search for terms** → verify terminology consistency across the document
5. **Read comments** → check for unresolved review comments
6. **Add comments** → mark inconsistencies found (use batch mode for efficiency)
7. **Add revisions** → suggest text changes as tracked revisions

## Error Codes

- `OFFICE_INPUT_INVALID` — document path missing or unreadable
- `OFFICE_EXECUTION_FAILED` — JXA script execution error (is Word running?)
