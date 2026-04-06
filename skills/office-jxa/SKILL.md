---
name: office-jxa
description: Cross-platform Office automation via JXA — Word (.docx) and Excel (.xlsx) reading, creation, and review
version: 3.0.0
requires: [python3]
install: ["pip3 install -q python-docx openpyxl"]
permissions:
  - read
  - write
  - execute
  - level 2
skill_api_version: "1.0.0"
entry: scripts/word-read-structure.sh
---

# office

Cross-platform Office document automation. Read, review, create, and manipulate Word (`.docx`) and Excel (`.xlsx`) documents.

## Platform Support

| Platform | Backend | Requirements | Limitations |
|----------|---------|-------------|-------------|
| **macOS** | JXA → Office apps | Word/Excel running | Full support |
| **Linux** | python-docx, openpyxl | `pip install python-docx openpyxl` | No comments/revisions, no active document |
| **Windows** | PowerShell/COM | Office installed | Planned |

All tools accept `--file PATH`. On macOS, omitting `--file` uses the active document/workbook.

---

## Word — Reading Tools

### `word-read-structure` — Document outline
```bash
${CLAUDE_SKILL_DIR}/scripts/word-read-structure.sh [file_path]
```
Returns: headings (with levels), page count, word count, paragraph count.

### `word-read-section` — Read paragraphs
```bash
${CLAUDE_SKILL_DIR}/scripts/word-read-section.sh --start 0 --count 50 [--file path.docx]
${CLAUDE_SKILL_DIR}/scripts/word-read-section.sh --heading "Introduction" [--file path.docx]
```

### `word-read-styles` — Style/font audit
```bash
${CLAUDE_SKILL_DIR}/scripts/word-read-styles.sh [file_path]
```

### `word-search` — Find text
```bash
${CLAUDE_SKILL_DIR}/scripts/word-search.sh "query" [file_path]
```

### `word-get-comments` — Read comments
```bash
${CLAUDE_SKILL_DIR}/scripts/word-get-comments.sh [file_path]
```

---

## Word — Review / Annotation Tools

### `word-add-comment` — Add review comments (macOS only)
```bash
${CLAUDE_SKILL_DIR}/scripts/word-add-comment.sh --index 42 --text "Fix this" [--file path.docx]
${CLAUDE_SKILL_DIR}/scripts/word-add-comment.sh --batch '[{"paraIndex":42,"commentText":"Fix"}]'
```

### `word-add-revision` — Tracked changes (macOS only)
```bash
${CLAUDE_SKILL_DIR}/scripts/word-add-revision.sh --index 42 --old "client" --new "customer" [--file path.docx]
```

---

## Word — Creation Tools

### `word-create` — New document
```bash
${CLAUDE_SKILL_DIR}/scripts/word-create.sh [--title "My Report"] [--save-as /path/to/file.docx]
```

### `word-add-heading` — Add heading
```bash
${CLAUDE_SKILL_DIR}/scripts/word-add-heading.sh --text "Chapter 1" --level 1 [--file path.docx]
```

### `word-add-paragraph` — Add styled text
```bash
${CLAUDE_SKILL_DIR}/scripts/word-add-paragraph.sh --text "Content" [--style Normal] [--bold] [--italic] [--file path.docx]
```

### `word-add-table` — Add table
```bash
${CLAUDE_SKILL_DIR}/scripts/word-add-table.sh --data '{"headers":["Name","Age"],"rows":[["Alice","30"]]}' [--file path.docx]
```

### `word-insert-image` — Insert image
```bash
${CLAUDE_SKILL_DIR}/scripts/word-insert-image.sh --image /path/to/img.png [--width 400] [--height 300] [--file path.docx]
```

### `word-page-break` — Page/section break
```bash
${CLAUDE_SKILL_DIR}/scripts/word-page-break.sh [--type page|section] [--file path.docx]
```

### `word-add-toc` — Table of contents
```bash
${CLAUDE_SKILL_DIR}/scripts/word-add-toc.sh [--levels 3] [--file path.docx]
```

### `word-header-footer` — Header/footer text
```bash
${CLAUDE_SKILL_DIR}/scripts/word-header-footer.sh --position header --text "Report Title" [--file path.docx]
```

### `word-save` — Save / Save As / Export PDF
```bash
${CLAUDE_SKILL_DIR}/scripts/word-save.sh [--file path.docx]
${CLAUDE_SKILL_DIR}/scripts/word-save.sh --save-as /output.pdf --format pdf
```

### `word-set-properties` — Document metadata
```bash
${CLAUDE_SKILL_DIR}/scripts/word-set-properties.sh --title "Report" --author "Tix" [--file path.docx]
```

---

## Excel — Reading Tools

### `excel-read-structure` — Workbook overview
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-read-structure.sh [file_path]
```
Returns: sheet names, row/column counts.

### `excel-read-range` — Read cell range
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-read-range.sh --sheet "Sheet1" --range "A1:D10" [--file path.xlsx]
${CLAUDE_SKILL_DIR}/scripts/excel-read-range.sh --sheet "Sheet1" --all [--file path.xlsx]
```

### `excel-search` — Find text/values
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-search.sh "query" [--file path.xlsx]
```

---

## Excel — Writing Tools

### `excel-create` — New workbook
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-create.sh --save-as /path/to/file.xlsx [--sheets "Sheet1,Data,Summary"]
```

### `excel-write-range` — Write cells
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-write-range.sh --sheet "Sheet1" --start "A1" --data '[["Name","Age"],["Alice",30]]' [--file path.xlsx]
```

### `excel-add-sheet` — Add worksheet
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-add-sheet.sh --name "NewSheet" [--file path.xlsx]
```

### `excel-set-formula` — Set cell formula
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-set-formula.sh --sheet "Sheet1" --cell "C1" --formula "=SUM(A1:B1)" [--file path.xlsx]
```

### `excel-format-range` — Format cells
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-format-range.sh --sheet "Sheet1" --range "A1:D1" --bold --bg-color "4472C4" [--file path.xlsx]
```

### `excel-save` — Save / Save As
```bash
${CLAUDE_SKILL_DIR}/scripts/excel-save.sh [--save-as /output.xlsx] [--file path.xlsx]
```

---

## Workflows

### Create a structured Word report
1. `word-create` → new document
2. `word-set-properties` → set title/author
3. `word-add-heading` → chapter titles
4. `word-add-paragraph` → content
5. `word-add-table` → data tables
6. `word-save` → save as .docx or export PDF

### Review a Word document
1. `word-read-structure` → outline
2. `word-read-section` → read in chunks
3. `word-search` → check terminology
4. `word-add-comment` → mark findings
5. `word-save` → save reviewed copy

### Create an Excel report
1. `excel-create` → new workbook with sheets
2. `excel-write-range` → populate data
3. `excel-set-formula` → add calculations
4. `excel-format-range` → style headers
5. `excel-save` → save

## Error Codes

- `OFFICE_INPUT_INVALID` — document/path missing
- `OFFICE_EXECUTION_FAILED` — backend error (is Word/Excel running?)
- On Linux/Windows: comments and revisions require Microsoft Word
