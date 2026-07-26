// Escape a value for interpolation into an HTML template literal.
//
// Audit 2026-07-26 S6/H6: several panels build markup from upstream strings —
// calendar titles come from external ICS feeds, Sonarr/Radarr titles and fuel
// station names come from those APIs. The report's prescribed fix ("replace
// innerHTML with textContent") does not apply to those sites: they are building
// real markup, and textContent would render the tags as visible text. Escaping
// the interpolated value is the fix that keeps the markup and closes the hole.
//
// Covers the four characters that can break out of either an element body or a
// quoted attribute value. Matches the existing copies in modules/cameraTiles.js
// and modules/recipePanel.js, which predate this module and are left alone.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
