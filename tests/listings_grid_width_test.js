// Listings page layout regression: desktop should show 3 large cards per row
// (HouseSigma-style) from 1440px to 1920px+, without dropping to 2 or jumping
// to 4, and mobile must not overflow. Pure static CSS check: it reads the real
// values from listings.html and simulates CSS grid auto-fill column counts.
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "listings.html"), "utf8");
let failed = 0;
function check(name, ok) { console.log((ok ? "PASS" : "FAIL") + " - " + name); if (!ok) failed++; }

const lw = html.match(/\.lw\{([^}]*)\}/);
const lwCss = lw ? lw[1] : "";
const grid = html.match(/\.listings-grid\{([^}]*)\}/);
const gridCss = grid ? grid[1] : "";

const capM = lwCss.match(/max-width:(\d+)px/);
const cap = capM ? +capM[1] : Infinity;
const minM = gridCss.match(/repeat\(auto-fill,minmax\(min\((\d+)px,100%\),1fr\)\)/);
const gapM = gridCss.match(/gap:(\d+)px/);
check(".listings-grid uses repeat(auto-fill,minmax(min(Npx,100%),1fr))", !!minM);
check(".listings-grid declares a px gap", !!gapM);
check(".lw keeps 1rem side padding on small screens", /padding:[^;]*\s1rem\s/.test(lwCss));
const deskPad = html.match(/@media\(min-width:1024px\)\{\.lw\{padding-left:(\d+(?:\.\d+)?)rem;padding-right:\1rem\}\}/);
check(".lw has desktop side padding at >=1024px", !!deskPad);

if (minM && gapM && deskPad) {
  const min = +minM[1], gap = +gapM[1], pad = +deskPad[1] * 16;
  const SCROLLBAR = 15; // worst case: classic scrollbar eats viewport width
  function cols(viewport) {
    const inner = Math.min(viewport - SCROLLBAR - 2 * pad, cap - 2 * pad);
    return Math.max(1, Math.floor((inner + gap) / (min + gap)));
  }
  [1440, 1600, 1920, 2560, 3440].forEach(w => check("3 columns at " + w + "px (got " + cols(w) + ")", cols(w) === 3));
  const mobileInner = 375 - 2 * 16;
  check("mobile 375px: card min never exceeds available width (no overflow)", /min\(\d+px,100%\)/.test(gridCss) && mobileInner > 0);
  check("cards are large, not thumbnails (min >= 380px)", min >= 380);
}
process.exit(failed ? 1 : 0);
