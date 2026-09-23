// HomePilot home types for PropTx IDX listings (2026-09-18).
//
// Single source of truth for (a) which PropTx PropertySubType labels count
// as a home HomePilot shows buyers, and (b) which of the 4 buttons each
// one sits under. Used by BOTH the ingest (proptx-ingest.js -- non-homes
// are never saved) and the read path (db.js -- non-homes are never shown,
// even if one is already in D1). Same list, two layers, can't drift.
//
// Where the labels come from: the /proptx-subtype-census run on
// 2026-09-18 against all ~62,351 active residential for-sale PropTx
// listings. Mapping approved by Sandeep the same day.
//
// Safety rule: ALLOW-LIST. Any label not in HOME_TYPE_BY_SUBTYPE is
// treated as not-a-home and blocked -- including labels PropTx adds in
// future. A new label only shows once it's added here on purpose.
//
// Blocked on purpose (not in the map below): Vacant Land, Vacant Land
// Condo, Farm, Parking Space, Locker, Timeshare, Store W Apt/Office,
// Other, Co-op Apartment, Co-Ownership Apartment (different financing --
// HomePilot's mortgage math doesn't fit), MobileTrailer, Modular Home,
// Cottage (same financing reason).
//
// Whitespace: PropTx sends "Semi-Detached " WITH a trailing space
// (confirmed in the census -- the untrimmed "Semi-Detached" returned 0).
// Labels are trimmed for classification only; the stored value is left
// exactly as PropTx sent it (Article 6.3(f): content not altered).

// value = button ("detached" | "semi" | "town" | "condo"), or null for
// "shown under All only, no button".
export const HOME_TYPE_BY_SUBTYPE = Object.freeze({
  "Detached": "detached",
  "Rural Residential": "detached",

  "Semi-Detached": "semi",
  "Link": "semi",

  "Att/Row/Townhouse": "town",

  "Condo Apartment": "condo",
  "Condo Townhouse": "condo",
  "Common Element Condo": "condo",
  "Detached Condo": "condo",
  "Semi-Detached Condo": "condo",
  "Leasehold Condo": "condo",

  "Duplex": null,
  "Triplex": null,
  "Fourplex": null,
  "Multiplex": null,
});

export const BUTTON_TYPES = ["detached", "semi", "town", "condo"];

export const SHOWN_SUBTYPES = Object.freeze(Object.keys(HOME_TYPE_BY_SUBTYPE));

export function subtypesForButton(button) {
  return SHOWN_SUBTYPES.filter((s) => HOME_TYPE_BY_SUBTYPE[s] === button);
}

// Every condo-owned label. A condo with no bedroom is a studio, which is a
// real home; any other home type with no bedroom is not (see
// NOT_LAND_OR_UNIT_CLAUSE in db.js).
export const CONDO_SUBTYPES = Object.freeze(subtypesForButton("condo"));

// { shown: boolean, type: button | null }
export function classifySubtype(raw) {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!Object.prototype.hasOwnProperty.call(HOME_TYPE_BY_SUBTYPE, key)) {
    return { shown: false, type: null };
  }
  return { shown: true, type: HOME_TYPE_BY_SUBTYPE[key] };
}

// "('A', 'B')" -- labels are fixed constants above, still quote-escaped.
export function sqlInList(labels) {
  return `(${labels.map((l) => `'${String(l).replace(/'/g, "''")}'`).join(", ")})`;
}
