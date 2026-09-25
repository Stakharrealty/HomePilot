// render-support.js — HomePilot rendering helper functions
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Loaded via <script src="src/render-support.js"></script>
// before the main inline script, same shared global scope as before.
//
// Contains: buildDevPanel() (Dev Mode debug panel) and buildWhyRanked().
//
// REMOVED 2026-09-23 (IMPROVEMENT_PLAN.md 1.2 / 1.4), because rankCities() in
// ranking.js is now the only thing that orders cities:
//   - getHousingOpportunityPenalty(): a second, hidden adjustment on top of
//     the weighted score. "Most home" is now the ranking rule itself.
//   - getLeadSummaryForCity(): re-derived each lead city's home from scratch,
//     ignoring the comfort range, for cities taken from a DIFFERENT order than
//     the screen's -- so the lead listed Toronto condos at 53% of take-home
//     while the buyer was looking at Cambridge and Kitchener (P0-3). The lead
//     was then built from the cards render() drew (shownCards), as Compare
//     still is; the lead form itself was removed later
//     that day.
//   - renderAnglePicks(): its "Outside Your Comfort Range" box is replaced by
//     the "Only as a stretch" section render() draws below the main list.

// Dev Mode (Shift+D): the facts behind one card's place in the ranking. There
// is no score any more -- the order is the rule in ranking.js -- so this shows
// the inputs to that rule.
function buildDevPanel(e, section) {
  const PLBL = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};
  const cell = (label, value, color) =>
    '<div style="background:#161b22;border-radius:6px;padding:8px;text-align:center">'
      + '<div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">' + label + '</div>'
      + '<div style="font-size:18px;font-weight:800;color:' + (color || '#e6edf3') + '">' + value + '</div>'
    + '</div>';
  return '<div style="margin-top:10px;padding:12px 14px;background:#0d1117;border:1.5px solid #1D9E75;border-radius:10px;font-family:monospace">'
    + '<div style="font-size:10px;font-weight:700;color:#1D9E75;letter-spacing:0.08em;margin-bottom:10px">⚙ DEV — ' + e.n + ' · ' + section + ' · sort: ' + resultsSort + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">'
      + cell('Home (rank ' + (HOME_RANK[e.type] || 0) + ')', PLBL[e.type] || e.type)
      + cell('Of take-home', e.pct === null ? 'n/a' : e.pct + '%', e.comfortable ? '#1D9E75' : '#d29922')
      + cell('Drive (est.)', e.commuteMin === null ? 'n/a' : e.commuteMin + ' min', '#58a6ff')
    + '</div>'
    + '<div style="border-top:1px solid #21262d;padding-top:8px;font-size:11px;color:#8b949e;line-height:1.9">'
      + '<div>Price: <span style="color:#e6edf3">' + fc(e.price) + '</span> · Monthly: <span style="color:#e6edf3">' + fc(e.costs.total) + '/mo</span> · Fit: <span style="color:#e6edf3">' + e.fit.lbl + '</span></div>'
      + '<div>Comfortable: <span style="color:#e6edf3">' + e.comfortable + '</span> (price ≤ ' + fc(comfortBuyPower) + ' and not Stretch) · Limit: <span style="color:#e6edf3">' + (maxCommuteMin ? maxCommuteMin + ' min' : 'none') + '</span></div>'
    + '</div>'
  + '</div>';
}

// buildWhyRankedBullets() lives in src/explainability.js — loaded via <script src>.
//
// Icons CHANGED 2026-09-23 (REVIEW_BACKLOG.md P1-6): every bullet used to get
// a green ✓, including "Limited Commute to your workplace" and "1 housing type
// available — all stretch territory". A tick now means good news only; facts
// get a neutral dot and bad news a "!". The box is "At a glance" rather than
// "Why ranked here": the ranking is the one rule stated above the list, and
// these bullets never explained it.
const WHY_ICON = {
  good:    '<span style="color:#1D9E75;font-weight:700;flex-shrink:0">✓</span>',
  neutral: '<span style="color:#9CA3AF;font-weight:700;flex-shrink:0">·</span>',
  bad:     '<span style="color:#B45309;font-weight:700;flex-shrink:0">!</span>',
};

// `lead` (optional, the answer cards only; IMPROVEMENT_PLAN.md 2.2b,
// 2026-09-24): one line shown first -- why a card carries two or three labels
// ("Why two labels: ..."), or the "Also worth a look" card's trade. HTML.
function buildWhyRanked(x, c, net, commuteMin, displayPropType, displayPrice, lead) {
  // Renders bullets as HTML. Logic lives in buildWhyRankedBullets().
  const bullets = buildWhyRankedBullets(x, c, net, commuteMin, displayPropType, displayPrice);
  if(lead) bullets.unshift({ key: 'lead', tone: 'neutral', text: lead });
  if(!bullets.length) return '';
  return '<div style="margin-top:10px;padding:10px 12px;background:#FAFAFA;border:1px solid #EEEEEE;border-radius:10px">' +
    '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#555;margin-bottom:7px">At a glance</div>' +
    bullets.map(b =>
      '<div data-key="' + b.key + '" style="font-size:12px;color:#1a1a1a;padding:2px 0;display:flex;align-items:flex-start;gap:6px">' +
      (WHY_ICON[b.tone] || WHY_ICON.neutral) + '<span>' + b.text + '</span></div>'
    ).join('') +
    '</div>';
}
