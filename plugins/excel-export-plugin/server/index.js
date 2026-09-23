import express from "express";

const PORT = process.env.PLUGIN_SERVER_PORT || 8787;
const { SIGMA_BASE_URL, SIGMA_CLIENT_ID, SIGMA_CLIENT_SECRET } = process.env;

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  if (!SIGMA_BASE_URL || !SIGMA_CLIENT_ID || !SIGMA_CLIENT_SECRET) {
    throw new Error(
      "Missing SIGMA_BASE_URL / SIGMA_CLIENT_ID / SIGMA_CLIENT_SECRET — copy .env.example to .env and fill it in."
    );
  }
  const res = await fetch(`${SIGMA_BASE_URL}/v2/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: SIGMA_CLIENT_ID,
      client_secret: SIGMA_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Token exchange returned no access_token.");
  }
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

async function sigmaFetch(path, options = {}) {
  const token = await getToken();
  return fetch(`${SIGMA_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * Sigma workbook URLs look like ".../workbook/<slug>-<urlId>/edit" or
 * short-link form ".../b/<urlId>". Pull the trailing urlId out of either.
 */
function extractUrlId(wbPath) {
  if (!wbPath) return null;
  const segments = wbPath.split("/").filter(Boolean);
  const bIndex = segments.indexOf("b");
  if (bIndex >= 0 && segments[bIndex + 1]) return segments[bIndex + 1];
  const workbookIndex = segments.indexOf("workbook");
  const slugSegment = workbookIndex >= 0 ? segments[workbookIndex + 1] : segments[segments.length - 1];
  if (!slugSegment) return null;
  const dashIndex = slugSegment.lastIndexOf("-");
  return dashIndex >= 0 ? slugSegment.slice(dashIndex + 1) : slugSegment;
}

async function resolveWorkbookId(urlId) {
  let page;
  for (;;) {
    const qs = new URLSearchParams({ limit: "1000" });
    if (page) qs.set("page", page);
    const res = await sigmaFetch(`/v2/files?${qs}`);
    if (!res.ok) throw new Error(`Failed to list files: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const match = (data.entries || []).find((entry) => entry.urlId === urlId);
    if (match) return match.id;
    page = data.nextPage;
    if (!page) break;
  }
  throw new Error(
    `No workbook found with urlId "${urlId}". If you just created/renamed this workbook, ` +
      "make sure it's saved (no pending changes) and reload the Sigma page so the plugin picks up the current URL."
  );
}

async function fetchWorkbookSpec(workbookId) {
  const res = await sigmaFetch(`/v2/workbooks/${workbookId}/spec`);
  if (!res.ok) throw new Error(`Failed to get workbook spec: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * A spec column often has no "name" (only "formula": "[Table/Column]").
 * Derive a display name from that when a real name isn't present.
 */
function deriveColumnName(column) {
  if (column.name) return column.name;
  const match = /\/([^/\]]+)\]$/.exec(column.formula || "");
  if (match) return match[1];
  return column.formula || column.id;
}

/** Recursively find every element with a `columns` array anywhere in the spec. */
function collectElements(spec) {
  const found = [];
  function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      if (node.id && Array.isArray(node.columns)) found.push(node);
      for (const value of Object.values(node)) walk(value);
    }
  }
  walk(spec);
  return found;
}

/**
 * The element's `columns` array is NOT the visual order — confirmed
 * empirically (and documented in this repo's own sigma-workbook-conventions
 * skill, reference/specification/tables.md → "Round-trip quirks"): Sigma
 * reorders it (values first, then dimensions) regardless of authored order,
 * and for a pivot it also includes every referenced field, not just the
 * ones actually shown. The real order lives in kind-specific fields:
 *   - pivot-table: rowsBy -> columnsBy -> values (each its own order)
 *   - table with `groupings` (a "Grouped Table"): each level's
 *     groupBy -> calculations, levels in order
 *   - plain table: the `order` field (falls back to columns[] otherwise)
 */
function activeColumnIds(element) {
  if (Array.isArray(element.groupings) && element.groupings.length) {
    const ids = [];
    for (const level of element.groupings) {
      if (Array.isArray(level.groupBy)) ids.push(...level.groupBy);
      if (Array.isArray(level.calculations)) ids.push(...level.calculations);
    }
    return ids;
  }
  if (
    (Array.isArray(element.rowsBy) && element.rowsBy.length) ||
    (Array.isArray(element.columnsBy) && element.columnsBy.length) ||
    (Array.isArray(element.values) && element.values.length)
  ) {
    const ids = [];
    for (const r of element.rowsBy || []) ids.push(r.columnId ?? r.id);
    for (const c of element.columnsBy || []) ids.push(c.columnId ?? c.id);
    for (const v of element.values || []) ids.push(typeof v === "string" ? v : (v.columnId ?? v.id));
    return ids;
  }
  if (Array.isArray(element.order) && element.order.length) return element.order;
  return (element.columns || []).map((c) => c.id);
}

/**
 * The Plugin SDK's element picker (config.source) and the REST API/spec's
 * elementId are different ID spaces — empirically confirmed, no documented
 * mapping between them. Match dynamically instead: compare the column
 * names the plugin already knows (from useElementColumns, which works even
 * when useElementData doesn't) against each spec element's *actually
 * displayed* columns (see activeColumnIds), and pick the best overlap.
 * Works for any table/pivot table/grouped table without hardcoding an ID.
 */
function resolveElementFromSpec(spec, expectedColumnNames) {
  const expectedLower = new Set(expectedColumnNames.map((n) => n.toLowerCase()));
  const elements = collectElements(spec);

  const scored = [];
  for (const element of elements) {
    const nameById = new Map(element.columns.map((c) => [c.id, deriveColumnName(c)]));
    const names = activeColumnIds(element)
      .map((id) => nameById.get(id))
      .filter(Boolean);
    if (!names.length) continue;
    const lower = names.map((n) => n.toLowerCase());
    const overlap = lower.filter((n) => expectedLower.has(n)).length;
    const score = overlap / Math.max(expectedLower.size, names.length);
    scored.push({ elementId: element.id, kind: element.kind, score, columnOrder: names });
  }
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.5) {
    const summary = scored
      .slice(0, 5)
      .map((c) => `${c.elementId} (${c.kind}, score=${c.score.toFixed(2)})`)
      .join("; ");
    throw new Error(
      "Could not confidently match the plugin's source to a workbook element by its columns. " +
        `Closest candidates: ${summary || "none found"}.`
    );
  }
  return { elementId: best.elementId, columnOrder: best.columnOrder };
}

async function pollDownload(queryId) {
  const deadline = Date.now() + 60_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const res = await sigmaFetch(`/v2/query/${queryId}/download`);
    const contentType = res.headers.get("content-type") || "";

    // 202 (with or without a body) is a standard "still processing" signal.
    if (res.status === 202) {
      console.log(`[excel-export-plugin server] poll #${attempt}: 202, retrying`);
      await res.text().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    if (contentType.includes("application/json")) {
      const body = await res.json();
      console.log(`[excel-export-plugin server] poll #${attempt}: JSON`, body);
      if (body.jobComplete === false) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw new Error(`Unexpected response while polling export: ${JSON.stringify(body)}`);
    }

    if (!res.ok) throw new Error(`Export download failed: ${res.status} ${await res.text()}`);

    const text = await res.text();
    console.log(
      `[excel-export-plugin server] poll #${attempt}: ${res.status} ${contentType}, body length=${text.length}`
    );
    // A genuinely ready CSV always has at least a header row. An empty
    // 200 OK body has been observed as a transient "not ready yet" state.
    if (!text) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    return text;
  }
  throw new Error("Export timed out after 60s.");
}

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function rowsToCsv(rows) {
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

async function exportElementAsCsv(workbookId, elementId) {
  const res = await sigmaFetch(`/v2/workbooks/${workbookId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elementId, format: { type: "csv" } }),
  });
  if (!res.ok) throw new Error(`Export request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  console.log("[excel-export-plugin server] export response:", data);
  if (data.jobComplete && Array.isArray(data.rows) && data.rows.length) {
    return rowsToCsv(data.rows);
  }
  if (!data.queryId) throw new Error("Export response was missing a queryId.");
  return pollDownload(data.queryId);
}

const app = express();
app.use(express.json());

app.post("/api/export-pivot", async (req, res) => {
  try {
    const { wbPath, columnNames } = req.body || {};
    if (!Array.isArray(columnNames) || !columnNames.length) {
      return res.status(400).json({ error: "Missing columnNames." });
    }
    const urlId = extractUrlId(wbPath);
    if (!urlId) {
      return res.status(400).json({ error: `Could not determine workbook urlId from "${wbPath}".` });
    }
    const workbookId = await resolveWorkbookId(urlId);
    const spec = await fetchWorkbookSpec(workbookId);
    const { elementId, columnOrder } = resolveElementFromSpec(spec, columnNames);
    const csv = await exportElementAsCsv(workbookId, elementId);
    res.set("X-Column-Order", encodeURIComponent(JSON.stringify(columnOrder)));
    res.set("Access-Control-Expose-Headers", "X-Column-Order");
    res.type("text/csv").send(csv);
  } catch (err) {
    console.error("[excel-export-plugin server]", err);
    res.status(500).json({ error: err.message });
  }
});

// Debug helper: shows every candidate element found in the workbook spec,
// its computed display-column order, and its match score against the
// columnNames the plugin sent — handy when a match fails or looks wrong.
app.post("/api/debug-match", async (req, res) => {
  try {
    const { wbPath, columnNames } = req.body || {};
    const urlId = extractUrlId(wbPath);
    if (!urlId) {
      return res.status(400).json({ error: `Could not determine workbook urlId from "${wbPath}".` });
    }
    const workbookId = await resolveWorkbookId(urlId);
    const spec = await fetchWorkbookSpec(workbookId);
    const expectedLower = new Set((columnNames || []).map((n) => n.toLowerCase()));
    const candidates = collectElements(spec).map((element) => {
      const nameById = new Map(element.columns.map((c) => [c.id, deriveColumnName(c)]));
      const columnOrder = activeColumnIds(element)
        .map((id) => nameById.get(id))
        .filter(Boolean);
      const lower = columnOrder.map((n) => n.toLowerCase());
      const overlap = lower.filter((n) => expectedLower.has(n)).length;
      const score = columnOrder.length ? overlap / Math.max(expectedLower.size, columnOrder.length) : 0;
      return { elementId: element.id, kind: element.kind, columnOrder, score };
    });
    candidates.sort((a, b) => b.score - a.score);
    res.json({ workbookId, expected: columnNames, candidates });
  } catch (err) {
    console.error("[excel-export-plugin server]", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[excel-export-plugin] backend listening on http://localhost:${PORT}`);
});
