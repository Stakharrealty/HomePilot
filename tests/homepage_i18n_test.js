// homepage_i18n_test.js — verifies index.html's language switcher translates
// the WHOLE homepage, not just the couple of shared calculator IDs it used
// to accidentally touch.
//
// Regression this guards against: before src/i18n-homepage.js existed,
// setLang() on index.html only updated elements matching calculator.html's
// textIds list. Nearly everything on the marketing homepage (hero, How It
// Works, comparison table, FAQ, footer) stayed in English regardless of the
// selected language -- and the one homepage element that DID share an id
// ("hs") got silently overwritten with the CALCULATOR's hero-subtitle text
// in the new language, not the homepage's own copy.
//
// Requires a static server at localhost:8843 serving the repo root, same as
// tests/browser_load_verification.js and tests/smoke_test.js.

const { JSDOM, VirtualConsole } = require("jsdom");

const url = "http://localhost:8843/index.html";
const LANGS = ["en", "fr", "zh", "pa", "hi", "ur", "es"];

// A representative sample across every translated section -- not every one
// of the ~80 keys, but enough to catch a broken wiring in any section.
const SAMPLE_IDS = [
  "navHow", "hdrCtaText",
  "heroHeading", "heroSub", "heroB1", "heroNote",
  "statLbl1", "statLbl4",
  "hiwHeading", "hiw1Title", "hiw4Desc",
  "wdHeading", "wdR3Yes",
  "faqHeading", "faqQ1", "faqA2",
  "fctaHeading", "fctaBtnText",
  "ftBrandDesc", "ftLinkDisclaimer"
];

let failures = 0;
function t(name, cond) {
  if (cond) {
    console.log("  PASS  " + name);
  } else {
    console.log("  FAIL  " + name);
    failures++;
  }
}

(async () => {
  const virtualConsole = new VirtualConsole();
  const jsErrors = [];
  virtualConsole.on("jsdomError", (e) => {
    // The sandbox this suite sometimes runs in blocks the external Google
    // Fonts request; that's a network policy artifact, not a page bug, and
    // is excluded the same way tests/browser_load_verification.js expects.
    if (!/fonts\.googleapis\.com/.test(e.message)) jsErrors.push(e.message);
  });

  let dom;
  try {
    dom = await JSDOM.fromURL(url, {
      runScripts: "dangerously",
      resources: "usable",
      virtualConsole,
      pretendToBeVisual: true,
    });
  } catch (e) {
    console.log("FATAL: could not load " + url + " -- is the static server running on 8843?");
    console.log(String(e));
    process.exit(1);
  }

  await new Promise((res) => setTimeout(res, 1500));
  const win = dom.window;
  const doc = win.document;

  console.log("Homepage i18n tests");

  t("setLang is defined", win.eval("typeof setLang") === "function");
  t("HPT (homepage translations) is loaded", win.eval("typeof HPT") === "object");

  // Capture English baseline text for every sampled ID up front.
  win.eval('setLang("en")');
  const baseline = {};
  SAMPLE_IDS.forEach((id) => {
    const el = doc.getElementById(id);
    baseline[id] = el ? el.textContent.trim() : null;
  });
  const missingInBaseline = SAMPLE_IDS.filter((id) => baseline[id] === null);
  t("every sampled ID exists in the DOM", missingInBaseline.length === 0);
  if (missingInBaseline.length) console.log("    missing:", missingInBaseline);

  // Every non-English language must change every sampled element's text
  // relative to the English baseline -- if even one stays identical, that
  // element isn't wired into HPT/setLang and would silently stay in English
  // for real users switching languages.
  LANGS.filter((l) => l !== "en").forEach((lang) => {
    win.eval(`setLang("${lang}")`);
    const untranslated = SAMPLE_IDS.filter((id) => {
      const el = doc.getElementById(id);
      if (!el) return false; // already reported above
      return el.textContent.trim() === baseline[id];
    });
    t(`${lang}: every sampled element differs from the English baseline`, untranslated.length === 0);
    if (untranslated.length) console.log(`    still English in ${lang}:`, untranslated);
  });

  // RTL: Urdu should flip document direction; every other language should
  // leave it LTR.
  win.eval('setLang("ur")');
  t("ur sets RTL direction", doc.querySelector(".w").style.direction === "rtl");
  win.eval('setLang("fr")');
  t("fr sets LTR direction", doc.querySelector(".w").style.direction === "ltr");

  // Round-trip: switching back to English must restore the exact original
  // English copy (no leftover fragments from another language, no drift).
  win.eval('setLang("en")');
  const roundTripMismatches = SAMPLE_IDS.filter((id) => {
    const el = doc.getElementById(id);
    return el && el.textContent.trim() !== baseline[id];
  });
  t("switching back to English restores the exact original text", roundTripMismatches.length === 0);
  if (roundTripMismatches.length) console.log("    mismatched on round-trip:", roundTripMismatches);

  // heroHeading specifically needs innerHTML (it carries an inline accent
  // span) -- confirm the span survives translation rather than getting
  // stripped to plain text.
  win.eval('setLang("fr")');
  t("heroHeading keeps its <span class=\"accent\"> after translation",
    /class="accent"/.test(doc.getElementById("heroHeading").innerHTML));

  // The calculator.html page must NOT load HPT, and its own setLang() must
  // keep working unaffected by this change.
  let calcDom;
  try {
    calcDom = await JSDOM.fromURL("http://localhost:8843/calculator.html", {
      runScripts: "dangerously",
      resources: "usable",
      virtualConsole,
      pretendToBeVisual: true,
    });
  } catch (e) {
    console.log("FATAL: could not load calculator.html -- is the static server running on 8843?");
    console.log(String(e));
    process.exit(1);
  }
  await new Promise((res) => setTimeout(res, 1500));
  const cwin = calcDom.window, cdoc = calcDom.window.document;
  t("calculator.html does not load HPT", cwin.eval("typeof HPT") === "undefined");
  cwin.eval('setLang("fr")');
  const calcBt = cdoc.getElementById("bt");
  t("calculator.html's own setLang() still translates its bt element",
    !!calcBt && calcBt.textContent.trim() === "Montrez-moi ce que je peux me permettre");

  t("no unexpected JS/DOM errors on index.html", jsErrors.length === 0);
  if (jsErrors.length) console.log("    errors:", jsErrors);

  console.log(failures === 0 ? "\nAll homepage i18n tests passed." : `\n${failures} homepage i18n test(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})();
