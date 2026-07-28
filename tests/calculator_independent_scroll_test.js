// Dedicated test for the calculator form panel's independent scroll (2026-07-28).
//
// Symptom reported: on desktop, #calculatorSection had position:sticky but no
// bounded height and no overflow handling. If the form's content (income,
// down payment, work arrangement, area, first-time buyer, family size cards)
// was taller than the viewport, its lower fields went off-screen with no way
// to reach them except scrolling the page itself -- which visually tracks
// with the taller results column on the right, making it look like you had
// to "use the results scrollbar" to move the calculator form.
//
// Fix: #calculatorSection now has max-height:calc(100vh - 48px) and
// overflow-y:auto at the >=1024px breakpoint, so it scrolls independently
// once its content exceeds the viewport, regardless of the results column's
// height.
//
// Run: node tests/calculator_independent_scroll_test.js

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

// Isolate the >=1024px desktop layout block that actually contains
// #calculatorSection -- the file has several @media(min-width:1024px)
// blocks for unrelated sections, so match on content, not just the query.
const desktopBlockMatch = CALC_HTML.match(
  /@media\(min-width:1024px\)\{\s*\.calc-layout\{[\s\S]*?\n  \}/
);
check(
  "desktop (>=1024px) calc-layout block found (the one containing #calculatorSection)",
  !!desktopBlockMatch
);
const desktopBlock = desktopBlockMatch ? desktopBlockMatch[0] : "";

check(
  "#calculatorSection still uses position:sticky (unchanged, still tracks scroll)",
  /#calculatorSection\{[^}]*position:sticky/.test(desktopBlock)
);
check(
  "#calculatorSection still has top:24px (unchanged sticky offset)",
  /#calculatorSection\{[^}]*top:24px/.test(desktopBlock)
);
check(
  "#calculatorSection has a bounded max-height so it can't grow past the viewport",
  /#calculatorSection\{[^}]*max-height:calc\(100vh\s*-\s*48px\)/.test(
    desktopBlock
  )
);
check(
  "#calculatorSection has overflow-y:auto (scrolls independently once content overflows)",
  /#calculatorSection\{[^}]*overflow-y:auto/.test(desktopBlock)
);
check(
  "#calculatorSection does NOT use overflow-y:scroll (auto avoids showing an empty scrollbar when content fits)",
  !/#calculatorSection\{[^}]*overflow-y:scroll/.test(desktopBlock)
);
check(
  "#calculatorSection .card margin-bottom rule still present (unchanged card spacing)",
  /#calculatorSection \.card\{margin-bottom:12px\}/.test(desktopBlock)
);

// Sanity: the <style> block should still be well-formed after this edit
// (guards against an orphaned brace from a careless CSS edit).
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
