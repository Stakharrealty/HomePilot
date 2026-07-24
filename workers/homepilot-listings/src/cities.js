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
};

// The full set of city names /listings should accept from the front end --
// every real DDF city plus every display-only alias above.
export const PUBLIC_CITY_NAMES = [...HOMEPILOT_CITIES, ...Object.keys(CITY_ALIASES)];
