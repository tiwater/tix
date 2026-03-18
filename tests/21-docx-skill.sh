#!/usr/bin/env bash
# tests/21-docx-skill.sh — Test the builtin docx skill (document creation, reading, editing)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DOCX_AGENT="docx-test-$$"
OUTDIR="/tmp/ticlaw-docx-tests-$$"
mkdir -p "$OUTDIR"

print_scenario_header "Scenario 21: Docx Skill"

# ── Test 21.1: Create a simple Word document ──
echo -e "  Sending: \"Create a Word document with a title and two paragraphs\""
result=$(send_message "Create a Word document at ${OUTDIR}/hello.docx using the docx npm package (it is already installed globally). The document should have:
- A Heading 1 title: 'Hello from TiClaw'
- A paragraph: 'This document was created by the docx skill.'
- A second paragraph: 'It demonstrates programmatic Word document generation.'
Use US Letter page size. Just create the file, no other explanation needed." \
  "$DOCX_AGENT" "e2e-docx-create-$$" "90")
response=$(get_response_text "$result")

assert_no_error "Document creation accepted" "$result" || true
assert_not_empty "Agent responded" "$response" || true

# Verify the file was actually created
TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -f "${OUTDIR}/hello.docx" ]; then
  FILESIZE=$(stat -f%z "${OUTDIR}/hello.docx" 2>/dev/null || stat -c%s "${OUTDIR}/hello.docx" 2>/dev/null || echo "0")
  echo -e "  ${GREEN}✓${NC} File hello.docx created (${FILESIZE} bytes)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} File hello.docx was NOT created"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 21.2: Create a document with a table ──
echo ""
echo -e "  Sending: \"Create a document with a formatted table\""
result=$(send_message "Create a Word document at ${OUTDIR}/report.docx using the docx npm package (globally installed). Include:
- A Heading 1: 'Quarterly Report'
- A short intro paragraph
- A 3-column, 4-row table (headers: 'Quarter', 'Revenue', 'Growth') with sample data for Q1-Q3
- Use WidthType.DXA for table widths (never percentages), set columnWidths AND cell widths
- Use ShadingType.CLEAR for header row background (color: 2E75B6, white text)
- Use US Letter page size
Just create the file." \
  "$DOCX_AGENT" "e2e-docx-table-$$" "90")
response=$(get_response_text "$result")

assert_no_error "Table document accepted" "$result" || true

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -f "${OUTDIR}/report.docx" ]; then
  FILESIZE=$(stat -f%z "${OUTDIR}/report.docx" 2>/dev/null || stat -c%s "${OUTDIR}/report.docx" 2>/dev/null || echo "0")
  echo -e "  ${GREEN}✓${NC} File report.docx created (${FILESIZE} bytes)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} File report.docx was NOT created"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Test 21.3: Read/analyze an existing document ──
echo ""
echo -e "  Sending: \"Read the hello.docx document content\""
result=$(send_message "Read and describe the contents of ${OUTDIR}/hello.docx. Use pandoc to extract the text. Tell me the title, number of paragraphs, and quote the text content." \
  "$DOCX_AGENT" "e2e-docx-read-$$" "60")
response=$(get_response_text "$result")

assert_no_error "Document reading accepted" "$result" || true
assert_not_empty "Agent described document" "$response" || true
assert_contains "Recognized document title" "$response" "TiClaw" || true

# ── Test 21.4: Unpack and inspect XML ──
echo ""
echo -e "  Sending: \"Unpack the hello.docx and show the XML structure\""
result=$(send_message "Unpack ${OUTDIR}/hello.docx into ${OUTDIR}/unpacked/ using the docx skill's unpack.py script. Then list the files that were extracted and show me the first 20 lines of word/document.xml." \
  "$DOCX_AGENT" "e2e-docx-unpack-$$" "60")
response=$(get_response_text "$result")

assert_no_error "Unpack command accepted" "$result" || true
assert_not_empty "Agent responded with XML info" "$response" || true

TESTS_TOTAL=$((TESTS_TOTAL + 1))
if [ -d "${OUTDIR}/unpacked/word" ]; then
  echo -e "  ${GREEN}✓${NC} Document unpacked to ${OUTDIR}/unpacked/"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "  ${RED}✗${NC} Unpacked directory not found"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ── Cleanup ──
echo ""
echo -e "  ${CYAN}Cleaning up test artifacts...${NC}"
rm -rf "$OUTDIR"

print_summary || true
