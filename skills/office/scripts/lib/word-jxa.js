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

/**
 * Add a comment to a specific paragraph.
 * @param {string|null} filePath - path to .docx or null for active doc
 * @param {number} paraIndex - paragraph index to attach the comment to
 * @param {string} commentText - the comment text
 * @param {string} [author] - optional author name (default: "TiClaw Review")
 */
function addComment(filePath, paraIndex, commentText, author) {
  const word = getWordApp();
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const total = paragraphs.length;
  const idx = parseInt(paraIndex, 10);

  if (isNaN(idx) || idx < 0 || idx >= total) {
    return JSON.stringify({ error: `Paragraph index ${paraIndex} out of range (0-${total - 1}).` });
  }

  const para = paragraphs[idx];
  const range = para.textObject;

  // Add comment via Word's make command
  const comment = word.Comment({
    commentText: commentText || '',
  });
  doc.comments.push(comment);

  // Attach to paragraph range — Word JXA uses makeCommentBy
  try {
    word.createNewComment(range, {
      commentText: commentText || '',
    });
  } catch {
    // Fallback: use the Word object model directly
    try {
      const paraRange = doc.createRange({
        start: para.startOfContent(),
        end: para.endOfContent(),
      });
      paraRange.addComment({ commentText: commentText || '' });
    } catch {
      // Final fallback: use the paragraphs content range
      word.doJavaScript(`
        var para = ActiveDocument.Paragraphs(${idx + 1});
        ActiveDocument.Comments.Add(para.Range, "${(commentText || '').replace(/"/g, '\\"')}");
      `);
    }
  }

  return JSON.stringify({
    ok: true,
    paragraphIndex: idx,
    commentText: commentText,
    paragraphPreview: para.content().trim().substring(0, 100),
  }, null, 2);
}

/**
 * Batch add multiple comments at once.
 * @param {string|null} filePath
 * @param {string} itemsJson - JSON array of {paraIndex, commentText}
 */
function addCommentsBatch(filePath, itemsJson) {
  const word = getWordApp();
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const total = paragraphs.length;

  let items;
  try { items = JSON.parse(itemsJson); } catch {
    return JSON.stringify({ error: 'Invalid JSON for items.' });
  }

  const results = [];
  for (const item of items) {
    const idx = parseInt(item.paraIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= total) {
      results.push({ paraIndex: idx, ok: false, error: 'out of range' });
      continue;
    }

    try {
      word.doJavaScript(`
        var para = ActiveDocument.Paragraphs(${idx + 1});
        ActiveDocument.Comments.Add(para.Range, "${(item.commentText || '').replace(/"/g, '\\"').replace(/\n/g, '\\n')}");
      `);
      results.push({ paraIndex: idx, ok: true });
    } catch (e) {
      results.push({ paraIndex: idx, ok: false, error: String(e) });
    }
  }

  return JSON.stringify({
    total: items.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  }, null, 2);
}

/**
 * Enable tracked changes (revisions) in the document.
 */
function enableTrackedChanges(filePath) {
  const word = getWordApp();
  const doc = getDocument(filePath || null);

  try {
    word.doJavaScript('ActiveDocument.TrackRevisions = true;');
  } catch {
    // Some versions need different API
  }

  return JSON.stringify({ ok: true, message: 'Track changes enabled.' });
}

/**
 * Replace text in a paragraph as a tracked change (revision).
 * Requires tracked changes to be enabled.
 * @param {string|null} filePath
 * @param {number} paraIndex - paragraph to modify
 * @param {string} oldText - text to find within the paragraph
 * @param {string} newText - replacement text
 */
function addRevision(filePath, paraIndex, oldText, newText) {
  const word = getWordApp();
  const doc = getDocument(filePath || null);
  const paragraphs = doc.paragraphs();
  const total = paragraphs.length;
  const idx = parseInt(paraIndex, 10);

  if (isNaN(idx) || idx < 0 || idx >= total) {
    return JSON.stringify({ error: `Paragraph index ${paraIndex} out of range (0-${total - 1}).` });
  }

  // Enable track changes
  try {
    word.doJavaScript('ActiveDocument.TrackRevisions = true;');
  } catch {}

  const escapedOld = (oldText || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const escapedNew = (newText || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  try {
    word.doJavaScript(`
      var para = ActiveDocument.Paragraphs(${idx + 1});
      var rng = para.Range;
      rng.Find.Execute("${escapedOld}", false, false, false, false, false, true, 0, false, "${escapedNew}", 2);
    `);
  } catch (e) {
    return JSON.stringify({ error: `Revision failed: ${String(e)}` });
  }

  return JSON.stringify({
    ok: true,
    paragraphIndex: idx,
    oldText,
    newText,
  }, null, 2);
}

// ===========================================================================
// Document Creation Functions
// ===========================================================================

/**
 * Create a new blank Word document.
 * @param {string} [title] - optional document title
 * @param {string} [savePath] - optional path to save immediately
 */
function createDocument(title, savePath) {
  const word = getWordApp();
  word.activate();
  word.doJavaScript('Documents.Add');
  const doc = word.activeDocument();

  if (title) {
    try {
      word.doJavaScript('ActiveDocument.BuiltInDocumentProperties("Title").Value = "' + (title || '').replace(/"/g, '\\"') + '"');
    } catch {}
  }

  if (savePath) {
    try {
      word.doJavaScript('ActiveDocument.SaveAs2 FileName:="' + savePath.replace(/"/g, '\\"') + '", FileFormat:=16');
    } catch {}
  }

  return JSON.stringify({ ok: true, name: doc.name(), title: title || null, savedTo: savePath || null }, null, 2);
}

/**
 * Add a heading to the end of the document.
 * @param {string|null} filePath
 * @param {string} text - heading text
 * @param {number} level - heading level 1-9
 */
function addHeading(filePath, text, level) {
  const word = getWordApp();
  getDocument(filePath || null);
  const lvl = Math.max(1, Math.min(9, parseInt(level, 10) || 1));
  const styleId = -(lvl + 1);
  const escaped = (text || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  word.doJavaScript(
    'Dim rng\n' +
    'Set rng = ActiveDocument.Content\n' +
    'rng.Collapse Direction:=0\n' +
    'rng.InsertAfter "' + escaped + '" & vbCr\n' +
    'rng.Style = ActiveDocument.Styles(' + styleId + ')'
  );

  return JSON.stringify({ ok: true, text: text, level: lvl }, null, 2);
}

/**
 * Add a styled paragraph to the end of the document.
 * @param {string|null} filePath
 * @param {string} text
 * @param {string} [style] - style name (default: "Normal")
 * @param {string} [bold] - "true" for bold
 * @param {string} [italic] - "true" for italic
 */
function addParagraph(filePath, text, style, bold, italic) {
  const word = getWordApp();
  getDocument(filePath || null);
  const escaped = (text || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const styleName = (style || 'Normal').replace(/"/g, '\\"');
  const isBold = bold === true || bold === 'true';
  const isItalic = italic === true || italic === 'true';

  let vba = 'Dim rng\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\nrng.InsertAfter "' + escaped + '" & vbCr\nrng.Style = "' + styleName + '"';
  if (isBold) vba += '\nrng.Bold = True';
  if (isItalic) vba += '\nrng.Italic = True';

  word.doJavaScript(vba);
  return JSON.stringify({ ok: true, style: styleName, bold: isBold, italic: isItalic }, null, 2);
}

/**
 * Add a table to the end of the document.
 * @param {string|null} filePath
 * @param {string} dataJson - JSON: { headers: string[], rows: string[][] }
 */
function addTable(filePath, dataJson) {
  const word = getWordApp();
  getDocument(filePath || null);

  var data;
  try { data = JSON.parse(dataJson); } catch {
    return JSON.stringify({ error: 'Invalid JSON for table data.' });
  }

  var headers = data.headers || [];
  var rows = data.rows || [];
  var numCols = Math.max(headers.length, (rows[0] || []).length, 1);
  var numRows = rows.length + (headers.length > 0 ? 1 : 0);

  var vba = 'Dim rng\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\nrng.InsertParagraphAfter\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\n';
  vba += 'Dim tbl\nSet tbl = ActiveDocument.Tables.Add(Range:=rng, NumRows:=' + numRows + ', NumColumns:=' + numCols + ')\ntbl.Borders.Enable = True\n';

  if (headers.length > 0) {
    for (var c = 0; c < headers.length; c++) {
      var val = (headers[c] || '').replace(/"/g, '\\"');
      vba += 'tbl.Cell(1, ' + (c + 1) + ').Range.Text = "' + val + '"\n';
      vba += 'tbl.Cell(1, ' + (c + 1) + ').Range.Bold = True\n';
    }
  }

  var dataStart = headers.length > 0 ? 2 : 1;
  for (var r = 0; r < rows.length; r++) {
    for (var c2 = 0; c2 < (rows[r] || []).length && c2 < numCols; c2++) {
      var cellVal = (rows[r][c2] || '').replace(/"/g, '\\"');
      vba += 'tbl.Cell(' + (r + dataStart) + ', ' + (c2 + 1) + ').Range.Text = "' + cellVal + '"\n';
    }
  }

  try { word.doJavaScript(vba); } catch (e) {
    return JSON.stringify({ error: 'Table creation failed: ' + String(e) });
  }

  return JSON.stringify({ ok: true, rows: numRows, columns: numCols, hasHeaders: headers.length > 0 }, null, 2);
}

/**
 * Insert an image at the end of the document.
 * @param {string|null} filePath
 * @param {string} imagePath - absolute path to the image file
 * @param {number} [width] - optional width in points
 * @param {number} [height] - optional height in points
 */
function insertImage(filePath, imagePath, width, height) {
  const word = getWordApp();
  getDocument(filePath || null);
  const imgPath = (imagePath || '').replace(/"/g, '\\"');

  var vba = 'Dim rng\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\nrng.InsertParagraphAfter\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\n';
  vba += 'Dim pic\nSet pic = ActiveDocument.InlineShapes.AddPicture(FileName:="' + imgPath + '", LinkToFile:=False, SaveWithDocument:=True, Range:=rng)\n';
  if (width) vba += 'pic.Width = ' + parseInt(width, 10) + '\n';
  if (height) vba += 'pic.Height = ' + parseInt(height, 10) + '\n';

  try { word.doJavaScript(vba); } catch (e) {
    return JSON.stringify({ error: 'Image insert failed: ' + String(e) });
  }
  return JSON.stringify({ ok: true, imagePath: imagePath, width: width || 'auto', height: height || 'auto' }, null, 2);
}

/**
 * Add a page or section break.
 * @param {string|null} filePath
 * @param {string} [type] - "page" (default) or "section"
 */
function addPageBreak(filePath, type) {
  const word = getWordApp();
  getDocument(filePath || null);
  var breakType = (type === 'section') ? 2 : 7;
  word.doJavaScript('Dim rng\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\nrng.InsertBreak Type:=' + breakType);
  return JSON.stringify({ ok: true, type: type || 'page' }, null, 2);
}

/**
 * Add a table of contents.
 * @param {string|null} filePath
 * @param {number} [levels] - heading levels to include (default: 3)
 */
function addTableOfContents(filePath, levels) {
  const word = getWordApp();
  getDocument(filePath || null);
  var numLevels = Math.max(1, Math.min(9, parseInt(levels, 10) || 3));
  word.doJavaScript('Dim rng\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\nrng.InsertParagraphAfter\nSet rng = ActiveDocument.Content\nrng.Collapse Direction:=0\nActiveDocument.TablesOfContents.Add Range:=rng, UseHeadingStyles:=True, UpperHeadingLevel:=1, LowerHeadingLevel:=' + numLevels);
  return JSON.stringify({ ok: true, levels: numLevels }, null, 2);
}

/**
 * Set header or footer text.
 * @param {string|null} filePath
 * @param {string} position - "header" or "footer"
 * @param {string} text
 */
function setHeaderFooter(filePath, position, text) {
  const word = getWordApp();
  getDocument(filePath || null);
  var escaped = (text || '').replace(/"/g, '\\"');
  if (position === 'footer') {
    word.doJavaScript('ActiveDocument.Sections(1).Footers(1).Range.Text = "' + escaped + '"');
  } else {
    word.doJavaScript('ActiveDocument.Sections(1).Headers(1).Range.Text = "' + escaped + '"');
  }
  return JSON.stringify({ ok: true, position: position || 'header', text: text }, null, 2);
}

/**
 * Save the document.
 * @param {string|null} filePath
 * @param {string} [savePath] - path for Save As
 * @param {string} [format] - "docx" (default) or "pdf"
 */
function saveDocument(filePath, savePath, format) {
  const word = getWordApp();
  var doc = getDocument(filePath || null);
  if (savePath) {
    var fmt = (format === 'pdf') ? 17 : 16;
    word.doJavaScript('ActiveDocument.SaveAs2 FileName:="' + savePath.replace(/"/g, '\\"') + '", FileFormat:=' + fmt);
  } else {
    word.doJavaScript('ActiveDocument.Save');
  }
  return JSON.stringify({ ok: true, savedTo: savePath || doc.name(), format: format || 'docx' }, null, 2);
}

/**
 * Set document properties (title, author, subject, etc.).
 * @param {string|null} filePath
 * @param {string} propsJson - JSON: { title?, author?, subject?, keywords?, company?, category? }
 */
function setDocumentProperties(filePath, propsJson) {
  const word = getWordApp();
  getDocument(filePath || null);
  var props;
  try { props = JSON.parse(propsJson); } catch {
    return JSON.stringify({ error: 'Invalid JSON for properties.' });
  }

  var propMap = { title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords', comments: 'Comments', company: 'Company', category: 'Category' };
  var setProps = [];
  for (var key in propMap) {
    if (props[key] !== undefined) {
      word.doJavaScript('ActiveDocument.BuiltInDocumentProperties("' + propMap[key] + '").Value = "' + String(props[key]).replace(/"/g, '\\"') + '"');
      setProps.push(key);
    }
  }
  return JSON.stringify({ ok: true, propertiesSet: setProps }, null, 2);
}
