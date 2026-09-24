// i18n.js — HomePilot's English interface strings
//
// English only since 2026-09-23 (IMPROVEMENT_PLAN.md 2.4b). The site used to
// carry machine translations in Punjabi, Hindi, Urdu, French, Mandarin and
// Spanish behind a language menu. They were removed because AI translation
// could not be made to read naturally to native speakers, and parts of the
// site were never translated at all. If languages come back, they should come
// from human translators.
//
// What is left is the handful of English strings the scripts write into the
// page themselves (the fit labels, the results card wording, the form error
// and the button text). Everything else is plain text in the HTML. T.en stays
// as an object so the existing T.en lookups keep working unchanged.
//
// Loaded via <script src="src/i18n.js"></script> on index.html,
// calculator.html, listings.html and listing.html, before the scripts that
// read it (explainability.js, main.js, render.js).

const T={
  en:{
    bt:"Show Me What I Can Afford",
    err:"Please fill in your income to continue.",
    fit_great_lbl:"Great fit",fit_good_lbl:"Good Fit",fit_stretch_lbl:"Stretch",
    true_cost:"True monthly cost",mortgage:"Mortgage",
    stretch_warn:"⚠️ This property type slightly exceeds your current buying power. A larger down payment, co-borrower, or reduced debt could make it achievable."
  }
};
