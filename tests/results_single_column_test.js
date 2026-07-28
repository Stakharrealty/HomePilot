// Dedicated test for single-column city results layout (2026-07-28).
//
// Symptom reported: on desktop, #list (the city results container) used
// grid-template-columns:repeat(2,1fr), showing two city cards side by side
// per row. This read as confusing -- cards are dense (property-type
// breakdown, AI insights link, compare checkbox, CTA button), and comparing
// two at once made it hard to focus on either.
//
// Fix: #list now uses grid-template-columns:1fr at the >=1024px breakpoint,
// so city cards stack one at a time, full width, matching the mobile
// single-column behavior (mobile was already single-column by default,
// since this grid rule only applies inside the min-width:1024px block).
//
// Run: node tests/results_single_column_test.js

const fs = require("fs");
const path = require("path");

const CALC_HTML = fs.readFileSync(
  path.join(__dirname, "..", "calculator.html"),
  "utf8"
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

// Isolate the specific desktop block that defines #list's grid -- the file
// has multiple @media(min-width:1024px) blocks, so match on the block that
// actually contains "#list{" to avoid a false match against an unrelated
// desktop rule elsewhere in the file.
const listBlockMatch = CALC_HTML.match(
  /@media\(min-width:1024px\)\{\s*#calculatorSection\{[\s\S]*?#list\{[\s\S]*?\n  \}[\s\S]*?\n\}/
);
check(
  "desktop block containing #list's grid rules found",
  !!listBlockMatch
);
const listBlock = listBlockMatch ? listBlockMatch[0] : "";

// Extract just the #list{...} rule within that block for precise checks.
const listRuleMatch = listBlock.match(/#list\{([^}]*)\}/);
check("#list{...} rule found inside the desktop block", !!listRuleMatch);
const listRule = listRuleMatch ? listRuleMatch[1] : "";

check(
  "#list uses grid-template-columns:1fr (single column, not repeat(2,...))",
  /grid-template-columns:1fr(?!,)/.test(listRule)
);
check(
  "#list does NOT use a 2-column repeat() grid anymore",
  !/repeat\(2,\s*1fr\)/.test(listRule)
);
check(
  "#list keeps display:grid (still a grid, just one column)",
  /display:grid/.test(listRule)
);
check(
  "#list keeps its gap between cards (unchanged spacing)",
  /gap:14px/.test(listRule)
);
check(
  "#list has no max-width cap (full-width single column, not a narrower centered column)",
  !/max-width/.test(listRule)
);

// Sanity: the <style> block should still be well-formed after this edit.
const styleMatch = CALC_HTML.match(/<style>([\s\S]*?)<\/style>/);
check("calculator.html has a single well-formed <style> block", !!styleMatch);
if (styleMatch) {
  const css = styleMatch[1];
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  check(
    `<style> block has balanced braces (found ${opens} '{' and ${closes} '}')`,
    opens === closes
  );
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
