// buyer-profile.js -- hands the buyer's own affordability numbers from the
// main app to the listings page (listings.html) and the listing detail page
// (listing.html), which are separate pages that can't see the main app's
// variables.
//
// Storage: sessionStorage, deliberately not the URL (income must never sit
// in a shareable link) and not localStorage (it should not outlive the tab).
// sessionStorage survives same-tab navigation, which covers phones, where
// "View Available Homes" opens the listings in the same tab, and the step
// from the listings page to a listing's detail page (a same-window link).
//
// A new tab does NOT get a copy of this tab's sessionStorage (computers open
// the listings in a new tab with rel="noopener"). So the click also hands the
// numbers over through localStorage under a one-time random key, and only the
// key goes in the link (?hp=<key>). listings.html collects the entry as it
// loads, deletes it at once and keeps the numbers in its own sessionStorage.
// An entry nobody collected is deleted after HP_HANDOFF_MAX_AGE_MS by the next
// HomePilot page that loads this file.
//
// Nothing here is sent anywhere: it is read back by listing-fit.js and
// listing-detail.js to run the mortgage engine locally in the browser. No AI
// call ever sees it.

const HP_PROFILE_KEY = "hp_buyer_profile_v1";
const HP_HANDOFF_PARAM = "hp";
const HP_HANDOFF_PREFIX = "hp_profile_handoff_v1:";
const HP_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

// Reads the main app's live globals (set by go() / the scenario sandbox /
// the rate slider). Returns null when there are no real results yet, so a
// half-initialised app never writes a misleading profile.
function readLiveBuyerProfile() {
  try {
    if (typeof grossMonthlyIncome === "undefined" || !(grossMonthlyIncome > 0)) return null;
    if (typeof dn_selected === "undefined" || !(dn_selected > 0)) return null;
    return {
      grossMonthlyIncome: grossMonthlyIncome,
      netMonthlyIncome: typeof netMonthlyIncome !== "undefined" ? netMonthlyIncome : 0,
      // True when netMonthlyIncome is the take-home the buyer typed in the
      // results' top section rather than the estimate (2026-09-24,
      // IMPROVEMENT_PLAN.md 2.2), so the listing page can say whose it is.
      takeHomeIsOwn: typeof takeHomeIsBuyersOwn === "function" ? takeHomeIsBuyersOwn() === true : false,
      downPayment: dn_selected,
      familySize: typeof fam_selected !== "undefined" ? fam_selected : "3",
      existingDebt: typeof existingDebt !== "undefined" ? existingDebt : 0,
      firstTimeBuyer: typeof firstTimeBuyer !== "undefined" ? firstTimeBuyer === true : false,
      // The land transfer tax rebates and non-resident taxes (2026-09-23,
      // closingcosts.js): the rebate only when the buyer confirmed they qualify.
      lttRebateEligible: typeof buyerLttRebateApplies === "function" ? buyerLttRebateApplies() === true : false,
      canadianResident: typeof canadianResident !== "undefined" ? canadianResident !== false : true,
      mortgageRate: typeof customMortgageRate !== "undefined" ? customMortgageRate : null,
      savedAt: Date.now(),
    };
  } catch (e) {
    return null;
  }
}

// Called by listingsLinkClicked() (listings-display.js) as a "View Available
// Homes" link is followed.
function saveBuyerProfile() {
  try {
    const profile = readLiveBuyerProfile();
    if (!profile) return false;
    window.sessionStorage.setItem(HP_PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch (e) {
    return false; // storage blocked (private mode etc.) -- the page just shows its no-profile fallback
  }
}

// Returns a validated copy of a stored profile, or null. Every field is
// range-checked: this storage is writable by anything on the origin, so
// nothing is trusted.
function validBuyerProfile(p) {
  if (!p || typeof p !== "object") return null;
  const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (!num(p.grossMonthlyIncome, 1, 5e6)) return null;
  if (!num(p.downPayment, 1, 1e9)) return null;
  const fam = parseInt(p.familySize, 10);
  if (!Number.isFinite(fam) || fam < 1 || fam > 20) return null;
  const rate = num(p.mortgageRate, 0.005, 0.25) ? p.mortgageRate : null;
  return {
    grossMonthlyIncome: p.grossMonthlyIncome,
    netMonthlyIncome: num(p.netMonthlyIncome, 0, 5e6) ? p.netMonthlyIncome : 0,
    // Missing on a profile saved before 2026-09-24: the estimate.
    takeHomeIsOwn: p.takeHomeIsOwn === true && num(p.netMonthlyIncome, 1, 5e6),
    downPayment: p.downPayment,
    familySize: String(fam),
    existingDebt: num(p.existingDebt, 0, 1e8) ? p.existingDebt : 0,
    firstTimeBuyer: p.firstTimeBuyer === true,
    // Missing on a profile saved before 2026-09-23: no rebate, resident.
    lttRebateEligible: p.lttRebateEligible === true,
    canadianResident: p.canadianResident !== false,
    mortgageRate: rate,
  };
}

function loadBuyerProfile() {
  try {
    const raw = window.sessionStorage.getItem(HP_PROFILE_KEY);
    if (!raw) return null;
    return validBuyerProfile(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

// --- Handing the numbers to a new tab (2026-09-24, IMPROVEMENT_PLAN 2.7) ---

function hpHandoffKey() {
  const bytes = new Uint8Array(16);
  if (window.crypto && typeof window.crypto.getRandomValues === "function") window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Writes the live profile for the page a link is about to open. Returns the
// one-time key for the link, or null (no results yet, or storage blocked).
function handOffBuyerProfile() {
  try {
    const profile = readLiveBuyerProfile();
    if (!profile) return null;
    const key = hpHandoffKey();
    window.localStorage.setItem(HP_HANDOFF_PREFIX + key, JSON.stringify({ handedAt: Date.now(), profile }));
    return key;
  } catch (e) {
    return null;
  }
}

// Called by listings.html as it loads, with the key from its address. The
// entry is deleted whatever happens; a valid, recent one becomes this tab's
// profile. Returns true when it did.
function takeBuyerProfileHandoff(key) {
  if (typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key)) return false;
  try {
    const storageKey = HP_HANDOFF_PREFIX + key;
    const raw = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    if (!raw) return false;
    const entry = JSON.parse(raw);
    const age = Date.now() - Number(entry && entry.handedAt);
    if (!(age >= 0 && age <= HP_HANDOFF_MAX_AGE_MS)) return false;
    if (!validBuyerProfile(entry.profile)) return false;
    window.sessionStorage.setItem(HP_PROFILE_KEY, JSON.stringify(entry.profile));
    return true;
  } catch (e) {
    return false;
  }
}

// Deletes handed-over numbers that no page collected in time.
function sweepBuyerProfileHandoffs() {
  try {
    const store = window.localStorage;
    const now = Date.now();
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.indexOf(HP_HANDOFF_PREFIX) === 0) keys.push(k);
    }
    for (const k of keys) {
      let handedAt = NaN;
      try { handedAt = Number(JSON.parse(store.getItem(k)).handedAt); } catch (e) { /* unreadable: delete */ }
      const age = now - handedAt;
      if (!(age >= 0 && age <= HP_HANDOFF_MAX_AGE_MS)) store.removeItem(k);
    }
  } catch (e) {
    // storage blocked: nothing was handed over, nothing to delete
  }
}
sweepBuyerProfileHandoffs();
