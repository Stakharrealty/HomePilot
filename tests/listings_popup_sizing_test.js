// openListingsWindow()'s desktop popup used to request a size via
// window.open()'s width/height/left/top features -- first a fixed
// 1040x840, then scaled to the screen. But those features only size the
// new window's CONTENT AREA, not the outer window: requesting
// window.screen.availWidth/availHeight there still leaves a gap the size
// of the browser's own chrome (title bar, tab strip, address bar), so the
// window could never actually reach a true full-screen/maximized look no
// matter what was requested that way.
//
// The actual fix: resizeTo()/moveTo(), called on the window reference
// right after opening it, set the OUTER window's size and position
// directly. This tests that: the popup opens at a small default size,
// then gets moveTo(0, 0) and resizeTo(availWidth, availHeight), with a
// 1040x840 floor and no crash if the browser refuses the resize (some
// browsers block resizeTo/moveTo on certain window configurations).
//
// tests/listings_popup_redesign_test.js deliberately does static/regex
// checks only ("no jsdom window.open support worth relying on") -- this
// test instead loads the real index.html via jsdom and calls the real
// openListingsWindow() with window.open/window.screen and a fake popup
// object stubbed, so it actually exercises the resize/move calls rather
// than pattern-matching source text.
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

function fakePopup(calls) {
  return {
    focus() { calls.push(["focus"]); },
    moveTo(x, y) { calls.push(["moveTo", x, y]); },
    resizeTo(w, h) { calls.push(["resizeTo", w, h]); },
  };
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
    { label: "small laptop 1366x768", w: 1366, h: 768, expectW: 1366, expectH: 840 },
    { label: "common desktop 1920x1080", w: 1920, h: 1080, expectW: 1920, expectH: 1080 },
    { label: "27in 2560x1440", w: 2560, h: 1440, expectW: 2560, expectH: 1440 },
    { label: "ultrawide 3440x1440", w: 3440, h: 1440, expectW: 3440, expectH: 1440 },
    { label: "small/unknown 1024x768 (at the original floor)", w: 1024, h: 768, expectW: 1040, expectH: 840 },
  ];

  for (const c of cases) {
    win.screen = { availWidth: c.w, availHeight: c.h };
    const calls = [];
    win.open = () => fakePopup(calls);
    win.openListingsWindow("Guelph", "all", 700000);
    const resize = calls.find((x) => x[0] === "resizeTo");
    const move = calls.find((x) => x[0] === "moveTo");
    check(`(${c.label}) resizeTo() called with the full available screen size (floored at 1040x840)`,
      !!resize && resize[1] === c.expectW && resize[2] === c.expectH, JSON.stringify(calls));
    check(`(${c.label}) moveTo(0, 0) called to anchor the window at the screen's top-left`,
      !!move && move[1] === 0 && move[2] === 0, JSON.stringify(calls));
    check(`(${c.label}) moveTo happens before resizeTo (order matters for a clean top-left fill)`,
      !!move && !!resize && calls.indexOf(move) < calls.indexOf(resize), JSON.stringify(calls));
    check(`(${c.label}) focus() is still called after resizing`, calls.some((x) => x[0] === "focus"), JSON.stringify(calls));
  }

  // Never smaller than the original floor even on a tiny/zero screen size
  // (e.g. availWidth not yet populated) -- must not throw or go negative.
  {
    win.screen = { availWidth: 0, availHeight: 0 };
    const calls = [];
    win.open = () => fakePopup(calls);
    win.openListingsWindow("Guelph", "all", 700000);
    const r = calls.find((x) => x[0] === "resizeTo");
    check("(floor) a zero/unknown screen size still floors at 1040x840, no crash", !!r && r[1] === 1040 && r[2] === 840, JSON.stringify(calls));
  }

  // The window is still opened at a small default size via window.open
  // itself (the outer size is set afterward by resizeTo, not by features).
  {
    win.screen = { availWidth: 1920, availHeight: 1080 };
    let feats = null;
    win.open = (u, t, f) => { feats = f; return fakePopup([]); };
    win.openListingsWindow("Guelph", "all", 700000);
    check("(open) window.open is called with a small default size, not the screen size",
      typeof feats === "string" && /width=1040/.test(feats) && /height=840/.test(feats) && !/width=1920/.test(feats), String(feats));
  }

  // If the browser refuses resizeTo/moveTo (some do, for certain window
  // configurations), the popup must still end up focused rather than the
  // whole function silently aborting.
  {
    const calls = [];
    win.screen = { availWidth: 1920, availHeight: 1080 };
    win.open = () => ({
      moveTo() { throw new Error("SecurityError: blocked"); },
      resizeTo() { calls.push("resizeTo-unreachable"); },
      focus() { calls.push("focus"); },
    });
    win.openListingsWindow("Guelph", "all", 700000);
    check("(resilience) a browser blocking moveTo/resizeTo doesn't stop the popup from being focused",
      calls.includes("focus"), calls.join(","));
  }

  check("no uncaught DOM/script errors occurred during any of this",
    errors.filter((m) => !m.includes("fonts.googleapis.com")).length === 0, errors.join(" | "));

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
