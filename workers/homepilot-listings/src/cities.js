// homepilot-listings — cities module
// The 49 Ontario cities HomePilot covers, used to filter CREA/DDF listings
// to only areas the app actually serves. Extracted from the single-file
// index.js during the 2026-07-21 module split.
//
// NOTE (flagged in prior session, still unresolved as of this split): this
// list currently duplicates the main app's own city list rather than
// importing it from a single shared source. If the main app's city list
// ever changes (a city added/removed/renamed), this list must be updated
// here too, manually. A future cleanup could have both pull from one
// canonical source, but that's cross-Worker/cross-app plumbing not
// attempted in this split.

export const HOMEPILOT_CITIES = [
  "Welland", "Fort Erie", "Belleville", "Oshawa", "Hamilton", "Peterborough",
  "Barrie", "Kingston", "St. Catharines", "Niagara Falls", "Midland", "Cobourg",
  "Ottawa", "Wasaga Beach", "Cambridge", "Kitchener", "Waterloo", "Grand Valley",
  "Shelburne", "Innisfil", "Georgina", "Centre Wellington", "Clarington", "Scugog",
  "Collingwood", "Guelph", "Orangeville", "Whitby", "Ajax", "Bradford", "Newmarket",
  "Pickering", "Acton", "Mississauga", "Brampton", "Toronto", "Erin", "Milton",
  "Georgetown", "Halton Hills", "Aurora", "Vaughan", "Markham", "Caledon",
  "Richmond Hill", "Burlington", "Oakville", "Mono", "King City",
];

// CITY_ALIASES (added 2026-07-24, bug fix): the main app displays 7 city
// cards that are NOT real CREA/DDF cities -- CREA has no concept of
// Toronto sub-regions (Downtown, West End, East End, North York,
// Etobicoke, Scarborough all come back as plain "Toronto" from CREA) and
// Bolton is part of Caledon municipality, not its own CREA city. Every one
// of these 7 display names was being rejected outright by /listings as
// "Unknown city" -- confirmed live, this was a total live-listings outage
// for the app's highest-density GTA cards, not a partial/edge-case bug.
// Ingest itself is unaffected (HOMEPILOT_CITIES above is unchanged, still
// queries CREA using only real city names) -- this map is consulted ONLY
// at the /listings read path, to resolve a display name to the real city
// its rows are actually stored under in D1.
export const CITY_ALIASES = {
  "Toronto - Downtown": "Toronto",
  "Toronto - West End": "Toronto",
  "Toronto - East End": "Toronto",
  "Toronto - North York": "Toronto",
  "Toronto - Etobicoke": "Toronto",
  "Toronto - Scarborough": "Toronto",
  "Bolton": "Caledon",

  // PropTx municipality names (added 2026-09-22, audit). The 2026-09-18 PropTx
  // investigation recorded these four mismatches in this Worker's own comments
  // -- "Acton and Georgetown both map to 'Halton Hills'; King City maps to
  // 'King'; Bradford maps to 'Bradford West Gwillimbury'" -- but no aliases
  // were ever added, so /listings?city=Acton queried `city = 'Acton'`, which
  // matches zero PropTx rows. All four cities were permanently empty: not
  // "no listings right now", but no listings ever, by construction.
  "Acton": "Halton Hills",
  "Georgetown": "Halton Hills",
  "King City": "King",
  "Bradford": "Bradford West Gwillimbury",

};

// Grand Valley is deliberately NOT here, and the reason is worth keeping.
//
// PropTx files it under the township's full legal name, "East Luther Grand
// Valley" (46 active homes; confirmed live 2026-09-22 -- the 2026-09-18 note
// calling it a "genuine zero-coverage city (not a naming issue)" was wrong).
// The obvious fix is an alias here, and that was the first attempt. It is the
// wrong tool, because an alias resolves a card name TO a stored value and
// nothing maps the stored value back:
//
//   - rows land with city = "East Luther Grand Valley"
//   - cardForCommunity() cannot recover "Grand Valley" from it, so the
//     cityRegion the API returns is null
//   - the frontend then falls back to listing.city (listing-fit.js:63), which
//     matches no market record, so cost math silently uses the unknown-city
//     defaults (tax 0.0105 instead of Grand Valley's 0.00874) and shows the
//     buyer a property-tax figure roughly $930/yr too high as if it were fact
//   - listing-detail.js builds a back link to
//     listings.html?city=East Luther Grand Valley, which is an alias VALUE,
//     not a public city name, so /listings answers 400 and the link is dead
//
// A 1:1 municipality rename is therefore fixed at INGEST, by storing the card
// name in the city column -- exactly what Ottawa already does. See CITY_CARD_NAME in
// proptx-ingest.js. An alias is only correct when several cards share one
// municipality and the read path must narrow between them (Acton, Georgetown,
// King City, Bradford, Bolton), because there the community column carries
// the card name back.

// The full set of city names /listings should accept from the front end --
// every real DDF city plus every display-only alias above.
export const PUBLIC_CITY_NAMES = [...HOMEPILOT_CITIES, ...Object.keys(CITY_ALIASES)];
