import { client, useConfig, useElementColumns, useElementData } from "@sigmacomputing/plugin";
import { useCallback, useMemo, useState } from "react";
import { exportToExcel } from "./exportToExcel";
import "./App.css";

client.config.configureEditorPanel([
  { name: "source", type: "element" },
  { name: "splitColumn", type: "column", source: "source", allowMultiple: false },
]);

function App() {
  const config = useConfig();
  const columnInfo = useElementColumns(config.source);
  const sigmaData = useElementData(config.source);
  const [status, setStatus] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const columnOrder = useMemo(() => Object.keys(columnInfo || {}), [columnInfo]);
  const hasData = columnOrder.length > 0 && sigmaData && Object.keys(sigmaData).length > 0;
  const splitColumnName = config.splitColumn ? columnInfo?.[config.splitColumn]?.name : null;

  const groupCount = useMemo(() => {
    if (!config.splitColumn || !hasData) return null;
    const values = sigmaData[config.splitColumn] || [];
    const distinct = new Set(
      values.map((v) => (v === null || v === undefined ? "Blank" : String(v)))
    );
    return distinct.size;
  }, [config.splitColumn, hasData, sigmaData]);

  const handleExport = useCallback(async () => {
    setStatus(null);
    setIsExporting(true);
    try {
      const result = await exportToExcel({
        columnOrder,
        columnInfo,
        sigmaData,
        splitColumnId: config.splitColumn,
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
  }, [columnOrder, columnInfo, sigmaData, config.splitColumn, splitColumnName]);

  let hint = null;
  if (!config.source) {
    hint = "Select a data source in the editor panel to get started.";
  } else if (!config.splitColumn) {
    hint = "Select a column to split worksheets by in the editor panel.";
  } else if (!hasData) {
    hint = "Waiting for data…";
  }

  const canExport = Boolean(config.source && config.splitColumn && hasData) && !isExporting;

  // TEMP DEBUG — checking whether the browser exposes the parent workbook
  // URL to this iframe at all. Remove once confirmed either way.
  const debugText = [
    `document.referrer = ${JSON.stringify(document.referrer)}`,
    `window.location.href = ${JSON.stringify(window.location.href)}`,
    `location.ancestorOrigins = ${JSON.stringify(
      Array.from(window.location.ancestorOrigins ?? [])
    )}`,
  ].join("\n");

  return (
    <div className="excel-export-plugin">
      <button className="export-button" onClick={handleExport} disabled={!canExport}>
        {isExporting ? "Exporting…" : "Export to Excel"}
      </button>
      {hint && <p className="hint">{hint}</p>}
      {!hint && groupCount !== null && (
        <p className="hint">
          Will create {groupCount} worksheet{groupCount === 1 ? "" : "s"}, split by &ldquo;
          {splitColumnName}&rdquo;.
        </p>
      )}
      {status && <p className={`status status-${status.type}`}>{status.message}</p>}
      <pre className="debug-panel">{debugText}</pre>
    </div>
  );
}

export default App;
