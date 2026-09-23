import { useCallback, useEffect, useMemo, useState } from "react";
import { forwardFillColumns, parseCsv } from "./csv";
import { exportToExcel } from "./exportToExcel";
import { getWorkbookPath } from "./workbookContext";
import "./App.css";

function App() {
  const [tables, setTables] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  const [selectedElementId, setSelectedElementId] = useState("");
  const [splitColumnName, setSplitColumnName] = useState("");
  const [status, setStatus] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTables() {
      setIsLoadingTables(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/list-tables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wbPath: getWorkbookPath() }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load tables (${response.status}).`);
        }
        const data = await response.json();
        if (!cancelled) setTables(data.tables || []);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Failed to load tables.");
      } finally {
        if (!cancelled) setIsLoadingTables(false);
      }
    }
    loadTables();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTable = useMemo(
    () => tables.find((t) => t.elementId === selectedElementId) || null,
    [tables, selectedElementId]
  );

  const handleTableChange = (event) => {
    setSelectedElementId(event.target.value);
    setSplitColumnName("");
    setStatus(null);
  };

  const handleExport = useCallback(async () => {
    setStatus(null);
    setIsExporting(true);
    try {
      const response = await fetch("/api/export-pivot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wbPath: getWorkbookPath(), elementId: selectedElementId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Export request failed (${response.status}).`);
      }
      const csvText = await response.text();
      const { headers, records } = parseCsv(csvText);

      // Sigma's export doesn't return columns in visual left-to-right order.
      // The backend sends the element's authoritative spec-derived column
      // order via this header. Reorder to match, appending anything
      // unexpected at the end rather than dropping it.
      const columnOrderHeader = response.headers.get("X-Column-Order");
      const columnOrder = columnOrderHeader ? JSON.parse(decodeURIComponent(columnOrderHeader)) : [];
      const orderedHeaders = columnOrder.filter((name) => headers.includes(name));
      const leftoverHeaders = headers.filter((h) => !orderedHeaders.includes(h));
      const finalHeaders = [...orderedHeaders, ...leftoverHeaders];

      // Row-dimension columns (e.g. a pivot's Store Region) are only filled
      // in on the first row of each group in Sigma's export — carry them
      // down before splitting, or every row but the first lands in "Blank".
      const fillColumnsHeader = response.headers.get("X-Fill-Columns");
      const fillColumns = fillColumnsHeader ? JSON.parse(decodeURIComponent(fillColumnsHeader)) : [];
      forwardFillColumns(records, fillColumns);

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
  }, [selectedElementId, splitColumnName]);

  const canExport = Boolean(selectedElementId && splitColumnName) && !isExporting;

  return (
    <div className="excel-export-plugin">
      {isLoadingTables && <p className="hint">Loading tables…</p>}
      {loadError && <p className="status status-error">{loadError}</p>}
      {!isLoadingTables && !loadError && tables.length === 0 && (
        <p className="hint">No tables or pivot tables found in this workbook.</p>
      )}
      {!isLoadingTables && !loadError && tables.length > 0 && (
        <>
          <label className="field">
            <span>Table</span>
            <select value={selectedElementId} onChange={handleTableChange}>
              <option value="" disabled>
                Select a table…
              </option>
              {tables.map((table) => (
                <option key={table.elementId} value={table.elementId}>
                  {table.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Split worksheets by</span>
            <select
              value={splitColumnName}
              onChange={(event) => setSplitColumnName(event.target.value)}
              disabled={!selectedTable}
            >
              <option value="" disabled>
                Select a column…
              </option>
              {(selectedTable?.columnOrder || []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <button className="export-button" onClick={handleExport} disabled={!canExport}>
        {isExporting ? "Exporting…" : "Export to Excel"}
      </button>
      {status && <p className={`status status-${status.type}`}>{status.message}</p>}
    </div>
  );
}

export default App;
