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
