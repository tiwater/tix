---
name: office-export
description: Convert documents between formats (Markdown, DOCX, PDF) with hash verification and metadata
version: 1.0.0
requires: []
install:
  - npm install -g marked
permissions:
  - read
  - execute
skill_api_version: "1.0.0"
---

# office-export

Convert and export documents between formats.

## Description

This skill converts documents between supported formats (Markdown, DOCX, PDF). It outputs the converted file along with hash, MIME type, and file size metadata for traceability.

## Usage

```
Input:
  - source_path: path to the source document
  - target_format: "md" | "docx" | "pdf"
  - output_path: (optional) where to write the exported file

Output (JSON):
  - output_path: path to the exported file
  - format: target format used
  - mime_type: MIME type of the output (e.g., "application/pdf")
  - size_bytes: file size in bytes
  - sha256: SHA-256 hash of the output file
  - source_format: detected format of the source
```

## Supported Conversions

| Source | Target | Method |
|--------|--------|--------|
| Markdown | DOCX | pandoc or marked + docx conversion |
| Markdown | PDF | pandoc or marked + pdf conversion |
| DOCX | Markdown | pandoc |
| DOCX | PDF | pandoc or libreoffice |

## Error Codes

- `OFFICE_INPUT_INVALID` — source file missing or format unsupported
- `OFFICE_TOOL_UNAVAILABLE` — required conversion tool not installed
- `OFFICE_EXECUTION_FAILED` — conversion process failed

## Example

```bash
# Convert markdown to PDF
office-export ./report.md --format pdf --output ./report.pdf
```
