// Phase 3 - module load verification using a real DOM (jsdom), executing
// scripts via jsdom's runScripts:"dangerously" which actually fetches and
// runs each <script src> in true document order, just like a browser would.
const { JSDOM, VirtualConsole } = require("jsdom");

const url = "http://localhost:8843/index.html";
const errors = [];

(async () => {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  virtualConsole.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));

  const dom = await JSDOM.fromURL(url, {
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole,
    pretendToBeVisual: true,
  });

  // give async script loads / DOMContentLoaded handlers time to run
  await new Promise((res) => setTimeout(res, 1500));

  const win = dom.window;

  const requiredGlobals = [
    "M", "T", "RF", "go", "render", "calcBP", "calcCosts",
    "getFit", "setLang", "toggle", "RANKING_WEIGHTS", "DEFAULT_MORTGAGE_RATE_PCT",
  ];
  // Use the page's own script-scope eval (not window[g]) since top-level
  // let/const bindings don't attach to window even in a real browser.
  const missing = requiredGlobals.filter((g) => {
    try {
      const v = dom.window.eval(`typeof ${g}`);
      return v === "undefined";
    } catch (e) {
      return true;
    }
  });

  console.log("=== Phase 3: real-DOM module load verification ===");
  console.log("Page title:", dom.window.document.title || "(none)");
  console.log("Script tags found:", dom.window.document.querySelectorAll("script[src]").length);
  console.log("Missing expected globals:", missing.length ? missing : "none");
  console.log("Captured errors:", errors.length ? errors : "none");

  if (missing.length === 0 && errors.length === 0) {
    console.log("RESULT: PASS - all modules loaded in correct order, no errors, key globals present");
    process.exit(0);
  } else {
    console.log("RESULT: FAIL");
    process.exit(1);
  }
})().catch((e) => {
  console.error("Fatal error during load:", e);
  process.exit(1);
});
