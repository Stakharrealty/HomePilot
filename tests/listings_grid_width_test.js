// Listings page layout regression: the wrapper must not be capped at a
// narrow width (was 960px, ~3 cards/row on desktop) and the grid must stay
// auto-fill so mobile/tablet still collapse to fewer columns.
// Pure static CSS check -- no server or jsdom needed.
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "listings.html"), "utf8");
let failed = 0;
function check(name, ok) { console.log((ok ? "PASS" : "FAIL") + " - " + name); if (!ok) failed++; }

const lw = html.match(/\.lw\{([^}]*)\}/);
const maxW = lw && lw[1].match(/max-width:(\d+)px/);
check(".lw is not width-capped (no px max-width below 1400px)", !!lw && (!maxW || +maxW[1] >= 1400));
const grid = html.match(/\.listings-grid\{([^}]*)\}/);
check(".listings-grid uses repeat(auto-fill,minmax(...))", !!grid && /repeat\(auto-fill,minmax\(\d+px,1fr\)\)/.test(grid[1]));
check(".lw keeps horizontal padding on small screens", !!lw && /padding:[^;]*\s1rem\s/.test(lw[1]));
process.exit(failed ? 1 : 0);
