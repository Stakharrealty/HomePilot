// PropTx PropertySubType census (TEMPORARY, 2026-09-18). Read-only.
//
// Why: the first 25 real Mississauga rows showed PropTx labels home types
// with its own PropertySubType names ("Detached", "Condo Apartment",
// "Att/Row/Townhouse", ...), and that non-homes get through the
// Residential + For Sale filter (a "Parking Space" at $47,800). 25 rows
// can't show every label PropTx uses, so before writing the sorting and
// the non-home blocking, this asks PropTx for the full picture.
//
// How it proves completeness instead of guessing: it counts ALL active
// residential for-sale listings, then counts each known label, then
// reports the gap. If the gap is 0 the label list is complete. If not,
// it pulls a sample of the listings NOT covered, so the missing labels
// show up by name.
//
// Never writes to D1. Only $top=0 count queries plus one small sample.
// Delete together with the other temporary /proptx-* routes.

const PROPTX_BASE_URL = "https://query.ampre.ca/odata";

// Same scope as the ingest filter in proptx-ingest.js (buildCityFilter),
// minus the city -- so the census covers exactly what ingest can let in.
export const CENSUS_BASE_FILTER =
  "StandardStatus eq 'Active' and TransactionType eq 'For Sale' and startswith(PropertyType,'Residential')";

// Known labels. Where these came from: the first 5 are confirmed from real
// rows (2026-09-18). The rest are candidates only -- the gap check below
// is what decides whether this list is actually complete, not this list.
export const CANDIDATE_SUBTYPES = [
  "Detached", "Condo Apartment", "Condo Townhouse", "Att/Row/Townhouse", "Parking Space",
  "Semi-Detached", "Link", "Duplex", "Triplex", "Fourplex", "Multiplex",
  "Co-op Apartment", "Co-Ownership Apartment", "Common Element Condo",
  "Detached Condo", "Semi-Detached Condo", "Leasehold Condo", "Locker",
  "Time Share", "Vacant Land", "Vacant Land Condo", "Farm", "Rural Residential",
  "Cottage", "Mobile Trailer", "Store W Apt/Office", "Other",
  // Added after the first census run (2026-09-18) -- seen by name in its
  // uncovered sample. Note the trailing space on "Semi-Detached ": that is
  // how PropTx actually sends it.
  "Semi-Detached ", "MobileTrailer", "Timeshare", "Modular Home",
];

function q(value) {
  return String(value).replace(/'/g, "''");
}

async function countWhere(filter, token, fetchImpl) {
  const url = `${PROPTX_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}&$count=true&$top=0`;
  const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!resp.ok) throw new Error(`PropTx count failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return data["@odata.count"];
}

export async function runSubtypeCensus(token, fetchImpl = fetch) {
  const total = await countWhere(CENSUS_BASE_FILTER, token, fetchImpl);

  // Sequential on purpose: ~30 small requests, keeps us well clear of any
  // PropTx rate limit and the Worker's subrequest budget.
  const counts = [];
  for (const name of CANDIDATE_SUBTYPES) {
    const n = await countWhere(`${CENSUS_BASE_FILTER} and PropertySubType eq '${q(name)}'`, token, fetchImpl);
    counts.push({ subtype: name, count: n });
  }

  const covered = counts.reduce((sum, c) => sum + (c.count || 0), 0);
  const gap = total - covered;

  let uncoveredSample = [];
  if (gap > 0) {
    const excludeAll = CANDIDATE_SUBTYPES.map((n) => `PropertySubType ne '${q(n)}'`).join(" and ");
    const filter = `${CENSUS_BASE_FILTER} and ${excludeAll}`;
    const url = `${PROPTX_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}` +
      `&$select=ListingKey,City,PropertyType,PropertySubType,ListPrice&$top=100`;
    const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (resp.ok) {
      const data = await resp.json();
      uncoveredSample = data.value || [];
    } else {
      uncoveredSample = [{ error: `sample fetch failed (${resp.status})` }];
    }
  }

  // Group the uncovered sample by label so missing names read at a glance.
  const uncoveredLabels = {};
  for (const r of uncoveredSample) {
    if (r.error) continue;
    const key = r.PropertySubType ?? "(blank)";
    uncoveredLabels[key] = (uncoveredLabels[key] || 0) + 1;
  }

  return {
    scope: CENSUS_BASE_FILTER,
    totalActiveResidentialForSale: total,
    coveredByKnownLabels: covered,
    gap,
    listIsComplete: gap === 0,
    countsByLabel: counts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count),
    knownLabelsWithZeroListings: counts.filter((c) => c.count === 0).map((c) => c.subtype),
    uncoveredLabelsInSample: uncoveredLabels,
  };
}
