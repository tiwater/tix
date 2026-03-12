---
name: office-review
description: Full Word document automation — read, review, create, and revise documents via macOS JXA
version: 2.0.0
requires: []
install: []
permissions:
  - read
  - write
  - execute
  - level 2
skill_api_version: "1.0.0"
entry: scripts/word-read-structure.sh
---

# office-review

Full-featured Word document automation for macOS. Read, review, create, and revise `.docx` documents using JXA (JavaScript for Automation) to control Microsoft Word.

## Prerequisites

- macOS with **Microsoft Word** installed and running

---

## Reading Tools

### `word-read-structure` — Document outline
```bash
./scripts/word-read-structure.sh [file_path]
```
Returns: headings (with levels), page count, word count, paragraph count.

### `word-read-section` — Read paragraphs
```bash
./scripts/word-read-section.sh --start 0 --count 50 [--file path.docx]
./scripts/word-read-section.sh --heading "Introduction" [--file path.docx]
```
Read by range (max 200 per call) or by heading title.

### `word-read-styles` — Style/font audit
```bash
./scripts/word-read-styles.sh [file_path]
```
Returns: all styles with frequency counts and font samples.

### `word-search` — Find text
```bash
./scripts/word-search.sh "query" [file_path]
```
Returns: up to 100 matching paragraphs with context.

### `word-get-comments` — Read comments
```bash
./scripts/word-get-comments.sh [file_path]
```

---

## Review / Annotation Tools

### `word-add-comment` — Add review comments
```bash
./scripts/word-add-comment.sh --index 42 --text "Fix this" [--file path.docx]
./scripts/word-add-comment.sh --batch '[{"paraIndex":42,"commentText":"Fix"}]'
```
Single or batch mode for marking findings.

### `word-add-revision` — Tracked changes
```bash
./scripts/word-add-revision.sh --index 42 --old "client" --new "customer" [--file path.docx]
```
Find-replace within a paragraph with Track Changes enabled.

---

## Document Creation Tools

### `word-create` — New document
```bash
./scripts/word-create.sh [--title "My Report"] [--save /path/to/file.docx]
```

### `word-add-heading` — Add heading
```bash
./scripts/word-add-heading.sh --text "Chapter 1" --level 1 [--file path.docx]
```
Levels 1-9 supported.

### `word-add-paragraph` — Add styled text
```bash
./scripts/word-add-paragraph.sh --text "Content" [--style Normal] [--bold] [--italic] [--file path.docx]
```

### `word-add-table` — Add table
```bash
./scripts/word-add-table.sh --data '{"headers":["Name","Age"],"rows":[["Alice","30"]]}' [--file path.docx]
```
Bold headers, bordered cells.

### `word-insert-image` — Insert image
```bash
./scripts/word-insert-image.sh --image /path/to/img.png [--width 400] [--height 300] [--file path.docx]
```

### `word-page-break` — Page/section break
```bash
./scripts/word-page-break.sh [--type page|section] [--file path.docx]
```

### `word-add-toc` — Table of contents
```bash
./scripts/word-add-toc.sh [--levels 3] [--file path.docx]
```

### `word-header-footer` — Header/footer text
```bash
./scripts/word-header-footer.sh --position header --text "Report Title" [--file path.docx]
```

### `word-save` — Save / Save As / Export PDF
```bash
./scripts/word-save.sh [--file path.docx]
./scripts/word-save.sh --save-as /output.docx
./scripts/word-save.sh --save-as /output.pdf --format pdf
```

### `word-set-properties` — Document metadata
```bash
./scripts/word-set-properties.sh --props '{"title":"Report","author":"TiClaw","company":"Acme"}' [--file path.docx]
```
Supports: title, author, subject, keywords, comments, company, category.

---

## Workflows

### Create a structured report
1. `word-create` → new document
2. `word-set-properties` → set title/author
3. `word-header-footer` → set header and footer
4. `word-add-heading` → chapter titles
5. `word-add-paragraph` → content
6. `word-add-table` → data tables
7. `word-insert-image` → diagrams
8. `word-add-toc` → auto table of contents
9. `word-save` → save as .docx or export PDF

### Review a large document
1. `word-read-structure` → outline
2. `word-read-styles` → formatting audit
3. `word-read-section` → read in chunks
4. `word-search` → check terminology
5. `word-add-comment` → mark findings (batch)
6. `word-add-revision` → suggest changes
7. `word-save` → save reviewed copy

## Error Codes

- `OFFICE_INPUT_INVALID` — document/path missing
- `OFFICE_EXECUTION_FAILED` — JXA error (is Word running?)
