/**
 * Minimal RFC 4180-ish CSV parser: handles quoted fields, escaped quotes
 * ("" inside a quoted field), and CRLF/LF line endings.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  if (!nonEmptyRows.length) return { headers: [], records: [] };

  const [headers, ...dataRows] = nonEmptyRows;
  const records = dataRows.map((r) =>
    Object.fromEntries(headers.map((header, index) => [header, r[index] ?? ""]))
  );
  return { headers, records };
}

/**
 * Sigma's export only fills a pivot/grouped-table's row-dimension columns
 * on the first row of each group, leaving subsequent rows blank (mirroring
 * the merged-cell look in the UI). Mutating records in place: carry the
 * last non-blank value in each named column down through following blanks,
 * so grouping/splitting by that column works on every row, not just the
 * first of each group.
 */
export function forwardFillColumns(records, columnNames) {
  const lastValue = {};
  for (const record of records) {
    for (const name of columnNames) {
      if (record[name] === "" || record[name] === null || record[name] === undefined) {
        if (name in lastValue) record[name] = lastValue[name];
      } else {
        lastValue[name] = record[name];
      }
    }
  }
}
