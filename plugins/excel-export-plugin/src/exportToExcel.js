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

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(value);
}

function isNumericString(value) {
  return typeof value === "string" && value !== "" && /^-?\d+(\.\d+)?$/.test(value);
}

function coerceValue(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  if (isNumericString(raw)) return Number(raw);
  if (isDateString(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return raw;
}

function detectNumberFormat(values) {
  const sample = values.find((v) => typeof v === "number");
  if (sample === undefined) return null;
  return Number.isInteger(sample) ? "#,##0" : "#,##0.00";
}

/**
 * Groups CSV records (already the exact values Sigma computed server-side,
 * aggregates included) by a chosen column and writes one formatted
 * worksheet per distinct value, triggering a browser download.
 */
export async function exportToExcel({ headers, records, splitColumnName, fileNamePrefix }) {
  if (!records.length) {
    throw new Error("No data to export.");
  }
  if (!headers.includes(splitColumnName)) {
    throw new Error(`Column "${splitColumnName}" was not found in the exported data.`);
  }

  const coercedRecords = records.map((record) => {
    const coerced = {};
    for (const header of headers) coerced[header] = coerceValue(record[header]);
    return coerced;
  });

  const groups = new Map();
  for (const record of coercedRecords) {
    const raw = record[splitColumnName];
    const key = raw === null || raw === undefined ? "__blank__" : String(raw);
    if (!groups.has(key)) {
      groups.set(key, { label: raw === null || raw === undefined ? "Blank" : String(raw), rows: [] });
    }
    groups.get(key).rows.push(record);
  }

  const columnFormats = new Map(
    headers.map((header) => [header, detectNumberFormat(coercedRecords.map((r) => r[header]))])
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sigma Excel Export Plugin";
  workbook.created = new Date();
  const usedSheetNames = new Set();

  for (const { label, rows } of groups.values()) {
    const worksheet = workbook.addWorksheet(sanitizeSheetName(label, usedSheetNames));
    worksheet.columns = headers.map((header) => ({ header, key: header, width: 22 }));
    for (const row of rows) worksheet.addRow(row);

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
      to: { row: 1, column: headers.length },
    };

    for (let displayRow = 2; displayRow <= worksheet.rowCount; displayRow++) {
      const record = rows[displayRow - 2];
      const row = worksheet.getRow(displayRow);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber - 1];
        cell.border = { top: BORDER, left: BORDER, right: BORDER, bottom: BORDER };
        if (record[header] instanceof Date) {
          cell.numFmt = "yyyy-mm-dd";
        } else if (columnFormats.get(header)) {
          cell.numFmt = columnFormats.get(header);
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

  return { sheetCount: groups.size, rowCount: records.length };
}
