// Phone fixes (IMPROVEMENT_PLAN.md 2.10, REVIEW_BACKLOG.md "Minor / cleanup").
//
// Checked at 375px, an iPhone-sized screen, in Chrome on 2026-09-24:
//
//   (a) The homepage example ("EXAMPLE · REAL RESULTS FOR ONE SAMPLE BUYER")
//       was hidden on phones: .hero2-example{display:none} below 1024px, and
//       every style for its rows lived inside the desktop block. Phone
//       visitors never saw what results look like. It now shows at every
//       width, in the desktop panel's style.
//
//   (b) The floating WhatsApp button covered content:
//       - its 210px "Questions about your analysis?" note sat over the stats,
//         the form and the result cards until closed; on phones it now steps
//         aside on the first scroll (src/ui-helpers.js);
//       - #waWrap is as wide as that note, so the empty strip beside the
//         round button swallowed taps (a filter chip, the Compare button);
//         only the note and the button take taps now;
//       - it sat on the compare bar's Compare button (both z-index 9999);
//         while the bar is up it moves above it (src/compare.js);
//       - its note covered the "How this works" modal's "Got it" button
//         (modal z-index 9500, below it); the modal is above it now;
//       - it sat over the bottom of the footer at the end of both pages;
//         the footer now scrolls clear of it.
//
// jsdom does no layout and ignores @media rules in getComputedStyle, so this
// test works out which rules apply at a given screen width itself
// (styleAt() below) and reads the positions from the pages' own CSS and
// markup.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).
// Run: node --no-warnings tests/phone_fixes_test.js

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const BASE = "http://localhost:8843/";
const PHONE = 375, DESKTOP = 1280;
// The compare bar is 66px tall at 375px (14px padding top and bottom, a
// two-line label), measured in Chrome 2026-09-24.
const COMPARE_BAR_PX = 66;

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail !== undefined ? " :: " + detail : "")); }
}

// ---------- which CSS applies at a given width ----------
// Only width media queries are evaluated; print, hover and anything else
// count as not matching.
function mediaMatches(text, width) {
  const t = String(text).toLowerCase().replace(/\s+/g, "");
  if (!t || t === "all" || t === "screen") return true;
  const parts = t.split(/and/).filter((p) => p && p !== "screen" && p !== "all");
  return parts.every((p) => {
    const m = /^\((min|max)-width:(\d+(?:\.\d+)?)px\)$/.exec(p);
    if (!m) return false;
    return m[1] === "min" ? width >= Number(m[2]) : width <= Number(m[2]);
  });
}
function rulesAt(doc, width) {
  const out = [];
  const walk = (list) => {
    for (const r of list) {
      if (r.selectorText !== undefined && r.style) out.push(r);
      else if (r.media && r.cssRules) { if (mediaMatches(r.media.mediaText, width)) walk(r.cssRules); }
    }
  };
  for (const s of doc.styleSheets) walk(s.cssRules);
  return out;
}
function specificity(sel) {
  const s = sel.replace(/::?[a-z-]+\([^)]*\)/gi, (m) => (m.startsWith("::") ? " ::x " : " .x "));
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const tags = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, " ").match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length
    + (s.match(/::[\w-]+/g) || []).length;
  return ids * 10000 + cls * 100 + tags;
}
// The value a rule's own declarations give a longhand, looking at the
// shorthand too (jsdom does not expand padding/margin in stylesheet rules).
function declared(style, prop) {
  let value = "", important = false;
  const side = /^(padding|margin)-(top|right|bottom|left)$/.exec(prop);
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    if (name === prop) { value = style.getPropertyValue(name); important = style.getPropertyPriority(name) === "important"; }
    else if (side && name === side[1]) {
      const v = style.getPropertyValue(name).trim().split(/\s+/);
      const at = { top: 0, right: 1, bottom: 2, left: 3 }[side[2]];
      const fill = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
      value = fill[at]; important = style.getPropertyPriority(name) === "important";
    }
  }
  return value ? { value, important } : null;
}
// The cascaded value of `prop` on `el` at `width` (stylesheets + inline).
function styleAt(el, prop, width) {
  let best = null;
  const consider = (value, important, spec, order) => {
    const key = [important ? 1 : 0, spec, order];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] >= best.key[2])))) {
      best = { value, key };
    }
  };
  rulesAt(el.ownerDocument, width).forEach((r, order) => {
    let spec = -1;
    for (const part of r.selectorText.split(",")) {
      try { if (el.matches(part.trim())) spec = Math.max(spec, specificity(part.trim())); } catch (e) { /* selector jsdom cannot match */ }
    }
    if (spec < 0) return;
    const d = declared(r.style, prop);
    if (d) consider(d.value.trim(), d.important, spec, order);
  });
  const inline = el.style.getPropertyValue(prop);
  if (inline) consider(inline.trim(), el.style.getPropertyPriority(prop) === "important", 1e9, 1e9);
  return best ? best.value : "";
}
function px(v) {
  const m = /^(-?\d+(?:\.\d+)?)(px|rem)?$/.exec(String(v).trim());
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "rem" ? 16 : 1);
}
function shownAt(el, width) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (styleAt(e, "display", width) === "none" || e.hidden) return false;
  }
  return true;
}
// The room below the page's footer at `width`: its margin, plus the bottom
// padding and margin of every ancestor it is the last shown block of.
function roomBelowFooter(doc, width) {
  const footer = doc.querySelector("footer.mainFooter");
  let room = px(styleAt(footer, "margin-bottom", width) || "0");
  for (let e = footer; e.parentElement && e !== doc.body; e = e.parentElement) {
    const later = [...e.parentElement.children].slice([...e.parentElement.children].indexOf(e) + 1)
      .filter((s) => !/^(SCRIPT|STYLE|LINK)$/.test(s.tagName) && shownAt(s, width) && styleAt(s, "position", width) !== "fixed");
    if (later.length) return { room, note: "the footer is not the last thing on the page" };
    const p = e.parentElement;
    room += px(styleAt(p, "padding-bottom", width) || "0") + px(styleAt(p, "margin-bottom", width) || "0");
  }
  return { room };
}

function staticDoc(file) {
  return new JSDOM(fs.readFileSync(path.join(ROOT, file), "utf8")).window.document;
}

async function openPage(file, width) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL(BASE + file, {
    runScripts: "dangerously", resources: "usable", virtualConsole, pretendToBeVisual: true,
    beforeParse(win) {
      // jsdom has no matchMedia; answer width queries for the given screen.
      win.matchMedia = (q) => ({ matches: mediaMatches(q, width), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    },
  });
  await new Promise((r) => setTimeout(r, 1000));
  dom.window.Element.prototype.scrollIntoView = function () {};
  return { win: dom.window, errors };
}

(async () => {
  const index = staticDoc("index.html");
  const calc = staticDoc("calculator.html");

  // =============== (a) the homepage example on phones ===============
  console.log("\n(a) the homepage example shows on phones");
  const ex = index.querySelector(".hero2-example");
  check("the example panel is on the homepage", !!ex);
  check("at 375px the example panel is shown (it was display:none below 1024px)", shownAt(ex, PHONE), styleAt(ex, "display", PHONE));
  check("...and at 700px, a small tablet", shownAt(ex, 700));
  check("...and still at 1280px", shownAt(ex, DESKTOP));
  check("at 375px the panel has its desktop frame (border, 20px padding)",
    /1px solid/.test(styleAt(ex, "border", PHONE)) && styleAt(ex, "padding", PHONE) === "20px",
    styleAt(ex, "border", PHONE) + " / " + styleAt(ex, "padding", PHONE));
  check("at 1280px it sits beside the headline with no gap above (desktop look unchanged)",
    px(styleAt(ex, "margin-top", DESKTOP)) === 0 && styleAt(index.querySelector(".hero2-grid"), "display", DESKTOP) === "grid");

  // The rows are drawn by src/homepage-example.js; their styles used to live
  // only in the desktop block, so a shown panel would still have been broken.
  const hp = await openPage("index.html", PHONE);
  const rows = [...hp.win.document.querySelectorAll("#heroExampleList .lb-row")];
  check("on a phone-sized page the example has its 4 engine rows", rows.length === 4, rows.length);
  if (rows.length) {
    const r = rows[0];
    const styled = [
      [r, "display", "flex"],
      [r.querySelector(".lb-rank"), "border-radius", "50%"],
      [r.querySelector(".lb-top"), "justify-content", "space-between"],
      [r.querySelector(".lb-badge"), "white-space", "nowrap"],
      [r.querySelector(".lb-bar"), "height", "5px"],
    ];
    const bad = styled.filter(([el, p, v]) => !el || styleAt(el, p, PHONE) !== v).map(([el, p, v]) => (el ? el.className : "?") + " " + p + " should be " + v);
    check("at 375px each row is styled as on the desktop (rank circle, badge, bar), not bare text", bad.length === 0, bad.join("; "));
  }

  // =============== (b) the WhatsApp button covers nothing ===============
  console.log("\n(b) the WhatsApp button stops covering content");
  for (const [name, doc] of [["homepage", index], ["calculator", calc]]) {
    const wa = doc.getElementById("waWrap");
    const btn = wa && wa.querySelector("a");
    const footprint = px(wa.style.bottom) + px(btn.style.height); // 20px up + 56px tall
    check(`${name}: the WhatsApp button's footprint is read from the page (${footprint}px from the bottom)`, footprint > 0 && footprint < 200, footprint);

    const phone = roomBelowFooter(doc, PHONE);
    check(`${name}: at 375px the footer ends at least 16px above the WhatsApp button at the bottom of the page`,
      !phone.note && phone.room >= footprint + 16, phone.note || phone.room + "px of room, button reaches " + footprint + "px");

    check(`${name}: the empty strip beside the round button takes no taps (#waWrap pointer-events:none)`,
      styleAt(wa, "pointer-events", PHONE) === "none" && styleAt(wa, "pointer-events", DESKTOP) === "none");
    check(`${name}: the note and the button themselves still take taps`,
      [...wa.children].every((c) => styleAt(c, "pointer-events", PHONE) === "auto"));

    // Every full-screen pop-up covers the WhatsApp button while it is open.
    const waZ = Number(styleAt(wa, "z-index", PHONE));
    const overlays = [...doc.querySelectorAll("body > div[id]")].filter((e) => e.style.position === "fixed" && /inset:\s*0/.test(e.getAttribute("style") || ""));
    const under = overlays.filter((e) => !(Number(e.style.zIndex) > waZ)).map((e) => "#" + e.id + " z=" + e.style.zIndex);
    check(`${name}: every full-screen pop-up (${overlays.map((e) => "#" + e.id).join(", ") || "none"}) sits above the WhatsApp button`, under.length === 0, under.join(", "));
  }
  check("calculator: the \"How this works\" pop-up is one of them (its \"Got it\" button was under the note)",
    !!calc.getElementById("tourOverlay") && Number(calc.getElementById("tourOverlay").style.zIndex) > Number(calc.getElementById("waWrap").style.zIndex));

  // The note steps aside on the first scroll on phones, and only on phones.
  const tipPhone = hp.win.document.getElementById("waTooltip");
  check("homepage at 375px: the WhatsApp note shows on arrival", tipPhone && tipPhone.style.display !== "none");
  hp.win.dispatchEvent(new hp.win.Event("scroll"));
  check("homepage at 375px: the note steps aside once the page scrolls", tipPhone.style.display === "none", tipPhone.style.display);
  check("homepage at 375px: the green WhatsApp button itself stays", hp.win.document.querySelector("#waWrap a").style.display !== "none");
  hp.win.close();

  const hd = await openPage("index.html", DESKTOP);
  hd.win.dispatchEvent(new hd.win.Event("scroll"));
  check("homepage at 1280px: the note stays after a scroll (computers unchanged)", hd.win.document.getElementById("waTooltip").style.display !== "none");
  hd.win.close();

  // The compare bar: the WhatsApp button moves above it while it is up.
  const cp = await openPage("calculator.html", PHONE);
  const w = cp.win, d = w.document;
  d.getElementById("inc").value = "90000";
  d.getElementById("inc2").value = "60000";
  d.getElementById("dwn").value = "100000";
  d.getElementById("dbt").value = "0";
  d.getElementById("fam").value = "3";
  d.getElementById("area").value = "all";
  w.eval("setFTB(true)");
  // Citizen or PR: the citizenship box left unticked (2.3a E).
  const nrBox = d.getElementById("nonResident");
  nrBox.checked = false;
  nrBox.dispatchEvent(new w.Event("change"));
  w.eval("setWorkArrangement('hybrid')");
  d.getElementById("workCity").value = "Toronto";
  w.eval("go()");
  await new Promise((r) => setTimeout(r, 300));
  // The first cards are the three answer cards (2026-09-24, IMPROVEMENT_PLAN.md
  // 2.2). A place can have two of them, so each card is ticked by its own id.
  const cards = [...d.querySelectorAll("#answers .city")].slice(0, 2);
  const cities = cards.map((c) => c.id);
  check("calculator: a search gives at least two cards to compare", cities.length === 2, cities.length);
  const wa = d.getElementById("waWrap");
  const tick = (cardId, on) => {
    const cb = d.getElementById("cmp-chk-" + cardId);
    cb.checked = on;
    w.toggleCmpCity(d.getElementById(cardId).querySelector(".cn").textContent.trim(), cb);
  };
  check("calculator: before any ticks the WhatsApp button is 20px up", styleAt(wa, "bottom", PHONE) === "20px", styleAt(wa, "bottom", PHONE));
  tick(cities[0], true);
  check("calculator: one tick, no compare bar, the button stays put", d.getElementById("cmpSticky").style.display === "none" && styleAt(wa, "bottom", PHONE) === "20px");
  tick(cities[1], true);
  const lifted = px(styleAt(wa, "bottom", PHONE));
  check("calculator: two ticks bring up the compare bar", d.getElementById("cmpSticky").style.display === "flex");
  check(`calculator: ...and the WhatsApp button moves above the ${COMPARE_BAR_PX}px bar, off its Compare button`,
    lifted >= COMPARE_BAR_PX + 8, lifted + "px");
  check("calculator: ...on computers too (the bar and the button share the corner at every width)", px(styleAt(wa, "bottom", DESKTOP)) >= COMPARE_BAR_PX + 8);
  tick(cities[1], false);
  check("calculator: unticking one closes the bar and the button goes back down", d.getElementById("cmpSticky").style.display === "none" && styleAt(wa, "bottom", PHONE) === "20px");
  tick(cities[1], true);
  w.eval("go()");
  check("calculator: a new search closes the bar and puts the button back", !d.body.classList.contains("cmp-bar-open") && styleAt(wa, "bottom", PHONE) === "20px"
    && d.getElementById("cmpSticky").style.display === "none");
  check("calculator: no script errors in the page", cp.errors.length === 0, cp.errors.slice(0, 3).join(" | "));
  w.close();

  // On a computer the note sat over the third answer card, three across (its
  // label and true monthly cost), so it steps aside once there are results;
  // the green button stays. A buyer whose three answers are three homes
  // (2026-09-24: at the new rate and prices, $90K + $60K with $100K down gets
  // two cards, one of them answering two questions).
  const cd = await openPage("calculator.html", DESKTOP);
  const dw = cd.win, dd = dw.document;
  check("calculator at 1280px: the WhatsApp note shows before a search", dd.getElementById("waTooltip").style.display !== "none");
  dd.getElementById("inc").value = "120000";
  dd.getElementById("inc2").value = "60000";
  dd.getElementById("dwn").value = "200000";
  dd.getElementById("dbt").value = "0";
  dw.eval("setFTB(true)");
  dw.eval("setWorkArrangement('hybrid')");
  dd.getElementById("workCity").value = "Toronto";
  dw.eval("go()");
  check("calculator at 1280px: after a search the note steps aside and the green button stays",
    dd.querySelectorAll("#answers .city").length === 3 && dd.getElementById("waTooltip").style.display === "none" && dd.querySelector("#waWrap a").style.display !== "none");
  check("calculator at 1280px: no script errors", cd.errors.length === 0, cd.errors.slice(0, 3).join(" | "));
  dw.close();

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
