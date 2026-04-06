const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        WidthType, ShadingType, HeadingLevel, BorderStyle, AlignmentType } = require('docx');

// Border style for table
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

// Table configuration
const tableWidth = 9360; // US Letter content width (12240 - 1440 - 1440)
const colWidths = [3120, 3120, 3120]; // Equal columns: 9360 / 3

const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: {
          width: 12240,   // US Letter width (8.5 inches)
          height: 15840   // US Letter height (11 inches)
        },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } // 1 inch margins
      }
    },
    children: [
      // Heading 1
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Quarterly Report")]
      }),

      // Intro paragraph
      new Paragraph({
        children: [new TextRun("This report summarizes quarterly performance metrics including revenue and growth percentages for the first three quarters of the fiscal year.")]
      }),

      // Table
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [
          // Header row
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: colWidths[0], type: WidthType.DXA },
                shading: { fill: "2E75B6", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Quarter", bold: true, color: "FFFFFF" })]
                })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[1], type: WidthType.DXA },
                shading: { fill: "2E75B6", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Revenue", bold: true, color: "FFFFFF" })]
                })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[2], type: WidthType.DXA },
                shading: { fill: "2E75B6", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Growth", bold: true, color: "FFFFFF" })]
                })]
              })
            ]
          }),
          // Q1 row
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: colWidths[0], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Q1")] })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[1], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("$2.5M")] })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[2], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("12%")] })]
              })
            ]
          }),
          // Q2 row
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: colWidths[0], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Q2")] })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[1], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("$3.1M")] })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[2], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("24%")] })]
              })
            ]
          }),
          // Q3 row
          new TableRow({
            children: [
              new TableCell({
                borders,
                width: { size: colWidths[0], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("Q3")] })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[1], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("$3.8M")] })]
              }),
              new TableCell({
                borders,
                width: { size: colWidths[2], type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun("23%")] })]
              })
            ]
          })
        ]
      })
    ]
  }]
});

// Save the document
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/tmp/tix-docx-tests-37616/report.docx", buffer);
  console.log("Document created successfully at /tmp/tix-docx-tests-37616/report.docx");
});
