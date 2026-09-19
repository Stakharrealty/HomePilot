// Card-level photo carousel: arrows + swipe on the listings-grid thumbnail.
// Same harness as listings_frontend_display_test.js (jsdom over the local
// static server on :8843, mocked fetch, never touches the real Worker).
const { JSDOM, VirtualConsole } = require("jsdom");
const url = "http://localhost:8843/index.html";
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  PASS - " + name); }
  else { failed++; console.log("  FAIL - " + name + (detail ? " :: " + detail : "")); }
}
const P = (n) => `https://cdn.example.com/p${n}.jpg`;
const DATA = { city: "Guelph", count: 3, listings: [
  { listingKey: "MULTI", listPrice: 700000, city: "Guelph", brokerageName: "B", photos: [P(1), P(2), P(3), "javascript:alert(1)", P(5)] },
  { listingKey: "ONE", listPrice: 600000, city: "Guelph", brokerageName: "B", photos: [P(9)] },
  { listingKey: "NONE", listPrice: 500000, city: "Guelph", brokerageName: "B", photos: [] },
] };

(async () => {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL(url, { runScripts: "dangerously", resources: "usable", virtualConsole: vc, pretendToBeVisual: true });
  await new Promise((r) => setTimeout(r, 1500));
  const win = dom.window;
  win.fetch = async () => ({ ok: true, json: async () => DATA });
  const c = win.document.createElement("div");
  win.document.body.appendChild(c);
  await win.renderLiveListings("Guelph", c);
  const [multi, one, none] = c.querySelectorAll(".listing-card");
  const img = () => multi.querySelector("img.listing-photo");
  const counter = () => multi.querySelector(".listing-photo-counter").textContent;
  const click = (sel) => multi.querySelector(sel).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  check("multi-photo card has prev + next arrows and a counter",
    !!multi.querySelector(".listing-photo-prev") && !!multi.querySelector(".listing-photo-next") && !!multi.querySelector(".listing-photo-counter"));
  check("unsafe (javascript:) photo URL is dropped -> counter shows 1/4", counter() === "1/4", counter());
  check("only ONE <img> per card (lazy: no upfront load of the set)", multi.querySelectorAll("img").length === 1);
  check("starts on photo 1", img().src === P(1));
  click(".listing-photo-next");
  check("next -> photo 2, counter 2/4", img().src === P(2) && counter() === "2/4", img().src + " " + counter());
  click(".listing-photo-next"); click(".listing-photo-next");
  check("next x3 -> photo 5 (skipping the dropped URL), counter 4/4", img().src === P(5) && counter() === "4/4", img().src);
  click(".listing-photo-next");
  check("next wraps to first", img().src === P(1) && counter() === "1/4");
  click(".listing-photo-prev");
  check("prev wraps to last", img().src === P(5) && counter() === "4/4");
  check("alt text tracks position", /Photo 4 of 4/.test(img().alt), img().alt);
  check("still only one <img> after flipping", multi.querySelectorAll("img").length === 1);

  function touch(type, x, y) {
    const e = new win.Event(type, { bubbles: true });
    const pt = [{ clientX: x, clientY: y }];
    if (type === "touchstart") e.touches = pt; else e.changedTouches = pt;
    multi.querySelector(".listing-photo-wrap").dispatchEvent(e);
  }
  touch("touchstart", 200, 100); touch("touchend", 100, 105); // swipe left
  check("swipe left -> next photo (1/4)", counter() === "1/4", counter());
  touch("touchstart", 100, 100); touch("touchend", 200, 100); // swipe right
  check("swipe right -> previous photo (4/4)", counter() === "4/4", counter());
  touch("touchstart", 100, 100); touch("touchend", 110, 100);
  check("tiny drag (<40px) does not change photo", counter() === "4/4");
  touch("touchstart", 100, 100); touch("touchend", 130, 300);
  check("mostly-vertical scroll does not change photo", counter() === "4/4");

  check("single-photo card has no arrows/counter", !one.querySelector(".listing-photo-nav") && !one.querySelector(".listing-photo-counter"));
  check("single-photo card still shows its photo", one.querySelector("img.listing-photo").src === P(9));
  check("no-photo card still shows fallback, no arrows", none.innerHTML.includes("No photo available") && !none.querySelector(".listing-photo-nav"));
  check("no script errors while loading page", errors.length === 0, errors.join(" | "));

  console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
