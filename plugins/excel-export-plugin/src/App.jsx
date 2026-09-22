import { client, useConfig, useElementColumns } from "@sigmacomputing/plugin";
import { useCallback, useMemo, useState } from "react";
import { parseCsv } from "./csv";
import { exportToExcel } from "./exportToExcel";
import { getWorkbookPath } from "./workbookContext";
import "./App.css";

client.config.configureEditorPanel([
  { name: "source", type: "element" },
  { name: "splitColumn", type: "column", source: "source", allowMultiple: false },
]);

function App() {
  const config = useConfig();
  const columnInfo = useElementColumns(config.source);
  const [status, setStatus] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const splitColumnName = config.splitColumn ? columnInfo?.[config.splitColumn]?.name : null;
  const columnNames = useMemo(
    () => Object.values(columnInfo || {}).map((c) => c.name).filter(Boolean),
    [columnInfo]
  );

  const handleExport = useCallback(async () => {
    setStatus(null);
    setIsExporting(true);
    try {
      const response = await fetch("/api/export-pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wbPath: getWorkbookPath(), columnNames }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Export request failed (${response.status}).`);
      }
      const csvText = await response.text();
      const { headers, records } = parseCsv(csvText);
      // Sigma's export doesn't necessarily return columns in visual left-to-
      // right order, but columnNames (from useElementColumns) does — reorder
      // to match, appending anything unexpected at the end rather than
      // dropping it.
      const orderedHeaders = columnNames.filter((name) => headers.includes(name));
      const leftoverHeaders = headers.filter((h) => !orderedHeaders.includes(h));
      const finalHeaders = [...orderedHeaders, ...leftoverHeaders];
      const result = await exportToExcel({
        headers: finalHeaders,
        records,
        splitColumnName,
        fileNamePrefix: splitColumnName ? `export-by-${splitColumnName}` : "sigma-export",
      });
      setStatus({
        type: "success",
        message: `Exported ${result.rowCount} rows across ${result.sheetCount} worksheet${
          result.sheetCount === 1 ? "" : "s"
        }.`,
      });
    } catch (err) {
      setStatus({ type: "error", message: err.message || "Export failed." });
    } finally {
      setIsExporting(false);
    }
  }, [columnNames, splitColumnName]);

  let hint = null;
  if (!config.source) {
    hint = "Select a data source (e.g. a Pivot Table) in the editor panel to get started.";
  } else if (!config.splitColumn) {
    hint = "Select a column to split worksheets by in the editor panel.";
  }

  const canExport = Boolean(config.source && config.splitColumn) && !isExporting;

  return (
    <div className="excel-export-plugin">
      <button className="export-button" onClick={handleExport} disabled={!canExport}>
        {isExporting ? "Exporting…" : "Export to Excel"}
      </button>
      {hint && <p className="hint">{hint}</p>}
      {!hint && (
        <p className="hint">
          Will split worksheets by &ldquo;{splitColumnName}&rdquo;, using the exact values Sigma
          computes for this element.
        </p>
      )}
      {status && <p className={`status status-${status.type}`}>{status.message}</p>}
    </div>
  );
}

export default App;
