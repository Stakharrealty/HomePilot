const { JSDOM, VirtualConsole } = require("jsdom");

const url = "http://localhost:8843/index.html";

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

  console.log("=== Phase 3: functional smoke test ===");

  // 1. City data sanity
  const cityCount = dom.window.eval("M.length");
  console.log("Cities loaded (M.length):", cityCount, cityCount === 55 ? "OK" : "UNEXPECTED (expected 55)");

  // 2. calcBP runs without throwing, on a plausible ANNUAL income input
  const bpResult = dom.window.eval(`
    (function() {
      try {
        customMortgageRate = DEFAULT_MORTGAGE_RATE_PCT/100;
        const r = calcBP(108000, 60000, 0); // annual income, down payment, existing debt
        return JSON.stringify(r);
      } catch (e) {
        return "ERROR: " + e.message;
      }
    })()
  `);
  console.log("calcBP() sample output (108k income, 60k down):", bpResult);

  // 3. Run go() the real way: fill the actual form fields a user would use, click Go.
  const goResult = dom.window.eval(`
    (function() {
      try {
        document.getElementById("inc").value = "108000";
        document.getElementById("dwn").value = "60000";
        document.getElementById("dbt").value = "0";
        document.getElementById("area").value = document.getElementById("area").options[0].value;
        document.getElementById("fam").value = document.getElementById("fam").options[0].value;
        workArrangement = 'remote';
        go();
        return {
          hasResults: Array.isArray(results) ? results.length : typeof results,
          buyPower, comfortBuyPower,
          errVisible: document.getElementById("err").style.display
        };
      } catch (e) {
        return "ERROR: " + e.message + " | " + e.stack;
      }
    })()
  `);
  console.log("go() result (via real form fields):", goResult);

  console.log("Captured DOM errors:", errors.length ? errors : "none");
})().catch((e) => console.error("Fatal:", e));
