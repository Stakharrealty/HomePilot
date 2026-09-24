// Phone length of the results (IMPROVEMENT_PLAN.md 2.10): "Results fit in
// about three phone screens", keeping today's look.
//
// jsdom does no layout, so this test measures in a real browser: headless
// Chrome (or Edge), driven over the DevTools protocol with Node's own
// WebSocket, at 375x812 -- an iPhone-sized screen, the size Batch 1 measured
// at. For each of the plan's three buyers it loads the calculator, fills the
// real form, runs go(), and measures from the top of the "Your HomePilot
// comfort range" box (where go() scrolls the page to) to the end of the
// results: the "See all places" button, closed as a search leaves it.
//
// Measured 2026-09-24 in Chrome, in screens of 812px, the same way for both:
//
//   buyer                                                batch 1   2.2 layout
//   (1) $90K + $60K, $100K down, hybrid Toronto, first-time  8.13      3.45
//   (2) $130K, $70K down, $450/mo debt, hybrid Toronto       5.64      3.44
//       (nothing within 60 minutes is comfortable: the "you're close" page)
//   (3) $250K, $300K down, remote                           44.20      3.26
//
// Batch 1 (branch phase2-batch1) drew every place in the big card format; the
// 2.2 layout draws three answer cards and keeps the rest, and the "Only as a
// stretch" and "Past your commute limit" sections, behind "See all places"
// until the buyer opens it. No trims were made for 2.10: the three answer
// cards, which stay exactly as they are, are about two screens on their own
// and the top box another 0.4; the gaps between the blocks add up to about
// 100px, so tightening them would win an eighth of a screen at most and
// change the look. Buyers whose cards list all four home types run longer
// (about 3.8-4 screens), all of it in the cards.
//
// What it checks, for each buyer:
//   - the results are at most 3.6 screens: about three, with room for a
//     line or two of text, but not for another block or more cards;
//   - before "See all places" is opened the page draws only the answer
//     cards (three at most), nothing under "See all places";
//   - the answer cards are stacked at full width, one under the other, as
//     today's phone cards are;
//   - nothing makes the page scroll sideways.
// It prints each block's height, so a longer page shows where it grew.
//
// Then, since 2026-09-24, the answer cards on a computer, at 1240 and 1280px
// wide, where they sit three across at about 228-241px each (see
// measureDesktopInPage() below): three side by side, starting level; no
// home-type row cut off; every figure in every cost breakdown at least 8px
// from its label; no sideways scroll.
//
// When no Chrome or Edge is found, or it will not start, the test says SKIP
// and exits 0 (a GitHub Actions warning in CI) rather than blocking a deploy
// over the machine. CHROME_PATH picks a browser.
//
// Requires: a local static server on :8843 (npx http-server -p 8843 -s).
// Run: node --no-warnings tests/phone_length_test.js

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const URL_CALC = "http://localhost:8843/calculator.html";
const PHONE = { width: 375, height: 812 };
// "About three phone screens" (IMPROVEMENT_PLAN.md 2.10). 3.6 until
// 2026-09-24, when the user's one-item-per-line top for the three answer cards
// added about 70px a card (3.45 -> 3.68 screens for these buyers).
const MAX_SCREENS = 3.8;

const BUYERS = [
  { name: "(1) $90K + $60K, $100K down, hybrid Toronto, first-time", income: 90000, partnerIncome: 60000, down: 100000, debt: 0, work: "hybrid", workCity: "Toronto", firstTime: true },
  { name: "(2) $130K, $70K down, $450/mo debt, hybrid Toronto (the \"you're close\" page)", income: 130000, down: 70000, debt: 450, work: "hybrid", workCity: "Toronto", firstTime: true, emptyPage: true },
  { name: "(3) $250K, $300K down, remote", income: 250000, down: 300000, debt: 0, work: "remote", firstTime: true },
];

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log("  PASS - " + label); }
  else { failed++; console.log("  FAIL - " + label + (detail !== undefined ? " :: " + detail : "")); }
}
function skip(reason) {
  console.log("SKIP - " + reason);
  if (process.env.GITHUB_ACTIONS) console.log("::warning title=Phone length test skipped::" + reason);
  process.exit(0);
}

// ---------- the browser ----------
function findBrowser() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const fixed = {
    win32: [
      path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
  }[process.platform];
  if (fixed) return fixed.find((p) => p && fs.existsSync(p)) || null;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    try { const p = execFileSync("which", [name], { encoding: "utf8" }).trim(); if (p) return p; } catch (e) { /* not installed */ }
  }
  return null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + " took longer than " + ms / 1000 + "s")), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

// Starts the browser with its own empty profile; resolves to its DevTools
// port and the browser's own DevTools address (for closing it). The process
// started can hand over to another and exit (Edge on Windows does), so the
// port file is what says the browser is up, not the process.
async function launch(exe, profile) {
  const args = ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio"];
  // CI runners (Linux) often cannot give Chrome its sandbox.
  if (process.platform === "linux") args.push("--no-sandbox");
  args.push("about:blank");
  let proc = null, cannotRun = false;
  try { proc = spawn(exe, args, { stdio: "ignore" }); } catch (e) { return { proc: null, port: null }; }
  proc.on("error", () => { cannotRun = true; });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 200 && !cannotRun; i++) {
    if (fs.existsSync(portFile)) {
      const [port, browserPath] = fs.readFileSync(portFile, "utf8").split(/\r?\n/);
      if (Number(port) > 0 && browserPath) return { proc, port: Number(port), browserWs: "ws://127.0.0.1:" + port + browserPath };
    }
    await wait(100);
  }
  try { proc.kill(); } catch (e) { /* already gone */ }
  return { proc: null, port: null };
}

// Closes the browser through DevTools (which reaches it whichever process it
// ended up in), then removes its profile.
async function closeBrowser(b, profile) {
  if (b.browserWs) {
    try {
      const browser = await withTimeout(connect(b.browserWs), 5000, "reaching the browser to close it");
      await withTimeout(browser.send("Browser.close").catch(() => {}), 5000, "closing the browser");
      browser.close();
    } catch (e) { /* killed below */ }
  }
  try { if (b.proc) b.proc.kill(); } catch (e) { /* already gone */ }
  for (let i = 0; i < 20; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); return; } catch (e) { await wait(250); }
  }
}

// A minimal DevTools protocol client over Node's built-in WebSocket.
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const waiting = [];
    let id = 0;
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const n = ++id;
          pending.set(n, { res, rej, method });
          ws.send(JSON.stringify({ id: n, method, params: params || {} }));
        });
      },
      next(event) { return new Promise((res) => waiting.push({ event, res })); },
      close() { try { ws.close(); } catch (e) { /* closed */ } },
    });
    ws.onerror = () => reject(new Error("could not connect to the browser"));
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(p.method + ": " + msg.error.message)); else p.res(msg.result);
      } else if (msg.method) {
        for (let i = waiting.length - 1; i >= 0; i--) {
          if (waiting[i].event === msg.method) { waiting[i].res(msg.params); waiting.splice(i, 1); }
        }
      }
    };
  });
}

// ---------- what runs in the page ----------
// Fills the real form as results_outcomes_test.js does, runs the search, and
// measures the results as laid out. Runs on a freshly loaded page per buyer.
async function measureInPage(b) {
  const d = document;
  const set = (id, v) => { d.getElementById(id).value = v; };
  set("inc", String(b.income));
  set("inc2", b.partnerIncome ? String(b.partnerIncome) : "");
  set("dwn", String(b.down));
  set("dbt", String(b.debt || 0));
  set("fam", "3");
  set("area", "all");
  setFTB(b.firstTime === true);
  setWorkArrangement(b.work);
  if (b.work !== "remote") { set("workCity", b.workCity); set("workPostal", ""); }
  go();
  if (d.fonts && d.fonts.ready) await d.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const shown = (el) => el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
  const box = (el) => el.getBoundingClientRect();
  const results = d.querySelector(".calc-results");
  const blocks = [...results.children].filter((el) => shown(el) && !/fixed|sticky/.test(getComputedStyle(el).position));
  const top = box(d.getElementById("bpBox")).top;
  const bottom = Math.max(...blocks.map((el) => box(el).bottom));
  const answers = d.getElementById("answers");
  const answerCards = [...answers.querySelectorAll(".city")];
  const firstAnswer = answers.querySelector(".answer-slot");
  return {
    ok: d.getElementById("bpBox").style.display === "block",
    error: d.getElementById("err").style.display === "block" ? d.getElementById("err").textContent : "",
    px: Math.round(bottom - top),
    blocks: blocks.map((el) => ({ id: el.id || el.className, h: Math.round(box(el).height) })),
    firstAnswerAt: firstAnswer ? Math.round(box(firstAnswer).top - top) : null,
    heading: d.getElementById("cnt").textContent.trim(),
    cardsDrawn: [...results.querySelectorAll(".city")].filter(shown).length,
    answerCards: answerCards.length,
    closest: answers.querySelectorAll(".answer-slot[data-answers='closest']").length,
    underSeeAll: d.querySelectorAll("#seeAllBody .city").length,
    seeAllClosed: seeAllOpen === false && getComputedStyle(d.getElementById("seeAllBody")).display === "none",
    seeAllButton: shown(d.getElementById("seeAllBtn")) ? d.getElementById("seeAllBtn").textContent.trim() : "",
    cardWidths: answerCards.map((c) => Math.round(box(c).width)),
    answersWidth: Math.round(box(answers).width),
    stacked: answerCards.every((c, i) => i === 0 || box(c).top >= box(answerCards[i - 1]).bottom),
    pageWidth: d.documentElement.scrollWidth,
    viewport: [innerWidth, innerHeight],
  };
}

// ---------- the answer cards on a computer (2026-09-24) ----------
// Three across from 1240px, each card about 223-241px wide up to 1280px:
// narrower than any phone's card. Measured there, before the fixes: a
// home-type row wider than its bordered list lost its chevron under the
// list's overflow:hidden (11-15px at 1240); a two-question label
// ("MOST HOME · SHORTEST COMMUTE") wrapped and pushed its card 16-17px below
// the other two; and in the cost breakdowns a label ran into its figure
// ("Estimated Cash Required to Close" 0.1px from "~$123,950").
const DESKTOP_WIDTHS = [1240, 1280];
const DESKTOP_BUYERS = [
  { name: "$90K + $60K, $100K down, hybrid Toronto", income: 90000, partnerIncome: 60000, down: 100000, debt: 0, work: "hybrid", workCity: "Toronto", firstTime: true },
  { name: "$250K, $300K down, remote, condos only", income: 250000, down: 300000, debt: 0, work: "remote", firstTime: false, onlyType: "condo" },
  { name: "$300K + $200K, $500K down, daily Toronto", income: 300000, partnerIncome: 200000, down: 500000, debt: 0, work: "daily", workCity: "Toronto", firstTime: false },
];
const MIN_LABEL_GAP_PX = 8;
async function measureDesktopInPage(b) {
  const d = document;
  const set = (id, v) => { d.getElementById(id).value = v; };
  set("inc", String(b.income));
  set("inc2", b.partnerIncome ? String(b.partnerIncome) : "");
  set("dwn", String(b.down));
  set("dbt", String(b.debt || 0));
  set("fam", "3");
  set("area", "all");
  setFTB(b.firstTime === true);
  setWorkArrangement(b.work);
  if (b.work !== "remote") { set("workCity", b.workCity); set("workPostal", ""); }
  go();
  if (b.onlyType) filtProp(b.onlyType, d.getElementById("pt-" + b.onlyType));
  if (d.fonts && d.fonts.ready) await d.fonts.ready;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await frame();
  const cards = [...d.querySelectorAll("#answers .city")];
  const lists = cards.flatMap((c) => [...c.querySelectorAll("div[style*='overflow:hidden']")]);
  const rows = cards.flatMap((c) => [...c.querySelectorAll("[id^='pt-row-']:not([id$='-chevron'])")]);
  // "View Available Homes" on each answer card: how far apart the tops and
  // bottoms are (0 = lined up), worst case over the closed cards and every
  // breakdown opened below.
  // Since 2026-09-24 every part lines up too (the user): the top, At a glance,
  // the home-type list, AI Insights and Compare, so their tops are measured
  // the same way.
  const btnSpread = () => {
    const bs = cards.map((c) => c.querySelector(":scope > .view-btn")).filter(Boolean).map((b) => b.getBoundingClientRect());
    if (bs.length !== cards.length) return Infinity;
    const sp = (k, rs) => Math.max(...rs.map((r) => r[k])) - Math.min(...rs.map((r) => r[k]));
    let worst = Math.max(sp("top", bs), sp("bottom", bs));
    const parts = cards.map((c) => [c.querySelector(".ac-head"), ...c.querySelectorAll(".city-body > .ac-sec")]);
    if (parts.some((p) => p.length !== 5 || !p[0])) return Infinity;
    for (let i = 0; i < 5; i++) worst = Math.max(worst, sp("top", parts.map((p) => p[i].getBoundingClientRect())));
    return worst;
  };
  let buttonSpread = btnSpread();
  // Every breakdown, opened one at a time: the smallest gap between a label
  // and its figure on the same line.
  let minGap = Infinity, pairs = 0;
  for (const r of rows) {
    r.click();
    await frame();
    buttonSpread = Math.max(buttonSpread, btnSpread());
    const panel = d.getElementById(r.id.replace("pt-row-", "pt-panel-"));
    if (panel && panel.style.display !== "none") {
      panel.querySelectorAll("div[style*='justify-content:space-between']").forEach((row) => {
        if (row.children.length !== 2) return;
        const rects = (el) => { const rg = d.createRange(); rg.selectNodeContents(el); return [...rg.getClientRects()]; };
        const a = rects(row.children[0]), f = rects(row.children[1]);
        if (!a.length || !f.length) return;
        pairs++;
        for (const x of a) for (const y of f) if (x.bottom > y.top && y.bottom > x.top) minGap = Math.min(minGap, y.left - x.right);
      });
    }
    r.click();
  }
  return {
    viewport: innerWidth,
    slots: d.querySelectorAll("#answers .answer-slot").length,
    columns: getComputedStyle(d.querySelector("#answers .answer-grid")).gridTemplateColumns.split(" ").length,
    widths: cards.map((c) => Math.round(c.getBoundingClientRect().width)),
    tops: cards.map((c) => Math.round(c.getBoundingClientRect().top)),
    labels: [...d.querySelectorAll("#answers .answer-label")].map((l) => l.textContent),
    overflow: Math.max(0, ...lists.map((l) => l.scrollWidth - l.clientWidth)),
    chevronsCut: rows.filter((r) => { const c = d.getElementById(r.id + "-chevron"), list = r.parentElement.parentElement; return c && c.getBoundingClientRect().right > list.getBoundingClientRect().right - 1; }).length,
    minGap: minGap === Infinity ? null : Math.round(minGap * 10) / 10, pairs,
    buttonSpread: buttonSpread === Infinity ? null : Math.round(buttonSpread * 10) / 10,
    pageWidth: d.documentElement.scrollWidth,
  };
}

(async () => {
  if (typeof WebSocket !== "function") skip("this Node has no built-in WebSocket (Node 22 or later needed)");
  const exe = findBrowser();
  if (!exe) skip("no Chrome or Edge found; set CHROME_PATH to run it");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hp-phone-length-"));
  const browser = await launch(exe, profile);
  if (!browser.port) { await closeBrowser(browser, profile); skip("the browser at " + exe + " did not start"); }
  const port = browser.port;

  let page;
  try {
    const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    let target = targets.find((t) => t.type === "page");
    if (!target) target = await (await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT" })).json();
    page = await withTimeout(connect(target.webSocketDebuggerUrl), 10000, "connecting to the browser");
  } catch (e) {
    await closeBrowser(browser, profile);
    skip("could not drive the browser: " + e.message);
  }

  console.log("\nPhone length of the results, " + PHONE.width + "x" + PHONE.height + " (" + path.basename(exe) + ")");
  try {
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: PHONE.width, height: PHONE.height, deviceScaleFactor: 2, mobile: true });
    for (const b of BUYERS) {
      const loaded = page.next("Page.loadEventFired");
      await page.send("Page.navigate", { url: URL_CALC });
      await withTimeout(loaded, 30000, "loading " + URL_CALC);
      await wait(300);
      const r = await page.send("Runtime.evaluate", { expression: "(" + measureInPage.toString() + ")(" + JSON.stringify(b) + ")", awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("the page script failed: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      const m = r.result.value;
      const screens = m.px / PHONE.height;
      console.log("\n" + b.name);
      console.log("  " + screens.toFixed(2) + " screens (" + m.px + "px); first answer card at " + m.firstAnswerAt + "px; " + m.heading);
      console.log("  blocks: " + m.blocks.map((x) => x.id + " " + x.h).join(", "));
      check("the search ran and the results show", m.ok && !m.error && m.viewport[0] === PHONE.width && m.viewport[1] === PHONE.height, m.error || JSON.stringify(m.viewport));
      check("the results are at most " + MAX_SCREENS + " phone screens, about three", screens <= MAX_SCREENS, screens.toFixed(2) + " screens");
      check("before 'See all places' is opened, only the answer cards are drawn (at most three), none under 'See all places'",
        m.seeAllClosed && m.underSeeAll === 0 && m.answerCards >= 1 && m.answerCards <= 3 && m.cardsDrawn === m.answerCards && /^See all places/.test(m.seeAllButton),
        JSON.stringify({ closed: m.seeAllClosed, underSeeAll: m.underSeeAll, answers: m.answerCards, drawn: m.cardsDrawn, button: m.seeAllButton }));
      if (b.emptyPage) check("...on the 'you're close' page they are the three closest options", m.closest === 3 && m.closest === m.answerCards, m.closest);
      check("the answer cards are stacked at full width, as today's phone cards", m.stacked && m.cardWidths.every((w) => Math.abs(w - m.answersWidth) <= 1),
        m.cardWidths.join("/") + " in " + m.answersWidth);
      check("nothing makes the page scroll sideways", m.pageWidth <= PHONE.width, m.pageWidth + "px wide");
    }

    for (const width of DESKTOP_WIDTHS) {
      console.log("\nAnswer cards on a computer, " + width + "x800");
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      for (const b of DESKTOP_BUYERS) {
        const loaded = page.next("Page.loadEventFired");
        await page.send("Page.navigate", { url: URL_CALC });
        await withTimeout(loaded, 30000, "loading " + URL_CALC);
        await wait(300);
        const r = await page.send("Runtime.evaluate", { expression: "(" + measureDesktopInPage.toString() + ")(" + JSON.stringify(b) + ")", awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error("the page script failed: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
        const m = r.result.value;
        console.log("  " + b.name + ": cards " + m.widths.join("/") + "px, tops " + m.tops.join("/") + ", labels " + m.labels.join(" | ") + ", smallest label gap " + m.minGap + "px over " + m.pairs + " lines");
        check(`${width}px, ${b.name}: three answer cards side by side`, m.viewport === width && m.slots === 3 && m.columns === 3, JSON.stringify({ viewport: m.viewport, slots: m.slots, columns: m.columns }));
        check(`${width}px, ${b.name}: the three cards start level, a wrapped label included`, Math.max(...m.tops) - Math.min(...m.tops) <= 1, m.tops.join("/"));
        check(`${width}px, ${b.name}: no home-type row is cut off (nothing wider than its list, every chevron inside it)`, m.overflow === 0 && m.chevronsCut === 0, m.overflow + "px over, " + m.chevronsCut + " chevrons cut");
        check(`${width}px, ${b.name}: in every cost breakdown each figure stays at least ${MIN_LABEL_GAP_PX}px from its label`, m.pairs > 0 && m.minGap >= MIN_LABEL_GAP_PX, m.minGap + "px");
        check(`${width}px, ${b.name}: every part (top, At a glance, home types, AI Insights, Compare) and "View Available Homes" lines up across the three cards, however many home types each lists, breakdowns open or closed`, m.buttonSpread !== null && m.buttonSpread <= 1, m.buttonSpread + "px apart");
        check(`${width}px, ${b.name}: nothing makes the page scroll sideways`, m.pageWidth <= width, m.pageWidth + "px wide");
      }
    }
  } catch (e) {
    failed++;
    console.log("  FAIL - " + e.message);
  } finally {
    page.close();
    await closeBrowser(browser, profile);
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log("  FAIL - " + e.message);
  process.exit(1);
});
