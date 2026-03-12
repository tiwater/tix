/**
 * word-jxa.js — JXA (JavaScript for Automation) library for Microsoft Word on macOS.
 *
 * Usage: osascript -l JavaScript -e 'const lib = Library("./lib/word-jxa"); lib.functionName(args)'
 * Or imported via: const lib = Library("./lib/word-jxa") in another .jxa script.
 *
 * All functions output JSON to stdout for consumption by shell scripts.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWordApp() {
  const word = Application('Microsoft Word');
  word.includeStandardAdditions = true;
  if (!word.running()) {
    throw new Error('Microsoft Word is not running. Please open Word first.');
  }
  return word;
}

function getDocument(filePath) {
  const word = getWordApp();
  if (filePath) {
    // Open document by path
    const posix = Path(filePath);
    word.open(posix);
    return word.activeDocument();
  }
  // Use active document
  if (word.documents.length === 0) {
    throw new Error('No document is open in Microsoft Word.');
  }
  return word.activeDocument();
}

function paragraphToObj(para, index) {
  const text = para.content().trim();
  const style = (() => {
    try { return para.style().nameLocal(); } catch { return 'unknown'; }
  })();
  return { index, style, text };
}

// ---------------------------------------------------------------------------
// Exported Functions
// ---------------------------------------------------------------------------

/**
 * Read document structure: headings, page count, paragraph count, sections.
 */
function readStructure(filePath) {
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const totalParagraphs = paragraphs.length;

  // Collect headings
  const headings = [];
  for (let i = 0; i < totalParagraphs; i++) {
    const para = paragraphs[i];
    let styleName;
    try { styleName = para.style().nameLocal(); } catch { continue; }
    if (/^heading\s*\d/i.test(styleName) || /^标题\s*\d/.test(styleName)) {
      const level = parseInt(styleName.replace(/\D/g, '') || '1', 10);
      headings.push({
        index: i,
        level,
        style: styleName,
        text: para.content().trim().substring(0, 200),
      });
    }
  }

  // Page count
  let pageCount;
  try {
    pageCount = doc.computeStatistics({ statistic: 'number of pages' });
  } catch {
    pageCount = null;
  }

  // Word count
  let wordCount;
  try {
    wordCount = doc.computeStatistics({ statistic: 'number of words' });
  } catch {
    wordCount = null;
  }

  return JSON.stringify({
    name: doc.name(),
    path: (() => { try { return doc.fullName(); } catch { return null; } })(),
    pageCount,
    wordCount,
    totalParagraphs,
    headingCount: headings.length,
    headings,
  }, null, 2);
}

/**
 * Read a range of paragraphs by index.
 */
function readSection(filePath, startIndex, count) {
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const total = paragraphs.length;

  const start = Math.max(0, parseInt(startIndex, 10) || 0);
  const n = Math.min(parseInt(count, 10) || 50, 200); // cap at 200 paragraphs
  const end = Math.min(start + n, total);

  const result = [];
  for (let i = start; i < end; i++) {
    result.push(paragraphToObj(paragraphs[i], i));
  }

  return JSON.stringify({
    startIndex: start,
    endIndex: end - 1,
    totalParagraphs: total,
    paragraphs: result,
  }, null, 2);
}

/**
 * Read paragraphs under a specific heading (by heading text or index).
 */
function readByHeading(filePath, headingText) {
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const total = paragraphs.length;

  // Find the heading
  let headingIndex = -1;
  let headingLevel = 0;
  const query = (headingText || '').toLowerCase().trim();

  for (let i = 0; i < total; i++) {
    const para = paragraphs[i];
    let styleName;
    try { styleName = para.style().nameLocal(); } catch { continue; }
    if (/^heading\s*\d/i.test(styleName) || /^标题\s*\d/.test(styleName)) {
      const text = para.content().trim().toLowerCase();
      if (text.includes(query)) {
        headingIndex = i;
        headingLevel = parseInt(styleName.replace(/\D/g, '') || '1', 10);
        break;
      }
    }
  }

  if (headingIndex === -1) {
    return JSON.stringify({ error: `Heading "${headingText}" not found.` });
  }

  // Collect paragraphs until next heading of same or higher level
  const result = [paragraphToObj(paragraphs[headingIndex], headingIndex)];
  for (let i = headingIndex + 1; i < total; i++) {
    const para = paragraphs[i];
    let styleName;
    try { styleName = para.style().nameLocal(); } catch { styleName = ''; }
    if (/^heading\s*\d/i.test(styleName) || /^标题\s*\d/.test(styleName)) {
      const level = parseInt(styleName.replace(/\D/g, '') || '1', 10);
      if (level <= headingLevel) break;
    }
    result.push(paragraphToObj(para, i));
    if (result.length >= 300) break; // safety cap
  }

  return JSON.stringify({
    heading: headingText,
    headingIndex,
    paragraphs: result,
  }, null, 2);
}

/**
 * List all styles used in the document with frequency counts.
 */
function readStyles(filePath) {
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const total = paragraphs.length;

  const styleCounts = {};
  const fontSamples = {};

  for (let i = 0; i < total; i++) {
    const para = paragraphs[i];
    let styleName;
    try { styleName = para.style().nameLocal(); } catch { styleName = 'unknown'; }

    styleCounts[styleName] = (styleCounts[styleName] || 0) + 1;

    // Sample fonts from first few paragraphs of each style
    if (!fontSamples[styleName]) {
      try {
        const font = para.font();
        fontSamples[styleName] = {
          name: font.name(),
          size: font.size(),
        };
      } catch {
        fontSamples[styleName] = null;
      }
    }
  }

  // Sort by count descending
  const styles = Object.entries(styleCounts)
    .map(([name, count]) => ({
      name,
      count,
      font: fontSamples[name] || null,
    }))
    .sort((a, b) => b.count - a.count);

  return JSON.stringify({
    totalParagraphs: total,
    uniqueStyles: styles.length,
    styles,
  }, null, 2);
}

/**
 * Search for a text pattern and return matching paragraphs with context.
 */
function searchText(filePath, query) {
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const total = paragraphs.length;
  const searchQuery = (query || '').toLowerCase();

  if (!searchQuery) {
    return JSON.stringify({ error: 'No search query provided.' });
  }

  const matches = [];
  for (let i = 0; i < total && matches.length < 100; i++) {
    const text = paragraphs[i].content().trim();
    if (text.toLowerCase().includes(searchQuery)) {
      let styleName;
      try { styleName = paragraphs[i].style().nameLocal(); } catch { styleName = 'unknown'; }
      matches.push({
        index: i,
        style: styleName,
        text: text.substring(0, 500),
      });
    }
  }

  return JSON.stringify({
    query,
    matchCount: matches.length,
    capped: matches.length >= 100,
    matches,
  }, null, 2);
}

/**
 * Read all comments (annotations) from the document.
 */
function getComments(filePath) {
  const doc = getDocument(filePath || null);

  const comments = [];
  try {
    const wordComments = doc.comments();
    for (let i = 0; i < wordComments.length; i++) {
      const c = wordComments[i];
      comments.push({
        index: i,
        author: (() => { try { return c.author(); } catch { return 'unknown'; } })(),
        date: (() => { try { return c.date().toISOString(); } catch { return null; } })(),
        text: (() => { try { return c.commentText(); } catch { return ''; } })(),
        scope: (() => {
          try { return c.scope().content().substring(0, 200); }
          catch { return ''; }
        })(),
      });
    }
  } catch {
    // Document may not support comments API in this Word version
  }

  return JSON.stringify({
    commentCount: comments.length,
    comments,
  }, null, 2);
}
