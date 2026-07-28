// Dedicated test for the "How this works" info modal (2026-07-28).
//
// Context: the calculator page previously had a multi-step guided tour that
// highlighted each form field in sequence with a positioned tooltip
// (TOUR_STEPS, showTourStep(), positionTourTooltip(), etc.) and auto-launched
// once for first-time visitors via localStorage. Per explicit direction, the
// step-by-step tour was removed entirely and replaced with a single static
// info modal covering the same explanations at once, triggered only by a
// click on the existing "How does this work?" (#tourTrigger) button -- no
// auto-show.
//
// This test checks against the real source files (calculator.html,
// src/ui-helpers.js) directly, not a live browser, so it catches a
// regression before deploy even without a running server.
//
// Run: node tests/how_this_works_modal_test.js

const fs = require("fs");
const path = require("path");

const CALC_HTML = fs.readFileSync(
  path.join(__dirname, "..", "calculator.html"),
  "utf8"
);
const UI_HELPERS = fs.readFileSync(
  path.join(__dirname, "..", "src", "ui-helpers.js"),
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

// ── Old step-by-step tour machinery must be fully gone ─────────────────
check(
  "TOUR_STEPS array no longer defined",
  !/const\s+TOUR_STEPS\s*=/.test(UI_HELPERS)
);
check(
  "showTourStep() no longer defined",
  !/function\s+showTourStep/.test(UI_HELPERS)
);
check(
  "positionTourTooltip() no longer defined",
  !/function\s+positionTourTooltip/.test(UI_HELPERS)
);
check(
  "getTourTargetCard() no longer defined",
  !/function\s+getTourTargetCard/.test(UI_HELPERS)
);
check(
  "waitForScrollEnd() no longer defined",
  !/function\s+waitForScrollEnd/.test(UI_HELPERS)
);
check(
  "tourStepNext() no longer defined",
  !/function\s+tourStepNext/.test(UI_HELPERS)
);
check(
  "tourStepBack() no longer defined",
  !/function\s+tourStepBack/.test(UI_HELPERS)
);
check("skipTour() no longer defined", !/function\s+skipTour/.test(UI_HELPERS));
check(
  "no auto-launch-on-first-visit listener (DOMContentLoaded calling startTour)",
  !/DOMContentLoaded[\s\S]*?setTimeout\(startTour/.test(UI_HELPERS)
);
check(
  "no localStorage read/write tied to tour-seen tracking",
  !/homepilot_tour_seen/.test(UI_HELPERS)
);

// ── New static modal functions must exist and be simple (click-only) ───
check("startTour() is still defined (button hook preserved)", /function\s+startTour/.test(UI_HELPERS));
check("endTour() is still defined (close hook preserved)", /function\s+endTour/.test(UI_HELPERS));
check(
  "startTour() just shows #tourOverlay, no step index reset or localStorage write",
  /function startTour\(\)\{[^}]*getElementById\('tourOverlay'\)[^}]*\}/.test(
    UI_HELPERS.replace(/\s+/g, " ")
  )
);
check(
  "startTour() does not write to localStorage (no auto-show tracking needed for a click-only modal)",
  (() => {
    const m = UI_HELPERS.match(/function startTour\(\)\{[\s\S]*?\n\}/);
    return m ? !/localStorage/.test(m[0]) : false;
  })()
);

// ── HTML: trigger button preserved, old stepper markup gone, new modal present ─
check(
  "#tourTrigger button still present (same entry point, not removed)",
  /id="tourTrigger"/.test(CALC_HTML)
);
check(
  "#tourTrigger still calls startTour() on click",
  /id="tourTrigger"[\s\S]{0,40}onclick="startTour\(\)"/.test(CALC_HTML)
);
check(
  "old #tourTooltip stepper element is gone",
  !/id="tourTooltip"/.test(CALC_HTML)
);
check(
  "old #tourStepNum step-count element is gone",
  !/id="tourStepNum"/.test(CALC_HTML)
);
check("old #tourNext button is gone", !/id="tourNext"/.test(CALC_HTML));
check("old #tourBack button is gone", !/id="tourBack"/.test(CALC_HTML));
check("old #tourSkip button is gone", !/id="tourSkip"/.test(CALC_HTML));
check(
  "#tourOverlay container still present (reused for the new modal)",
  /id="tourOverlay"/.test(CALC_HTML)
);
check(
  "new modal has a close/dismiss control calling endTour()",
  /onclick="endTour\(\)"/.test(CALC_HTML)
);
check(
  "new modal explains household income",
  /household income before taxes/i.test(CALC_HTML)
);
check(
  "new modal explains down payment",
  /down payment[\s\S]{0,120}mortgage insurance/i.test(CALC_HTML)
);
check(
  "new modal explains how-you-work / commute filtering",
  /Hybrid or daily commuters get cities filtered/i.test(CALC_HTML)
);
check(
  "new modal explains household size",
  /space needs for your household/i.test(CALC_HTML)
);

// ── CSS: unused .tour-highlight rule removed, no orphaned brace ────────
check(
  "'.tour-highlight' CSS rule removed (no longer used, nothing highlights cards anymore)",
  !/\.tour-highlight\{/.test(CALC_HTML)
);

// Sanity check the <style> block itself still parses (equal open/close braces)
// -- guards against an orphaned brace left behind by a careless removal.
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
