// Functional smoke test — loads a real page in jsdom, drives the real form,
// and checks the engine produced sane results.
//
// REPAIRED 2026-09-22 (audit). Two things were wrong, and they compounded:
//
//   1. It loaded index.html, which stopped having a calculator when the form
//      moved to calculator.html. Every run since then has thrown
//      "Cannot set properties of null (setting 'value')" at the first
//      getElementById("inc").
//   2. It had no process.exit anywhere, so it ALWAYS exited 0. The
//      "Functional smoke test" step in deploy.yml and dev-to-main.yml has
//      therefore been reporting green while doing nothing, for as long as the
//      calculator has lived on its own page.
//
// A gate that cannot fail is worse than no gate: it reads as coverage. This
// version points at the page that actually has the form, asserts on what it
// finds, and exits non-zero when an assertion fails.

const { JSDOM, VirtualConsole } = require("jsdom");

const page = process.argv[2] || "calculator.html";
const url = `http://localhost:8843/${page}`;

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS - ${name}`);
  } else {
    failures++;
    console.log(`  FAIL - ${name}${detail !== undefined ? ` :: ${detail}` : ""}`);
  }
}

(async () => {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));

  const dom = await JSDOM.fromURL(url, {
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole,
    pretendToBeVisual: true,
  });

  await new Promise((res) => setTimeout(res, 1000));

  console.log(`=== Functional smoke test (${page}) ===`);

  // 1. City data sanity
  const cityCount = dom.window.eval("M.length");
  check("55 cities loaded", cityCount === 55, cityCount);

  // 2. calcBP runs and returns a plausible, self-consistent answer
  const bp = JSON.parse(dom.window.eval(`
    (function () {
      try {
        customMortgageRate = DEFAULT_MORTGAGE_RATE_PCT / 100;
        firstTimeBuyer = false;
        return JSON.stringify(calcBP(108000, 60000, 0));
      } catch (e) { return JSON.stringify({ error: e.message }); }
    })()
  `));
  check("calcBP does not throw", !bp.error, bp.error);
  check("calcBP returns a numeric buying power", Number.isFinite(bp.bp) && bp.bp > 0, bp.bp);
  check("comfort range sits below the bank ceiling", bp.comfortBP < bp.bp, `${bp.comfortBP} vs ${bp.bp}`);
  check("buying power is purchasable with the stated down payment",
    dom.window.eval(`meetsMinDownPayment(${bp.bp}, 60000)`), `bp ${bp.bp} on 60000 down`);

  // 3. Drive the real form the way a buyer would, then read the real DOM.
  const go = JSON.parse(dom.window.eval(`
    (function () {
      try {
        document.getElementById("inc").value = "108000";
        document.getElementById("dwn").value = "60000";
        document.getElementById("dbt").value = "0";
        document.getElementById("area").value = document.getElementById("area").options[0].value;
        document.getElementById("fam").value = document.getElementById("fam").options[0].value;
        // Both answers picked explicitly: neither is pre-selected any more,
        // and go() stops until they are (IMPROVEMENT_PLAN.md 2.5).
        setWorkArrangement("remote");
        setFTB(false);
        go();
        var cnt = document.getElementById("cnt");
        // render() emits one <div class="city"> per card: the three answer
        // cards, then the rest under "See all places", drawn once it is opened
        // (2026-09-24, IMPROVEMENT_PLAN.md 2.2). A place can have two cards
        // (two homes), so the count is of places.
        var answers = document.getElementById("answers");
        var answerCount = answers ? answers.querySelectorAll(".city").length : -1;
        toggleSeeAll();
        var places = {};
        document.querySelectorAll("#answers .city .cn, #list .city .cn").forEach(function (n) { places[n.textContent.trim()] = true; });
        var cardCount = Object.keys(places).length;
        var m = cnt ? /(\\d+)\\s+(?:city|cities)/.exec(cnt.textContent) : null;
        return JSON.stringify({
          results: Array.isArray(results) ? results.length : -1,
          buyPower: buyPower,
          errVisible: document.getElementById("err").style.display,
          bpShown: document.getElementById("bpV").textContent,
          claimed: m ? Number(m[1]) : null,
          answerCount: answerCount,
          cardCount: cardCount,
        });
      } catch (e) { return JSON.stringify({ error: e.message + " | " + e.stack }); }
    })()
  `));
  check("go() does not throw", !go.error, go.error);
  check("go() produced no error banner", go.errVisible !== "block", go.errVisible);
  check("go() set a buying power", Number.isFinite(go.buyPower) && go.buyPower > 0, go.buyPower);
  check("the buying power box shows a dollar figure", /^\$[\d,]+$/.test(String(go.bpShown)), go.bpShown);
  check("go() produced city results", go.results > 0, go.results);
  check("at least one answer card rendered, at most three", go.answerCount > 0 && go.answerCount <= 3, go.answerCount);
  // The headline count and the cards below it are derived from different
  // tables; they diverged badly enough to say "38 cities match your budget"
  // above an empty list. render() owns the count now — this asserts it stays
  // owned there.
  check("the city count matches the places on the cards actually rendered",
    go.claimed !== null && go.claimed === go.cardCount, `claimed ${go.claimed}, rendered ${go.cardCount}`);

  check("no uncaught DOM errors", errors.length === 0, errors.join(" | "));

  console.log(`\n=== RESULT: ${failures === 0 ? "PASS" : `${failures} FAILED`} ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
