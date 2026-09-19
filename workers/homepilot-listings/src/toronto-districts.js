// Toronto district handling for the PropTx (TRREB) feed.
//
// PropTx stores Toronto listings under district-coded City values such as
// "Toronto C07" or "Toronto W04" -- never plain "Toronto" (confirmed live
// 2026-09-18; startswith(City,'Toronto') recovers ~20,656 active listings).
// The ingest keeps the full value in `city` and stores the bare code
// ("C07") in `city_district`.
//
// HomePilot shows six Toronto cards (see CITY_ALIASES in cities.js). This
// file is the ONE place that says which TRREB districts belong to which
// card. It is a judgment call based on how the districts line up with the
// neighbourhoods each card name implies -- review it, and edit the table
// below if a district lands somewhere you disagree with. Every district
// belongs to exactly one card (enforced by tests), and a district missing
// from this table simply isn't shown under any sub-region card (it still
// appears under the plain "Toronto" card, which shows all of them).
//
// TRREB districts and the areas they cover, with the card chosen:
//
//   Downtown
//     C01  Bay Street Corridor, Waterfront, Kensington, Trinity-Bellwoods
//     C02  Annex, Yorkville
//     C08  St. Lawrence, Church-Yonge, Cabbagetown
//     C09  Rosedale, Moore Park
//     C10  Mount Pleasant West, Davisville, Yonge-Eglinton (midtown --
//          closest in price/lifestyle to the Downtown card)
//   West End
//     C03  Forest Hill South, Humewood-Cedarvale, Oakwood-Vaughan
//     W01  Roncesvalles, High Park, Swansea, Parkdale
//     W02  Junction, Bloor West Village, Runnymede
//     W03  Weston-Pellam, Rockcliffe-Smythe, Caledonia
//     W04  Weston, Mount Dennis, Brookhaven (old City of York)
//   East End
//     C11  Leaside, Thorncliffe Park, Flemingdon Park (East York)
//     E01  Leslieville, Riverdale, Greenwood-Coxwell
//     E02  The Beaches, Woodbine Corridor
//     E03  Danforth, East York, Woodbine-Lumsden
//   North York
//     C04  Lawrence Park, Bedford Park, Yonge-Lawrence
//     C06  Bathurst Manor, Clanton Park, Downsview-Roding
//     C07  Willowdale West, Newtonbrook, Lansing-Westgate
//     C12  York Mills, Bridle Path, St. Andrew-Windfields
//     C13  Parkwoods, Don Mills, Banbury
//     C14  Willowdale East, Newtonbrook East
//     C15  Bayview Village, Henry Farm, Don Valley Village
//     W05  Downsview, Humber Summit, Black Creek, York University Heights
//   Etobicoke
//     W06  Mimico, Humber Bay, Long Branch, New Toronto
//     W07  Stonegate-Queensway
//     W08  Islington-City Centre West, Kingsway, Eringate
//     W09  Kingsway South, Princess-Rosethorn
//     W10  Rexdale, Thistletown, Mount Olive, Elms
//   Scarborough
//     E04  Kennedy Park, Clairlea, Birchmount, Wexford
//     E05  L'Amoreaux, Steeles, Tam O'Shanter
//     E06  Guildwood, Birch Cliff, Oakridge
//     E07  Agincourt, Milliken, Malvern
//     E08  Cliffcrest, Scarborough Village
//     E09  Woburn, Morningside, Bendale
//     E10  West Hill, Centennial, Highland Creek
//     E11  Rouge, Malvern, Port Union
//
// (TRREB has no C05; any other code PropTx invents later is simply not
// mapped until added here.)

export const TORONTO_REGION_DISTRICTS = Object.freeze({
  "Toronto - Downtown":   ["C01", "C02", "C08", "C09", "C10"],
  "Toronto - West End":   ["C03", "W01", "W02", "W03", "W04"],
  "Toronto - East End":   ["C11", "E01", "E02", "E03"],
  "Toronto - North York": ["C04", "C06", "C07", "C12", "C13", "C14", "C15", "W05"],
  "Toronto - Etobicoke":  ["W06", "W07", "W08", "W09", "W10"],
  "Toronto - Scarborough": ["E04", "E05", "E06", "E07", "E08", "E09", "E10", "E11"],
});

const DISTRICT_CODE = /^[CEW]\d{2}$/;

/** Districts for a sub-region card name, or null if it isn't one. */
export function districtsForRegion(name) {
  return TORONTO_REGION_DISTRICTS[name] || null;
}

/** "Toronto C07" -> "C07"; anything else (incl. plain "Toronto") -> null. */
export function parseTorontoDistrict(cityValue) {
  if (typeof cityValue !== "string") return null;
  const m = cityValue.trim().match(/^Toronto\s+([CEW]\d{2})$/i);
  return m ? m[1].toUpperCase() : null;
}

/** Guard for anything interpolated into SQL: only bare district codes. */
export function isDistrictCode(code) {
  return typeof code === "string" && DISTRICT_CODE.test(code);
}
