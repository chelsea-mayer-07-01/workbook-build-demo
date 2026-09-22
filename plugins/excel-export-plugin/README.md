# Excel Export Plugin

A Sigma custom plugin (UI Element) that lets a workbook editor:

1. Pick a **data source** element on the page (in Sigma's editor panel) —
   including a **Pivot Table**, with its aggregated metrics intact.
2. Pick a **column to split by** — the export produces one worksheet per
   distinct value of that column.
3. Click **Export to Excel** to download a formatted `.xlsx` (bold/colored
   header row, frozen header, autofilter, zebra striping, and number/date
   formatting inferred from the data).

## Why this needs a backend

Sigma's client-side plugin hooks (`useElementData`) only return raw,
row-level values — they can't read a Pivot Table's aggregated/summarized
metrics (confirmed empirically: an aggregate measure column comes back as
an empty array through that API). To export a pivot table's actual computed
values, this plugin instead calls **Sigma's REST API export endpoint**
(`POST /v2/workbooks/{workbookId}/export`), which explicitly supports pivot
tables and returns the exact values Sigma renders — no formulas
re-implemented on our end.

That REST call needs an OAuth bearer token (from a client ID/secret), which
must never be embedded in browser-shipped plugin code. So `server/index.js`
is a small local Express backend that holds those credentials (via `.env`,
same pattern as this repo's `scripts/api/`) and proxies the export request;
the browser-side plugin only ever talks to `localhost` over `/api/*`.

The plugin identifies which workbook it's embedded in **dynamically**, with
no manual setup per workbook: Sigma appends a `wbPath` query param (e.g.
`.../workbook/Exploration-<urlId>/edit`) to the plugin iframe's own URL,
and the backend resolves that `urlId` to a real workbook ID via `/v2/files`
(`document.referrer` is blocked by Sigma's iframe policy, so this is the
one reliable source for it — see `src/workbookContext.js`).

## Run locally

```sh
npm install                 # already done if you cloned this repo as-is
cp .env.example .env
# then fill in SIGMA_BASE_URL / SIGMA_CLIENT_ID / SIGMA_CLIENT_SECRET
npm run dev
```

`npm run dev` starts **both** the Vite dev server (`http://localhost:5173`,
or the next free port if that one's taken) and the local export backend
(`http://localhost:8787` by default) together.

## Point a Sigma workbook at it

1. In Sigma, open (or create) a workbook and click **Edit**.
2. Click **+** in the sidebar → **Plugins** (under UI Elements) → **Sigma
   Plugin Dev Playground**. This adds a plugin element to the page.
3. Hover the plugin element → **•••** menu → **Point to Development URL** →
   enter the Vite URL from your terminal (e.g. `http://localhost:5173`) →
   **Confirm**.
4. In the element's editor panel (right sidebar), set:
   - **source** → the Pivot Table (or other element) you want to export.
   - **splitColumn** → the column whose distinct values become worksheets.
5. Click **Export to Excel** on the plugin element.

Your account needs **Can edit** access to the workbook and the **Manage
plugins** account permission. Code changes hot-reload in the embedded
plugin — no page refresh needed (the backend does need a manual restart if
you edit `server/index.js`).

## Files

- `src/App.jsx` — plugin UI and editor-panel config (`configureEditorPanel`).
- `src/workbookContext.js` — extracts the embedding workbook's `wbPath`
  from the plugin iframe's own URL.
- `src/csv.js` — minimal CSV parser for the backend's export response.
- `src/exportToExcel.js` — groups records by the chosen column and builds
  the formatted workbook with [ExcelJS](https://github.com/exceljs/exceljs).
- `server/index.js` — local Express backend: OAuth token exchange, resolves
  the workbook ID from its `urlId`, calls Sigma's export endpoint, polls
  for completion, and returns the CSV.

## Production hosting

This dev workflow (`localhost:5173` + "Point to Development URL") is for
building/testing only. To make the plugin available to other users or
persist after this session:

1. Run `npm run build` and host `dist/` on static hosting you control, then
   register that URL with your Sigma organization (see Sigma's "Register a
   Plugin with Your Organization" docs) instead of pointing at a dev URL.
2. Deploy `server/index.js` somewhere reachable by that hosted plugin (it
   can no longer assume `localhost`), and update the `fetch("/api/...")`
   call in `src/App.jsx` to point at it — keep the credentials server-side.
