# Excel Export Plugin

A Sigma custom plugin (UI Element) that lets **any viewer of the dashboard**
(no edit access required):

1. Pick a **table** from a dropdown rendered right in the plugin tile —
   including **Pivot Tables**, with their aggregated metrics intact.
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

**It doesn't use the Plugin SDK's `configureEditorPanel` element picker at
all.** That picker's IDs and the REST API's `elementId` are different ID
spaces with no documented mapping between them (confirmed empirically), and
it's edit-time/editor-only anyway — no dropdown for a regular viewer.
Instead, `POST /api/list-tables` walks the full **workbook spec**
(`GET /v2/workbooks/{id}/spec`) directly, finds every `table`/`pivot-table`/
`input-table` element, and returns real REST `elementId`s with human names
and their true display-column order — which the plugin renders as its own
dropdowns, usable by anyone viewing the dashboard.

That same spec lookup also solves column *order*, which is a separate
problem from *finding* the element. Neither `useElementColumns`' key order
nor a flat "list columns" REST endpoint reflects what's actually shown on
screen — both effectively just dump the full underlying data-model schema,
alphabetically by internal column ID. The real order lives in kind-specific
spec fields (documented in this repo's own `sigma-workbook-conventions`
skill, `reference/specification/tables.md`): a Pivot Table's `rowsBy` →
`columnsBy` → `values` (each independently ordered), a Grouped Table's
`groupings[].groupBy` → `calculations` per level, or a plain table's
`order` field. See `activeColumnIds`/`describeElement` in `server/index.js`.

Sigma's export also only fills a pivot/grouped-table's row-dimension
columns (e.g. Store Region) on the *first* row of each group, leaving
subsequent rows blank (mirroring the merged-cell look in the UI) — the
backend flags which columns need this via `groupColumnIds`
(`X-Fill-Columns` header), and the frontend forward-fills them
(`forwardFillColumns` in `src/csv.js`) before splitting into worksheets.

## Known limitation: Custom Views

`GET /v2/workbooks/{id}/spec` and the export endpoint only ever see the
**base/published workbook** — confirmed there's no `viewId`/`customViewId`
parameter on either. A **Custom View** captures changes as a separate
overlay on top of the published workbook (per Sigma's own docs), which
means structural changes made and saved *inside* a Custom View (a new pivot
row, a new table, etc.) are invisible to this plugin no matter what. If a
table/column you expect is missing from the dropdowns, make sure the
relevant configuration was saved in the base workbook, not a Custom View.

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
4. On the plugin tile itself, pick a **Table** and a **Split worksheets by**
   column from the dropdowns it renders.
5. Click **Export to Excel**.

Your account needs **Can edit** access to the workbook (to add/point the
plugin element) and the **Manage plugins** account permission — but once
it's placed, the dropdowns and export work for any viewer, no edit access
needed. Code changes hot-reload in the embedded plugin — no page refresh
needed (the backend does need a manual restart if you edit
`server/index.js`).

## Files

- `src/App.jsx` — plugin UI: fetches the table list on load, renders the
  table/column dropdowns, and drives the export.
- `src/workbookContext.js` — extracts the embedding workbook's `wbPath`
  from the plugin iframe's own URL.
- `src/csv.js` — minimal CSV parser plus `forwardFillColumns` for Sigma's
  merged-cell-style pivot export quirk.
- `src/exportToExcel.js` — groups records by the chosen column and builds
  the formatted workbook with [ExcelJS](https://github.com/exceljs/exceljs).
- `server/index.js` — local Express backend: OAuth token exchange, resolves
  the workbook ID from its `urlId`, lists table-like elements with their
  real display-column order (`/api/list-tables`), calls Sigma's export
  endpoint for a chosen element (`/api/export-pivot`), polls for
  completion, and returns the CSV.

## Production hosting

This dev workflow (`localhost:5173` + "Point to Development URL") is for
building/testing only. To make the plugin available to other users or
persist after this session:

1. Run `npm run build` and host `dist/` on static hosting you control, then
   register that URL with your Sigma organization (see Sigma's "Register a
   Plugin with Your Organization" docs) instead of pointing at a dev URL.
2. Deploy `server/index.js` somewhere reachable by that hosted plugin (it
   can no longer assume `localhost`), and update the `fetch("/api/...")`
   calls in `src/App.jsx` to point at it — keep the credentials server-side.
