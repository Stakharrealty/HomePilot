// Dedicated test for removal of the "Verified · CREA DDF®" listing badge
// (2026-07-28).
//
// Context: listing cards had two separate CREA-related marks:
//   1. A self-added trust badge ("Verified · CREA DDF®", top-left corner
//      overlay on the photo) -- NOT required by CREA, added independently
//      as a visual trust signal.
//   2. The "Powered by REALTOR.ca" link/logo -- IS required by CREA's DDF
//      Policy and Rules (section 6): every listing must show a mark linking
//      to the listing's REALTOR.ca page.
//
// Per explicit direction, badge #1 was removed. Badge #2 (the actual CREA
// compliance requirement) must remain untouched -- removing it would be a
// real compliance regression, not a cosmetic one, so this test explicitly
// checks both directions: the trust badge is gone, AND the compliance mark
// is still fully intact.
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

// ── The mandatory CREA "Powered by REALTOR.ca" mark must be UNTOUCHED ──
// This is the actual compliance requirement (CREA DDF Policy and Rules,
// section 6) -- removing the unrelated trust badge must not have touched
// this. Checked in the rendering module, since that's the single source
// that emits it into every listing card.
check(
  "listing-realtor-badge (the REQUIRED CREA mark) is still emitted",
  /listing-realtor-badge/.test(DISPLAY_JS)
);
check(
  "REALTOR.ca badge still links to the listing's REALTOR.ca page (listingUrl)",
  /listing-realtor-badge[\s\S]{0,40}href="\$\{listingUrl/.test(DISPLAY_JS)
);
check(
  "REALTOR.ca badge still shows the REALTOR® logo image",
  /listing-realtor-badge-logo/.test(DISPLAY_JS)
);
check(
  "REALTOR.ca badge still shows the 'Powered by REALTOR.ca' text (visible, not hidden)",
  /Powered by REALTOR\.ca/.test(DISPLAY_JS)
);
check(
  "brokerage name is still rendered as visible text (separate CREA requirement, unaffected by this change)",
  /listing-brokerage/.test(DISPLAY_JS) && /Listed by \$\{brokerage\}/.test(DISPLAY_JS)
);

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
