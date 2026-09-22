# Excel Export Plugin

A Sigma custom plugin (UI Element) that lets a workbook editor:

1. Pick a **data source** element on the page (in Sigma's editor panel).
2. Pick a **column to split by** — the export produces one worksheet per
   distinct value of that column.
3. Click **Export to Excel** to download a formatted `.xlsx` (bold/colored
   header row, frozen header, autofilter, zebra striping, and number/date
   formatting inferred from the data).

## Run locally

```sh
npm install   # already done if you cloned this repo as-is
npm run dev
```

This starts a Vite dev server at `http://localhost:5173`.

## Point a Sigma workbook at it

1. In Sigma, open (or create) a workbook and click **Edit**.
2. Click **+** in the sidebar → **Plugins** (under UI Elements) → **Sigma
   Plugin Dev Playground**. This adds a plugin element to the page.
3. Hover the plugin element → **•••** menu → **Point to Development URL** →
   enter `http://localhost:5173` → **Confirm**.
4. In the element's editor panel (right sidebar), set:
   - **source** → the table/element on the page you want to export.
   - **splitColumn** → the column whose distinct values become worksheets.
5. Click **Export to Excel** on the plugin element.

Your account needs **Can edit** access to the workbook and the **Manage
plugins** account permission. Code changes hot-reload in the embedded
plugin — no page refresh needed.

## Files

- `src/App.jsx` — plugin UI, editor-panel config (`configureEditorPanel`),
  and Sigma hooks (`useConfig`, `useElementColumns`, `useElementData`).
- `src/exportToExcel.js` — groups rows by the chosen column and builds the
  formatted workbook with [ExcelJS](https://github.com/exceljs/exceljs).

## Production hosting

This dev workflow (`localhost:5173` + "Point to Development URL") is for
building/testing only. To make the plugin available to other users or
persist after this session, run `npm run build` and host the contents of
`dist/` on static hosting you control, then register that URL with your
Sigma organization (see Sigma's "Register a Plugin with Your Organization"
docs) instead of pointing at a dev URL.
