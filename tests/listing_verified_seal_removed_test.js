// Dedicated test for removal of CREA/DDF-specific listing-card marks.
//
// History: listing cards originally had two separate CREA-related marks:
//   1. A self-added trust badge ("Verified · CREA DDF®", top-left corner
//      overlay on the photo) -- NOT required by CREA, added independently
//      as a visual trust signal. Removed 2026-07-28.
//   2. The "Powered by REALTOR.ca" link/logo -- WAS required by CREA's DDF
//      Policy and Rules (section 6) while DDF was the listings source.
//      Removed 2026-09-18 along with the rest of the DDF pipeline (see
//      workers/homepilot-listings and decisions-and-learnings.md) -- DDF's
//      compliance requirements do not carry over automatically to IDX.
//      PropTx's own required disclaimer wording is not yet added; do not
//      resurrect the CREA mark as a placeholder for it.
//
// This test now checks that BOTH DDF-era marks are fully gone, and that
// nothing else was collaterally broken (well-formed CSS, brokerage name
// still visible -- a real, source-agnostic requirement, not DDF-specific).
//
// Checked across all three files that embed this component's CSS
// (index.html, calculator.html, listings.html all inline their own <style>
// block containing .listing-* rules) plus the shared rendering module
// (src/listings-display.js).
//
// Run: node tests/listing_verified_seal_removed_test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DISPLAY_JS = fs.readFileSync(
  path.join(ROOT, "src", "listings-display.js"),
  "utf8"
);
const HTML_FILES = ["index.html", "calculator.html", "listings.html"].map(
  (f) => ({ name: f, content: fs.readFileSync(path.join(ROOT, f), "utf8") })
);

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${label}`);
  } else {
    failed++;
    console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`);
  }
}

// ── The self-added "Verified · CREA DDF®" badge must be fully gone ─────
check(
  "src/listings-display.js no longer emits the listing-verified-seal <span>",
  !/listing-verified-seal/.test(DISPLAY_JS)
);
check(
  "src/listings-display.js no longer contains the 'Verified · CREA DDF' text",
  !/Verified\s*[·.]?\s*CREA DDF/i.test(DISPLAY_JS)
);

for (const { name, content } of HTML_FILES) {
  check(
    `${name}: .listing-verified-seal CSS rule removed`,
    !/\.listing-verified-seal\{/.test(content)
  );
  // Sanity: each file's <style> block should still be well-formed after
  // the removal -- guards against an orphaned brace.
  const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
  check(`${name}: has a well-formed <style> block`, !!styleMatch);
  if (styleMatch) {
    const css = styleMatch[1];
    const opens = (css.match(/\{/g) || []).length;
    const closes = (css.match(/\}/g) || []).length;
    check(
      `${name}: <style> block has balanced braces (found ${opens} '{' and ${closes} '}')`,
      opens === closes
    );
  }
}

// ── The DDF-era mandatory "Powered by REALTOR.ca" mark must be GONE ────
// This was the CREA DDF compliance requirement (DDF Policy and Rules,
// section 6) -- it no longer applies now that DDF is removed. Checked in
// the rendering module, since that's the single source that used to emit
// it into every listing card.
check(
  "listing-realtor-badge (the DDF-era CREA mark) is no longer emitted",
  !/listing-realtor-badge/.test(DISPLAY_JS)
);
check(
  "'Powered by REALTOR.ca' text is no longer shown",
  !/Powered by REALTOR\.ca/.test(DISPLAY_JS)
);
check(
  "REALTOR® logo image is no longer referenced in the listing card",
  !/realtor-r\.svg/.test(DISPLAY_JS)
);
check(
  "brokerage name is still rendered as visible text (source-agnostic requirement, unaffected by DDF removal)",
  /listing-brokerage/.test(DISPLAY_JS) && /Listed by \$\{brokerage\}/.test(DISPLAY_JS)
);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
