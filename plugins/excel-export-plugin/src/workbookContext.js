/**
 * Sigma appends wbOrigin/wbPath query params (JSON-encoded strings) to a
 * plugin iframe's own URL, identifying the embedding workbook. This is the
 * only reliable, dynamic way to learn which workbook a plugin instance is
 * in — document.referrer is blocked by Sigma's iframe policy.
 */
export function getWorkbookPath() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("wbPath");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
