import ExcelJS from "exceljs";

const HEADER_FILL = "FF12293F";
const HEADER_FONT_COLOR = "FFFFFFFF";
const STRIPE_FILL = "FFF7F9FC";
const BORDER = { style: "thin", color: { argb: "FFD0D5DD" } };
const MAX_SHEET_NAME_LENGTH = 31;

function sanitizeSheetName(rawName, usedNames) {
  let name = String(rawName ?? "Blank")
    .replace(/[:\\/?*[\]]/g, " ")
    .trim();
  if (!name) name = "Blank";
  name = name.slice(0, MAX_SHEET_NAME_LENGTH);

  let unique = name;
  let suffixIndex = 2;
  while (usedNames.has(unique.toLowerCase())) {
    const suffix = ` (${suffixIndex})`;
    unique = name.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length) + suffix;
    suffixIndex += 1;
  }
  usedNames.add(unique.toLowerCase());
  return unique;
}

function isDateValue(value) {
  return (
    value instanceof Date ||
    (typeof value === "string" && /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(value))
  );
}

function detectNumberFormat(values) {
  const sample = values.find((v) => v !== null && v !== undefined);
  if (typeof sample !== "number") return null;
  return Number.isInteger(sample) ? "#,##0" : "#,##0.00";
}

/**
 * Groups an element's rows by a chosen column and writes one formatted
 * worksheet per distinct value, triggering a browser download of the result.
 */
export async function exportToExcel({
  columnOrder,
  columnInfo,
  sigmaData,
  splitColumnId,
  fileNamePrefix,
}) {
  const rowCount = sigmaData[splitColumnId]?.length ?? 0;
  if (!rowCount) {
    throw new Error("No data to export.");
  }

  const groupIndices = new Map();
  const groupLabels = new Map();
  for (let i = 0; i < rowCount; i++) {
    const rawValue = sigmaData[splitColumnId][i];
    const isBlank = rawValue === null || rawValue === undefined;
    const key = isBlank ? "__blank__" : String(rawValue);
    if (!groupIndices.has(key)) {
      groupIndices.set(key, []);
      groupLabels.set(key, isBlank ? "Blank" : String(rawValue));
    }
    groupIndices.get(key).push(i);
  }

  const columnFormats = new Map(
    columnOrder.map((colId) => [colId, detectNumberFormat(sigmaData[colId] ?? [])])
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sigma Excel Export Plugin";
  workbook.created = new Date();

  const usedSheetNames = new Set();

  for (const [key, indices] of groupIndices) {
    const worksheet = workbook.addWorksheet(
      sanitizeSheetName(groupLabels.get(key), usedSheetNames)
    );

    worksheet.columns = columnOrder.map((colId) => ({
      header: columnInfo[colId]?.name ?? colId,
      key: colId,
      width: 22,
    }));

    for (const rowIndex of indices) {
      const rowValues = {};
      for (const colId of columnOrder) {
        const value = sigmaData[colId]?.[rowIndex];
        rowValues[colId] = isDateValue(value) ? new Date(value) : value;
      }
      worksheet.addRow(rowValues);
    }

    const headerRow = worksheet.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: BORDER, left: BORDER, right: BORDER, bottom: BORDER };
    });
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnOrder.length },
    };

    for (let displayRow = 2; displayRow <= worksheet.rowCount; displayRow++) {
      const sourceRowIndex = indices[displayRow - 2];
      const row = worksheet.getRow(displayRow);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const colId = columnOrder[colNumber - 1];
        cell.border = { top: BORDER, left: BORDER, right: BORDER, bottom: BORDER };
        if (isDateValue(sigmaData[colId]?.[sourceRowIndex])) {
          cell.numFmt = "yyyy-mm-dd";
        } else if (columnFormats.get(colId)) {
          cell.numFmt = columnFormats.get(colId);
        }
        if (displayRow % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE_FILL } };
        }
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileNamePrefix || "sigma-export"}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  return { sheetCount: groupIndices.size, rowCount };
}
