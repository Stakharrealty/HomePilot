// openListingsWindow()'s desktop popup size used to be a fixed
// "width=1040,height=840" regardless of the user's actual screen -- looked
// fine on a small laptop but left a lot of unused space (and only fit 2
// grid columns instead of 3) on a large monitor. This tests the fix: the
// popup now scales with window.screen.availWidth/availHeight (90% of
// screen, capped at 1500x1000, floored at the original 1040x840),
// centered on screen.
//
// tests/listings_popup_redesign_test.js deliberately does static/regex
// checks only ("no jsdom window.open support worth relying on") -- this
// test instead loads the real index.html via jsdom and calls the real
// openListingsWindow() with window.open and window.screen stubbed, so it
// actually exercises the sizing math rather than pattern-matching source
// text.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).

const { JSDOM, VirtualConsole } = require("jsdom");

const url = "http://localhost:8843/index.html";

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  PASS - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`); }
}

function parseDims(str) {
  const out = {};
  for (const part of str.split(",")) {
    const [k, v] = part.split("=");
    if (v !== undefined) out[k] = Number(v);
  }
  return out;
}

(async () => {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));

  const dom = await JSDOM.fromURL(url, { runScripts: "dangerously", resources: "usable", virtualConsole, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const win = dom.window;

  win.matchMedia = () => ({ matches: true }); // force the desktop branch
  win.saveBuyerProfile = undefined; // not under test here

  const cases = [
    { label: "small laptop 1366x768", w: 1366, h: 768, expectW: 1229, expectH: 840 },
    { label: "common desktop 1920x1080", w: 1920, h: 1080, expectW: 1500, expectH: 972 },
    { label: "27in 2560x1440", w: 2560, h: 1440, expectW: 1500, expectH: 1000 },
    { label: "ultrawide 3440x1440", w: 3440, h: 1440, expectW: 1500, expectH: 1000 },
    { label: "small/unknown 1024x768 (at the original floor)", w: 1024, h: 768, expectW: 1040, expectH: 840 },
  ];

  for (const c of cases) {
    win.screen = { availWidth: c.w, availHeight: c.h };
    let capturedDims = null;
    win.open = (u, target, dims) => { capturedDims = dims; return { focus() {} }; };
    win.openListingsWindow("Guelph", "all", 700000);
    const d = capturedDims ? parseDims(capturedDims) : null;
    check(`(${c.label}) popup width scales correctly`, !!d && d.width === c.expectW, JSON.stringify(d));
    check(`(${c.label}) popup height scales correctly`, !!d && d.height === c.expectH, JSON.stringify(d));
    check(`(${c.label}) popup is centered on screen`, !!d &&
      d.left === Math.max(0, Math.round((c.w - c.expectW) / 2)) && d.top === Math.max(0, Math.round((c.h - c.expectH) / 2)), JSON.stringify(d));
  }

  // Never smaller than the original floor even on a tiny/zero screen size
  // (e.g. availWidth not yet populated) -- must not throw or go negative.
  win.screen = { availWidth: 0, availHeight: 0 };
  let floorDims = null;
  win.open = (u, target, dims) => { floorDims = dims; return { focus() {} }; };
  win.openListingsWindow("Guelph", "all", 700000);
  const fd = floorDims ? parseDims(floorDims) : null;
  check("(floor) a zero/unknown screen size still floors at 1040x840, no crash, no negative position",
    !!fd && fd.width === 1040 && fd.height === 840 && fd.left >= 0 && fd.top >= 0, JSON.stringify(fd));

  check("no uncaught DOM/script errors occurred during any of this",
    errors.filter((m) => !m.includes("fonts.googleapis.com")).length === 0, errors.join(" | "));

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
