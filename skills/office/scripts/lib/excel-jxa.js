// excel-jxa.js — macOS JXA backend for Excel automation
// Loaded by shell scripts via: osascript -l JavaScript

function getApp() {
  const app = Application("Microsoft Excel");
  if (!app.running()) {
    throw new Error("Microsoft Excel is not running. Please open Excel first.");
  }
  app.includeStandardAdditions = true;
  return app;
}

function getWorkbook(filePath) {
  const app = getApp();
  if (filePath) {
    return app.open(filePath);
  }
  if (app.activeWorkbook) {
    return app.activeWorkbook;
  }
  throw new Error("No active workbook. Provide a file path or open a workbook.");
}

function readStructure(filePath) {
  const wb = getWorkbook(filePath);
  const sheets = [];
  for (let i = 0; i < wb.worksheets.length; i++) {
    const ws = wb.worksheets[i];
    const usedRange = ws.usedRange;
    sheets.push({
      name: ws.name(),
      rowCount: usedRange ? usedRange.rows.length : 0,
      columnCount: usedRange ? usedRange.columns.length : 0,
    });
  }
  return JSON.stringify({
    name: wb.name(),
    path: wb.fullName(),
    sheetCount: sheets.length,
    sheets: sheets,
  });
}

function readRange(filePath, sheetName, rangeStr, readAll) {
  const wb = getWorkbook(filePath);
  let ws;
  if (sheetName) {
    ws = wb.worksheets[sheetName];
  } else {
    ws = wb.activeSheet;
  }
  if (!ws) throw new Error("Sheet not found: " + sheetName);

  let range;
  if (readAll || rangeStr === "all") {
    range = ws.usedRange;
  } else {
    range = ws.ranges[rangeStr];
  }
  if (!range) throw new Error("Invalid range: " + rangeStr);

  const values = range.value();
  // values is a 2D array
  return JSON.stringify({
    sheet: ws.name(),
    range: rangeStr || "usedRange",
    rows: Array.isArray(values[0]) ? values.length : 1,
    cols: Array.isArray(values[0]) ? values[0].length : values.length,
    data: values,
  });
}

function searchText(filePath, query) {
  const wb = getWorkbook(filePath);
  const matches = [];
  for (let s = 0; s < wb.worksheets.length; s++) {
    const ws = wb.worksheets[s];
    const usedRange = ws.usedRange;
    if (!usedRange) continue;
    const found = usedRange.find({
      what: query,
      lookIn: "values",
    });
    if (found) {
      // Excel JXA find returns first match
      matches.push({
        sheet: ws.name(),
        address: found.address(),
        value: found.value(),
      });
    }
    if (matches.length >= 50) break;
  }
  return JSON.stringify({
    query: query,
    matchCount: matches.length,
    matches: matches,
  });
}

function createWorkbook(savePath, sheetNames) {
  const app = getApp();
  const wb = app.Workbook().make();
  if (sheetNames) {
    const names = typeof sheetNames === "string" ? sheetNames.split(",") : sheetNames;
    // Rename first sheet
    if (names.length > 0) {
      wb.worksheets[0].name = names[0].trim();
    }
    // Add remaining sheets
    for (let i = 1; i < names.length; i++) {
      const newSheet = app.Worksheet().make({ at: wb });
      newSheet.name = names[i].trim();
    }
  }
  if (savePath) {
    wb.saveAs(savePath);
  }
  return JSON.stringify({
    created: true,
    path: savePath || wb.fullName(),
    sheets: wb.worksheets.length,
  });
}

function writeRange(filePath, sheetName, startCell, dataJson) {
  const wb = getWorkbook(filePath);
  let ws;
  if (sheetName) {
    ws = wb.worksheets[sheetName];
  } else {
    ws = wb.activeSheet;
  }
  if (!ws) throw new Error("Sheet not found: " + sheetName);

  const data = JSON.parse(dataJson);
  const startRange = ws.ranges[startCell];
  // Write 2D array starting from startCell
  for (let r = 0; r < data.length; r++) {
    const row = Array.isArray(data[r]) ? data[r] : [data[r]];
    for (let c = 0; c < row.length; c++) {
      const cell = startRange.offset({ rowOffset: r, columnOffset: c });
      cell.value = row[c];
    }
  }
  wb.save();
  return JSON.stringify({
    written: true,
    sheet: ws.name(),
    startCell: startCell,
    rows: data.length,
    cols: data[0] ? data[0].length : 0,
  });
}

function addSheet(filePath, sheetName) {
  const wb = getWorkbook(filePath);
  const app = getApp();
  const newSheet = app.Worksheet().make({ at: wb });
  if (sheetName) {
    newSheet.name = sheetName;
  }
  wb.save();
  return JSON.stringify({
    added: true,
    name: newSheet.name(),
    totalSheets: wb.worksheets.length,
  });
}

function setFormula(filePath, sheetName, cellAddress, formula) {
  const wb = getWorkbook(filePath);
  let ws;
  if (sheetName) {
    ws = wb.worksheets[sheetName];
  } else {
    ws = wb.activeSheet;
  }
  if (!ws) throw new Error("Sheet not found: " + sheetName);

  const cell = ws.ranges[cellAddress];
  cell.formula = formula;
  wb.save();
  return JSON.stringify({
    set: true,
    cell: cellAddress,
    formula: formula,
    value: cell.value(),
  });
}

function formatRange(filePath, sheetName, rangeStr, formatJson) {
  const wb = getWorkbook(filePath);
  let ws;
  if (sheetName) {
    ws = wb.worksheets[sheetName];
  } else {
    ws = wb.activeSheet;
  }
  if (!ws) throw new Error("Sheet not found: " + sheetName);

  const range = ws.ranges[rangeStr];
  const fmt = JSON.parse(formatJson);

  if (fmt.bold !== undefined) range.font.bold = fmt.bold;
  if (fmt.italic !== undefined) range.font.italic = fmt.italic;
  if (fmt.fontSize) range.font.size = fmt.fontSize;
  if (fmt.fontColor) range.font.color = parseInt(fmt.fontColor, 16);
  if (fmt.bgColor) range.interior.color = parseInt(fmt.bgColor, 16);
  if (fmt.numberFormat) range.numberFormat = fmt.numberFormat;

  wb.save();
  return JSON.stringify({ formatted: true, range: rangeStr });
}

function saveWorkbook(filePath, saveAs) {
  const wb = getWorkbook(filePath);
  if (saveAs) {
    wb.saveAs(saveAs);
  } else {
    wb.save();
  }
  return JSON.stringify({ saved: true, path: saveAs || wb.fullName() });
}
