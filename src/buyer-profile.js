// buyer-profile.js -- hands the buyer's own affordability numbers from the
// main app to the listing detail page (listing.html), which is a separate
// page/window that can't see the main app's variables.
//
// Storage: sessionStorage, deliberately not the URL (income must never sit
// in a shareable link) and not localStorage (it should not outlive the tab).
// sessionStorage is copied into a window opened with window.open() and
// survives same-tab navigation, which covers both the desktop popup and the
// mobile navigate flows in openListingsWindow(). It is NOT copied into a
// window opened with rel="noopener" -- so the detail page is always reached
// by same-window navigation, never a new-tab link.
//
// Nothing here is sent anywhere: it is read back by listing-detail.js to run
// the mortgage engine locally in the browser. No AI call ever sees it.

const HP_PROFILE_KEY = "hp_buyer_profile_v1";

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
      downPayment: dn_selected,
      familySize: typeof fam_selected !== "undefined" ? fam_selected : "3",
      existingDebt: typeof existingDebt !== "undefined" ? existingDebt : 0,
      firstTimeBuyer: typeof firstTimeBuyer !== "undefined" ? firstTimeBuyer === true : false,
      mortgageRate: typeof customMortgageRate !== "undefined" ? customMortgageRate : null,
      savedAt: Date.now(),
    };
  } catch (e) {
    return null;
  }
}

// Called by openListingsWindow() just before it opens the listings view.
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

// Returns a validated profile or null. Every field is range-checked: this
// storage is writable by anything on the origin, so nothing is trusted.
function loadBuyerProfile() {
  try {
    const raw = window.sessionStorage.getItem(HP_PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
    if (!num(p.grossMonthlyIncome, 1, 5e6)) return null;
    if (!num(p.downPayment, 1, 1e9)) return null;
    const fam = parseInt(p.familySize, 10);
    if (!Number.isFinite(fam) || fam < 1 || fam > 20) return null;
    const rate = num(p.mortgageRate, 0.005, 0.25) ? p.mortgageRate : null;
    return {
      grossMonthlyIncome: p.grossMonthlyIncome,
      netMonthlyIncome: num(p.netMonthlyIncome, 0, 5e6) ? p.netMonthlyIncome : 0,
      downPayment: p.downPayment,
      familySize: String(fam),
      existingDebt: num(p.existingDebt, 0, 1e8) ? p.existingDebt : 0,
      firstTimeBuyer: p.firstTimeBuyer === true,
      mortgageRate: rate,
    };
  } catch (e) {
    return null;
  }
}
