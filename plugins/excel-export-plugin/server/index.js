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

async function listAllElements(workbookId) {
  const pagesRes = await sigmaFetch(`/v2/workbooks/${workbookId}/pages`);
  if (!pagesRes.ok) throw new Error(`List pages failed: ${pagesRes.status} ${await pagesRes.text()}`);
  const pagesData = await pagesRes.json();
  const pages = pagesData.entries || pagesData;

  const elements = [];
  for (const page of pages) {
    const pageId = page.pageId || page.id;
    const elementsRes = await sigmaFetch(`/v2/workbooks/${workbookId}/pages/${pageId}/elements`);
    if (!elementsRes.ok) continue;
    const elementsData = await elementsRes.json();
    const pageElements = elementsData.entries || elementsData;
    for (const e of pageElements) {
      elements.push({ elementId: e.elementId || e.id, type: e.type, name: e.name, pageId });
    }
  }
  return elements;
}

async function getElementColumnLabels(workbookId, elementId) {
  const res = await sigmaFetch(`/v2/workbooks/${workbookId}/elements/${elementId}/columns`);
  if (!res.ok) return [];
  const data = await res.json();
  const entries = data.entries || data;
  return entries.map((c) => (c.label || c.name || "").toLowerCase()).filter(Boolean);
}

/**
 * The Plugin SDK's element picker (config.source) and the REST API's
 * elementId are different ID spaces — empirically confirmed, no
 * documented mapping between them. Match dynamically instead: compare the
 * column names the plugin already knows (from useElementColumns, which
 * works even when useElementData doesn't) against every real element's
 * columns, and pick the best overlap. Works for any table/pivot table
 * without hardcoding an ID.
 */
async function resolveElementIdByColumns(workbookId, expectedColumnNames) {
  const expected = new Set(expectedColumnNames.map((n) => n.toLowerCase()));
  const candidates = (await listAllElements(workbookId)).filter((e) => e.type !== "plugin");

  const scored = [];
  for (const candidate of candidates) {
    const labels = await getElementColumnLabels(workbookId, candidate.elementId);
    if (!labels.length) continue;
    const overlap = labels.filter((label) => expected.has(label)).length;
    const score = overlap / Math.max(expected.size, labels.length);
    scored.push({ ...candidate, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.5) {
    const summary = scored
      .slice(0, 5)
      .map((c) => `"${c.name}" (${c.type}, score=${c.score.toFixed(2)})`)
      .join("; ");
    throw new Error(
      "Could not confidently match the plugin's source to a workbook element by its columns. " +
        `Closest candidates: ${summary || "none found"}.`
    );
  }
  return best.elementId;
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
    const elementId = await resolveElementIdByColumns(workbookId, columnNames);
    const csv = await exportElementAsCsv(workbookId, elementId);
    res.type("text/csv").send(csv);
  } catch (err) {
    console.error("[excel-export-plugin server]", err);
    res.status(500).json({ error: err.message });
  }
});

// Debug helper: lists every page/element the REST API sees for a workbook,
// with their real elementIds — handy when troubleshooting a match failure.
app.post("/api/debug-elements", async (req, res) => {
  try {
    const { wbPath } = req.body || {};
    const urlId = extractUrlId(wbPath);
    if (!urlId) {
      return res.status(400).json({ error: `Could not determine workbook urlId from "${wbPath}".` });
    }
    const workbookId = await resolveWorkbookId(urlId);
    const elements = await listAllElements(workbookId);
    res.json({ workbookId, elements });
  } catch (err) {
    console.error("[excel-export-plugin server]", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[excel-export-plugin] backend listening on http://localhost:${PORT}`);
});
