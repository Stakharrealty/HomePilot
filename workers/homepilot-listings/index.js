const ALLOWED_ORIGIN = "https://myhomepilot.ca";
const TOKEN_URL = "https://identity.crea.ca/connect/token";
const API_BASE = "https://ddfapi.realtor.ca/odata/v1";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function getAccessToken(env) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.DDF_CLIENT_ID,
    client_secret: env.DDF_CLIENT_SECRET,
    scope: "DDFApi_Read",
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token failed (${resp.status}): ${JSON.stringify(data)}`);
  return data.access_token;
}

const HOMEPILOT_CITIES = [
  "Welland", "Fort Erie", "Belleville", "Oshawa", "Hamilton", "Peterborough",
  "Barrie", "Kingston", "St. Catharines", "Niagara Falls", "Midland", "Cobourg",
  "Ottawa", "Wasaga Beach", "Cambridge", "Kitchener", "Waterloo", "Grand Valley",
  "Shelburne", "Innisfil", "Georgina", "Centre Wellington", "Clarington", "Scugog",
  "Collingwood", "Guelph", "Orangeville", "Whitby", "Ajax", "Bradford", "Newmarket",
  "Pickering", "Acton", "Mississauga", "Brampton", "Toronto", "Erin", "Milton",
  "Georgetown", "Halton Hills", "Aurora", "Vaughan", "Markham", "Caledon",
  "Richmond Hill", "Burlington", "Oakville", "Mono", "King City",
];

// NOTE: DaysOnMarket removed from $select (2026-07-21) — confirmed via live /test
// call that it errors as an invalid field on this feed's Property entity:
// "Could not find a property named 'DaysOnMarket' on type 'DDF.Core.Entities.Property'."
// Do not re-add without checking a real /metadata response first.
function buildQuery(top, skip) {
  const cityList = HOMEPILOT_CITIES.map((c) => `'${c}'`).join(",");
  return new URLSearchParams({
    "$top": String(top),
    "$skip": String(skip),
    // ListPrice gt 50000 (not just "ne null") -- added 2026-07-21 after finding
    // real $1-$5000 "Single Family" listings in production data (Pickering,
    // Richmond Hill, Kitchener). These are real agent-entered junk/placeholder
    // prices, not a parsing bug. $50,000 is well below any real Ontario single
    // family home price, so this can't accidentally exclude legitimate cheap
    // listings -- it's purely a garbage filter.
    "$filter": `StateOrProvince eq 'Ontario' and PropertySubType eq 'Single Family' and StandardStatus eq 'Active' and ListPrice gt 50000 and City in (${cityList})`,
    "$select": "ListingKey,ListPrice,City,PostalCode,Latitude,Longitude,BedroomsTotal,BathroomsTotalInteger,ParkingTotal,PropertySubType,StructureType,StandardStatus,ModificationTimestamp",
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    try {
      if (url.pathname === "/test") {
        const token = await getAccessToken(env);
        const listingsResp = await fetch(`${API_BASE}/Property?${buildQuery(20, 0).toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const listingsData = await listingsResp.json();
        return new Response(
          JSON.stringify({ status: listingsResp.status, count: (listingsData.value || []).length, listings: listingsData.value || listingsData }, null, 2),
          { status: listingsResp.status, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      if (url.pathname === "/metadata") {
        const token = await getAccessToken(env);
        const metaResp = await fetch(`${API_BASE}/$metadata`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const metaText = await metaResp.text();
        return new Response(metaText, {
          status: metaResp.status,
          headers: { "Content-Type": "application/xml", ...corsHeaders(origin) },
        });
      }

      if (url.pathname === "/ingest") {
        const token = await getAccessToken(env);
        let skip = 0;
        const pageSize = 50;
        const maxRecords = 500;
        let totalWritten = 0;
        let totalSeen = 0;

        while (totalSeen < maxRecords) {
          const resp = await fetch(`${API_BASE}/Property?${buildQuery(pageSize, skip).toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await resp.json();
          const rows = data.value || [];
          if (rows.length === 0) break;

          for (const r of rows) {
            await env.DB.prepare(
              `INSERT INTO listings (
                listing_key, list_price, city, postal_code, latitude, longitude,
                property_subtype, structure_type, bedrooms, bathrooms, parking_total,
                listing_url, brokerage_name, listing_status, last_updated
              ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(listing_key) DO UPDATE SET
                list_price=excluded.list_price, city=excluded.city, postal_code=excluded.postal_code,
                latitude=excluded.latitude, longitude=excluded.longitude,
                property_subtype=excluded.property_subtype, structure_type=excluded.structure_type,
                bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms, parking_total=excluded.parking_total,
                listing_status=excluded.listing_status, last_updated=excluded.last_updated`
            ).bind(
              r.ListingKey,
              r.ListPrice || 0,
              r.City || "",
              r.PostalCode || null,
              r.Latitude || null,
              r.Longitude || null,
              r.PropertySubType || "",
              JSON.stringify(r.StructureType || []),
              r.BedroomsTotal || null,
              r.BathroomsTotalInteger || null,
              r.ParkingTotal || null,
              `https://www.realtor.ca/real-estate/${r.ListingKey}`,
              null,
              r.StandardStatus || "",
              r.ModificationTimestamp || new Date().toISOString()
            ).run();
            totalWritten++;
          }

          totalSeen += rows.length;
          skip += pageSize;
          if (rows.length < pageSize) break;
        }

        return new Response(
          JSON.stringify({ status: "ok", totalWritten }, null, 2),
          { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }
        );
      }

      return new Response(JSON.stringify({ error: "Not found. Try /test, /metadata, or /ingest" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || String(err) }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
  },
};
