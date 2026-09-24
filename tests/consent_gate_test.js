// consent_gate_test.js — verifies the pre-calculation consent gate
//
// Guards against silent regressions that would let a buyer reach an
// affordability figure without acknowledging the Terms / Privacy / Disclaimer:
//   - the Go button must route through requestCalculation(), not go()
//   - the modal, checkbox and links must exist in calculator.html
//   - the accept button must ship disabled
//   - consent must be version-stamped so copy changes re-prompt
//   - an unchecked box must not start a calculation
//   - a stored acceptance for an older version must not satisfy the gate

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "calculator.html"), "utf8");
const consentJs = fs.readFileSync(path.join(root, "src", "consent.js"), "utf8");

let failures = 0;
function t(name, cond) {
  if (cond) {
    console.log("  PASS  " + name);
  } else {
    console.log("  FAIL  " + name);
    failures++;
  }
}

console.log("Consent gate tests");

// --- markup wiring ---
t("Go button calls requestCalculation()", /id="goBtn"\s+onclick="requestCalculation\(\)"/.test(html));
t("Go button no longer calls go() directly", !/id="goBtn"\s+onclick="go\(\)"/.test(html));
t("consent.js is loaded by calculator.html", html.includes('<script src="src/consent.js"></script>'));
t("consent modal overlay exists", html.includes('id="consentModalOverlay"'));
t("consent checkbox exists", html.includes('id="consentCheckbox"'));
t("accept button exists", html.includes('id="consentAcceptBtn"'));
t("accept button ships disabled", /id="consentAcceptBtn"[^>]*\sdisabled/.test(html));
t("modal links Terms of Use", /consentModalOverlay[\s\S]*?href="\/terms-of-use\.html"/.test(html));
t("modal links Privacy Policy", /consentModalOverlay[\s\S]*?href="\/privacy-policy\.html"/.test(html));
t("modal links Disclaimer", /consentModalOverlay[\s\S]*?href="\/disclaimer\.html"/.test(html));
t("modal states results are not advice", /not<\/strong>\s*financial, mortgage, legal or tax advice/.test(html));

// --- module contract ---
t("consent.js defines a version constant", /HP_CONSENT_VERSION\s*=\s*['"][\w-]+['"]/.test(consentJs));
t("consent.js does not gate go() internally", !/function\s+go\s*\(/.test(consentJs));

// --- behaviour ---
const sandbox = {
  accepted: false,
  store: {},
  calls: 0
};
const shim = `
  let go = function(){ __calls++; };
  const window = { localStorage: {
    getItem: (k) => (k in __store ? __store[k] : null),
    setItem: (k, v) => { __store[k] = String(v); }
  }};
  const document = { addEventListener: () => {}, getElementById: (id) => __els[id] || null };
  // main.js's check of the two questions with no pre-selected answer (2.5).
  const checkRequiredChoices = () => __choicesOk !== false;
  const showFirstUnansweredChoice = () => { __shownQuestion++; };
`;

function runScenario(label, { seed, checked, modalPresent, choicesOk }, assertFn) {
  const els = {};
  if (modalPresent) {
    els.consentModalOverlay = { style: { display: "none" }, focus() {} };
    els.consentCheckbox = { checked: !!checked };
    els.consentAcceptBtn = { disabled: true, style: {}, focus() {} };
  }
  let calls = 0;
  const store = seed ? { hp_consent: JSON.stringify(seed) } : {};
  const fn = new Function(
    "__store", "__els", "__callsRef", "__choicesOk",
    `let __calls = 0, __shownQuestion = 0;${shim}${consentJs}
     const __api = { requestCalculation, acceptConsentAndCalculate, hasHomePilotConsent };
     return { api: __api, getCalls: () => __calls, getShownQuestion: () => __shownQuestion, store: __store, els: __els };`
  );
  const ctx = fn(store, els, calls, choicesOk);
  assertFn(ctx, label);
}

// 1. No prior consent + modal present -> calculation blocked, modal opened
runScenario("fresh visitor", { modalPresent: true }, (ctx) => {
  ctx.api.requestCalculation();
  t("fresh visitor: calculation is blocked", ctx.getCalls() === 0);
  t("fresh visitor: modal is opened", ctx.els.consentModalOverlay.style.display === "flex");
});

// 2. Unchecked box -> accept does nothing
runScenario("unchecked box", { modalPresent: true, checked: false }, (ctx) => {
  ctx.api.acceptConsentAndCalculate();
  t("unchecked box: calculation is blocked", ctx.getCalls() === 0);
  t("unchecked box: nothing is stored", !ctx.store.hp_consent);
});

// 3. Checked box -> records versioned consent and calculates
runScenario("checked box", { modalPresent: true, checked: true }, (ctx) => {
  ctx.api.acceptConsentAndCalculate();
  t("checked box: calculation runs", ctx.getCalls() === 1);
  const rec = ctx.store.hp_consent ? JSON.parse(ctx.store.hp_consent) : null;
  t("checked box: consent is stored with a version", !!rec && typeof rec.version === "string");
  t("checked box: consent is stored with a timestamp", !!rec && !!rec.acceptedAt);
  t("checked box: modal is closed", ctx.els.consentModalOverlay.style.display === "none");
});

// 4. Returning visitor with current consent -> straight through
runScenario("returning visitor", { modalPresent: true, seed: null }, (ctx) => {
  const current = consentJs.match(/HP_CONSENT_VERSION\s*=\s*['"]([\w-]+)['"]/)[1];
  ctx.store.hp_consent = JSON.stringify({ version: current, acceptedAt: "2026-01-01T00:00:00.000Z" });
  ctx.api.requestCalculation();
  t("returning visitor: calculation runs without the modal", ctx.getCalls() === 1);
});

// 5. Stale version -> re-prompted
runScenario("stale consent", { modalPresent: true, seed: { version: "1900-01-01", acceptedAt: "x" } }, (ctx) => {
  ctx.api.requestCalculation();
  t("stale consent: calculation is blocked", ctx.getCalls() === 0);
  t("stale consent: modal is reopened", ctx.els.consentModalOverlay.style.display === "flex");
});

// 6. Modal missing from DOM -> fail open rather than trapping the user
runScenario("modal missing", { modalPresent: false }, (ctx) => {
  ctx.api.requestCalculation();
  t("modal missing: fails open instead of blocking forever", ctx.getCalls() === 1);
});

// 7. Work arrangement or first-time buyer unanswered (IMPROVEMENT_PLAN.md 2.5)
//    -> the buyer is shown the question, not the consent pop-up, and nothing runs
runScenario("unanswered question", { modalPresent: true, choicesOk: false }, (ctx) => {
  ctx.api.requestCalculation();
  t("unanswered question: calculation is blocked", ctx.getCalls() === 0);
  t("unanswered question: the consent pop-up stays closed", ctx.els.consentModalOverlay.style.display === "none");
  t("unanswered question: the question is brought into view", ctx.getShownQuestion() === 1);
});

console.log(failures === 0 ? "\nAll consent gate tests passed." : `\n${failures} consent gate test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
