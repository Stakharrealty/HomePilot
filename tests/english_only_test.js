// English only: no language menu and no translated text on any page.
// IMPROVEMENT_PLAN.md 2.4b, decided by the user 2026-09-23.
//
// Until 2026-09-23 the homepage and the calculator had a language menu with
// machine translations in French, Mandarin, Punjabi, Hindi, Urdu and Spanish
// (T in src/i18n.js, HPT in src/i18n-homepage.js, setLang() in
// src/ui-helpers.js). The user removed them: AI translation could not be made
// to read naturally, and parts of the site were never translated. This test
// keeps the menu and the translations from coming back by accident: section 1
// reads every page and script, section 2 loads the homepage and the calculator
// and runs a real search, so the English the scripts write into the page (fit
// labels, card wording, the button) is checked too, not just the markup.
//
// The old menu never saved the choice (no localStorage, no URL parameter), so
// no returning visitor has a stored language, and nothing on the site reads
// one. This test no longer plants one: with no code to read it, that check
// could not fail.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).
// Run: node --no-warnings tests/english_only_test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const BASE = "http://localhost:8843/";

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail !== undefined ? " :: " + detail : "")); }
}

// Every page a buyer can reach, and every script they load.
const PAGES = ["index.html", "calculator.html", "listings.html", "listing.html", "disclaimer.html", "privacy-policy.html", "terms-of-use.html"];
const SCRIPTS = fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".js")).map((f) => "src/" + f);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Arabic/Urdu, Devanagari (Hindi), Gurmukhi (Punjabi), CJK (Mandarin), plus
// the menu's own names for French and Spanish.
const NON_ENGLISH = /[؀-ۿऀ-ॿ਀-੿　-〿一-鿿＀-￯]|Français|Español/;
const firstMatch = (text) => { const m = NON_ENGLISH.exec(text); return m ? JSON.stringify(text.slice(Math.max(0, m.index - 30), m.index + 30)) : ""; };

(async () => {
  // =============== 1. the files ===============
  check("the homepage translations file (src/i18n-homepage.js) is gone", !fs.existsSync(path.join(ROOT, "src", "i18n-homepage.js")));

  const tctx = {};
  vm.runInNewContext(read("src/i18n.js") + ";this.T=T;", tctx);
  check("T (src/i18n.js) holds English only", JSON.stringify(Object.keys(tctx.T)) === '["en"]', Object.keys(tctx.T).join(","));

  for (const page of PAGES) {
    const html = read(page);
    check(`${page}: declares <html lang="en">`, /<html lang="en">/.test(html));
    check(`${page}: no language menu, setLang() call or homepage translations`,
      !/lang-sel|setLang|i18n-homepage|🌐/.test(html));
    check(`${page}: no right-to-left switch`, !/dir="rtl"|direction\s*:\s*rtl/i.test(html));
    check(`${page}: no text in another language`, !NON_ENGLISH.test(html), firstMatch(html));
  }
  // Code, not comments: a definition, a call with an argument, a use of HPT,
  // or an "rtl" value. ui-helpers.js keeps a comment saying setLang() went.
  const scriptHits = SCRIPTS.filter((f) => /function\s+setLang\b|\bsetLang\s*\(\s*[^)\s]|\bHPT\s*[=\[.]|["']rtl["']/.test(read(f)));
  check("no script defines or calls setLang(), HPT or right-to-left", scriptHits.length === 0, scriptHits.join(", "));
  const foreignScripts = SCRIPTS.filter((f) => NON_ENGLISH.test(read(f)));
  check("no script carries text in another language", foreignScripts.length === 0, foreignScripts.map((f) => f + " " + firstMatch(read(f))).join(" | "));

  // =============== 2. the pages as a buyer sees them ===============
  async function open(page) {
    const virtualConsole = new VirtualConsole();
    const errors = [];
    virtualConsole.on("jsdomError", (e) => {
      // Same exclusion as browser_load_verification.js: a blocked Google
      // Fonts request is a sandbox network artifact, not a page bug.
      if (!/fonts\.googleapis\.com/.test(e.message)) errors.push(e.message);
    });
    const dom = await JSDOM.fromURL(BASE + page, {
      runScripts: "dangerously", resources: "usable", virtualConsole, pretendToBeVisual: true,
    });
    await new Promise((r) => setTimeout(r, 1200));
    dom.window.Element.prototype.scrollIntoView = function () {};
    return { win: dom.window, errors };
  }
  const noMenu = (win) => !win.document.querySelector(".lang-sel")
    && ![...win.document.querySelectorAll("select option")].some((o) => ["fr", "zh", "pa", "hi", "ur", "es"].includes(o.value));

  let home;
  try { home = await open("index.html"); }
  catch (e) { console.log("FATAL: could not load index.html -- is the static server running on 8843?\n" + e); process.exit(1); }
  const hd = home.win.document;
  check("homepage: the English page renders", /actually afford/.test((hd.getElementById("heroHeading") || {}).textContent || "")
    && /How It Works/.test((hd.getElementById("navHow") || {}).textContent || ""));
  check("homepage: no language menu", noMenu(home.win));
  check("homepage: setLang() and HPT no longer exist", home.win.eval("typeof setLang") === "undefined" && home.win.eval("typeof HPT") === "undefined");
  check("homepage: the example panel still shows its 4 engine rows", hd.querySelectorAll("#heroExampleList .lb-row").length === 4);
  check("homepage: nothing on the page is in another language", !NON_ENGLISH.test(hd.body.textContent), firstMatch(hd.body.textContent));
  check("homepage: no script errors", home.errors.length === 0, home.errors.join(" | "));

  const calc = await open("calculator.html");
  const cd = calc.win.document;
  check("calculator: no language menu", noMenu(calc.win));
  check("calculator: the form reads in English", /Show Me What I Can Afford/.test((cd.getElementById("bt") || {}).textContent || "")
    && /Partner's income/.test((cd.getElementById("l1b") || {}).textContent || ""));
  check("calculator: setLang() no longer exists", calc.win.eval("typeof setLang") === "undefined");
  // A real search, so the strings the scripts write (fit labels, card wording,
  // the button) are checked too, not just the markup.
  cd.getElementById("inc").value = "130000";
  cd.getElementById("dwn").value = "70000";
  cd.getElementById("dbt").value = "450";
  // Citizen or PR: the citizenship box left unticked (2.3a E).
  const nrBox = cd.getElementById("nonResident");
  nrBox.checked = false;
  nrBox.dispatchEvent(new calc.win.Event("change"));
  calc.win.eval("setFTB(true); setWorkArrangement('remote'); go()");
  // The answer cards, then "See all places" opened (2026-09-24, IMPROVEMENT_PLAN.md 2.2).
  calc.win.eval("toggleSeeAll()");
  const cards = [...cd.querySelectorAll("#answers .city, #list .city")];
  const fits = cards.map((c) => (c.querySelector(".fit-pill") || {}).textContent || "").map((s) => s.trim());
  check("calculator: a search shows ranked places", cards.length > 0, cards.length);
  check("calculator: every card's fit label is English", fits.length > 0 && fits.every((f) => ["Great fit", "Good Fit", "Stretch"].includes(f)), fits.join(", "));
  check("calculator: the button reads in English after the search", /Show Me What I Can Afford/.test((cd.getElementById("bt") || {}).textContent || ""));
  check("calculator: nothing on the results page is in another language", !NON_ENGLISH.test(cd.body.textContent), firstMatch(cd.body.textContent));
  check("calculator: no script errors", calc.errors.length === 0, calc.errors.join(" | "));

  console.log("=== RESULT: " + passed + " passed, " + failed + " failed ===");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
