// Community (PropTx "CityRegion") handling for municipalities that hold
// more than one HomePilot city card.
//
// THE PROBLEM THIS SOLVES
// Three HomePilot cards are not municipalities at all -- they are
// communities inside a larger one, and PropTx only ever stores the
// municipality in `City`:
//
//   Acton, Georgetown   -> City = "Halton Hills"
//   King City           -> City = "King"
//   Bradford            -> City = "Bradford West Gwillimbury"
//
// CITY_ALIASES in cities.js resolves the card name to the municipality, so
// the query finds rows at all. But the municipality is not the card: an
// Acton card resolved only through the alias would show all 263 Halton
// Hills listings, 140 of them in Georgetown and 69 rural -- and a King City
// card would show Schomberg and Nobleton homes priced with King City's
// estate-market numbers ($1.65M detached, the app's most expensive record).
// This file narrows each card to its own community.
//
// WHAT PROPTX ACTUALLY RETURNS (confirmed live 2026-09-22 against
// query.ampre.ca, every Active / For Sale / Residential listing in each
// municipality -- 689 listings, CityRegion populated on 100% of them, zero
// nulls):
//
//   Halton Hills (263)  Georgetown 140, "1049 - Rural Halton Hills" 69,
//                       "1045 - AC Acton" 28, "1064 - ES Rural Esquesing" 11,
//                       Glen Williams 10, "1048 - Limehouse" 3,
//                       "1050 - Stewarttown" 2
//   King (243)          King City 98, Rural King 73, Nobleton 37,
//                       Schomberg 24, Pottageville 11
//   Bradford W.G. (183) Bradford 137,
//                       "Rural Bradford West Gwillimbury" 36, Bond Head 10
//
// Note the two shapes in the same municipality: bare names ("Georgetown")
// and TRREB-coded ones ("1045 - AC Acton" -- numeric area code, then a
// two-letter community abbreviation). normalizeCommunity() below reduces
// both to the bare name, and the ingest stores THAT in the `community`
// column, so the read path can match on plain "Acton".
//
// WHY AN EXACT ALLOW-LIST AND NOT A SUBSTRING MATCH
// "Rural Bradford West Gwillimbury" contains "Bradford"; a contains-check
// for the Bradford card would pull in all 36 rural listings. Matching is
// exact, against the list below, and anything unrecognized simply doesn't
// appear under a community card -- it still appears under the municipality
// card where one exists (Halton Hills is itself a HomePilot city). That is
// the safe direction to fail: a missing listing, never a mislabelled one.

/**
 * PropTx CityRegion -> bare community name.
 * "1045 - AC Acton" -> "Acton"; "Georgetown" -> "Georgetown".
 * Returns null for anything that isn't a usable string.
 */
export function normalizeCommunity(raw) {
  if (typeof raw !== "string") return null;
  let v = raw.trim();
  if (!v) return null;
  // Leading TRREB area code: "1045 - ".
  v = v.replace(/^\d+\s*-\s*/, "");
  // Leading two-letter community abbreviation: "AC Acton", "ES Rural
  // Esquesing". Requires something after it, so a community genuinely
  // named with two capitals can never be erased entirely.
  v = v.replace(/^[A-Z]{2}\s+(?=\S)/, "");
  v = v.replace(/\s+/g, " ").trim();
  return v || null;
}

/**
 * The communities that make up each HomePilot card, keyed by card name.
 * A card listed here shows ONLY these communities within its municipality.
 *
 * Judgment calls worth knowing about (edit here if you disagree):
 * - Georgetown is Georgetown proper only. Glen Williams, Limehouse and
 *   Stewarttown are separate hamlets in Halton Hills with their own names
 *   in the feed; they show under the Halton Hills card, not Georgetown.
 * - King City excludes Nobleton, Schomberg, Pottageville and Rural King.
 *   The app has no card for those, so those 145 listings are not reachable
 *   -- deliberately. Showing them as "King City" would price a Schomberg
 *   home against King City's estate market.
 * - Bradford is the town proper; Bond Head and the rural belt are excluded
 *   for the same reason.
 */
export const CITY_COMMUNITIES = Object.freeze({
  "Acton": Object.freeze(["Acton"]),
  "Georgetown": Object.freeze(["Georgetown"]),
  "King City": Object.freeze(["King City"]),
  "Bradford": Object.freeze(["Bradford"]),
});

/** Communities for a card name, or null if the card isn't community-scoped. */
export function communitiesForCity(name) {
  const list = CITY_COMMUNITIES[name];
  return list ? [...list] : null;
}

/**
 * The HomePilot card a stored row belongs to, from its municipality and
 * normalized community: ("Halton Hills", "Acton") -> "Acton". Null when the
 * row isn't in a community-scoped card -- including a Halton Hills row in
 * Glen Williams, which belongs to the Halton Hills card under its own name.
 *
 * Scoped by municipality on purpose: a community name is only unique within
 * its own city, and this must never match one city's community against
 * another city's card.
 */
export function cardForCommunity(city, community) {
  if (typeof city !== "string" || typeof community !== "string") return null;
  for (const [card, list] of Object.entries(CITY_COMMUNITIES)) {
    if (COMMUNITY_MUNICIPALITY[card] === city && list.includes(community)) return card;
  }
  return null;
}

/**
 * The municipality each community card lives in -- the same mapping
 * CITY_ALIASES in cities.js uses at the read path, repeated here only so
 * cardForCommunity() can scope its match. Tests assert the two agree.
 */
export const COMMUNITY_MUNICIPALITY = Object.freeze({
  "Acton": "Halton Hills",
  "Georgetown": "Halton Hills",
  "King City": "King",
  "Bradford": "Bradford West Gwillimbury",
});
