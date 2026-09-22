import { client, useConfig, useElementColumns, useElementData } from "@sigmacomputing/plugin";
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
  const sigmaData = useElementData(config.source); // TEMP DEBUG probe, see debugText below
  const [status, setStatus] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const splitColumnName = config.splitColumn ? columnInfo?.[config.splitColumn]?.name : null;

  const handleExport = useCallback(async () => {
    setStatus(null);
    setIsExporting(true);
    try {
      const response = await fetch("/api/export-pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wbPath: getWorkbookPath(), elementId: config.source }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Export request failed (${response.status}).`);
      }
      const csvText = await response.text();
      const { headers, records } = parseCsv(csvText);
      const result = await exportToExcel({
        headers,
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
  }, [config.source, splitColumnName]);

  let hint = null;
  if (!config.source) {
    hint = "Select a data source (e.g. a Pivot Table) in the editor panel to get started.";
  } else if (!config.splitColumn) {
    hint = "Select a column to split worksheets by in the editor panel.";
  }

  const canExport = Boolean(config.source && config.splitColumn) && !isExporting;

  // TEMP DEBUG — checking whether a Grouped Table's aggregate columns come
  // through the client-side hooks (unlike a Pivot Table's). Remove once
  // this is settled either way.
  const debugText = useMemo(() => {
    const columnIds = Object.keys(columnInfo || {});
    if (!columnIds.length) return "(no source selected yet)";
    return columnIds
      .map((colId) => {
        const values = sigmaData?.[colId] ?? [];
        return `${colId} | "${columnInfo[colId]?.name ?? "(no name)"}" | len=${
          values.length
        } | ${JSON.stringify(values.slice(0, 3))}`;
      })
      .join("\n");
  }, [columnInfo, sigmaData]);

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
      <pre className="debug-panel">{debugText}</pre>
    </div>
  );
}

export default App;
