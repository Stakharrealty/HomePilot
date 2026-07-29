// Property classification fix test (2026-07-29).
//
// Why real SQLite, not a mocked D1 stub: PROPERTY_TYPE_FILTERS and the
// derived_property_type CASE are SQL string fragments evaluated BY the
// database, not JS logic Claude can reimplement and test in isolation --
// a hand-rolled JS reimplementation of the SQL could itself have bugs or
// drift from the real query. node:sqlite (built into Node 22+) runs the
// EXACT same SQL string, against a real in-memory SQLite table, seeded
// with real combinations pulled from production D1 during the audit that
// preceded this fix.
//
// What this proves:
//   1. The LIKE '%House%' case-insensitive substring bug is fixed --
//      "Row / Townhouse" no longer matches the 'semi' filter (measured in
//      production at 2,565 false matches, 86% of what "Semi-Detached"
//      incorrectly returned).
//   2. Condo townhouses match ONLY 'condo', never also 'town' (measured
//      in production at 1,305 listings appearing under both buttons).
//   3. All 4 filters are mutually exclusive for every real combination
//      seen in production D1 -- a listing matching one never matches
//      another.
//   4. derived_property_type (returned to the frontend) always agrees
//      with which PROPERTY_TYPE_FILTERS clause actually matched -- can't
//      drift out of sync, because it's built from the same clause strings.
//   5. Real production-scale counts are locked in as a regression guard:
//      re-running this exact classification against a full copy of
//      production's frequency table should reproduce the audited
//      percentages (52.65% detached, 30.82% condo, etc.) within rounding.
//
// Run: node tests/listings_property_classification_test.js

const path = require("path");
const { pathToFileURL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const SRC_DIR = path.join(__dirname, "..", "workers", "homepilot-listings", "src");

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${label}`);
  } else {
    failed++;
    console.log(`  FAIL - ${label}${detail ? " :: " + detail : ""}`);
  }
}

// Real production frequency-table combinations (city omitted, not relevant
// to classification), pulled directly from the D1 audit that preceded this
// fix. Each row includes the REAL observed count so the SQLite test table
// can be seeded at the same relative scale, not just "one of each".
const PRODUCTION_COMBOS = [
  { structure_type: '["House"]', common_interest: "Freehold", property_attached: 0, count: 6034 },
  { structure_type: '["Apartment"]', common_interest: "Condo/Strata", property_attached: 1, count: 2200 },
  { structure_type: '["Row / Townhouse"]', common_interest: "Condo/Strata", property_attached: 1, count: 1305 },
  { structure_type: '["Row / Townhouse"]', common_interest: "Freehold", property_attached: 1, count: 1246 },
  { structure_type: '["House"]', common_interest: "Freehold", property_attached: 1, count: 415 },
  { structure_type: '["Mobile Home"]', common_interest: "Leasehold", property_attached: null, count: 45 },
  { structure_type: '["House"]', common_interest: "Leasehold", property_attached: 0, count: 44 },
  { structure_type: '["Modular"]', common_interest: "Leasehold", property_attached: null, count: 33 },
  { structure_type: '["House"]', common_interest: null, property_attached: null, count: 29 },
  { structure_type: '["Mobile Home"]', common_interest: null, property_attached: null, count: 29 },
  { structure_type: '["Apartment"]', common_interest: null, property_attached: 1, count: 27 },
  { structure_type: "[]", common_interest: "Condo/Strata", property_attached: null, count: 26 },
  { structure_type: '["House"]', common_interest: "Condo/Strata", property_attached: 0, count: 18 },
  { structure_type: '["Modular"]', common_interest: null, property_attached: null, count: 16 },
  { structure_type: '["Row / Townhouse"]', common_interest: "Leasehold", property_attached: 1, count: 14 },
  { structure_type: '["House"]', common_interest: "Leasehold", property_attached: 1, count: 2 },
  { structure_type: '["House"]', common_interest: null, property_attached: 0, count: 1 },
  { structure_type: '["Mobile Home"]', common_interest: "Leasehold", property_attached: 0, count: 10 },
  { structure_type: '["Other"]', common_interest: null, property_attached: null, count: 9 },
  { structure_type: '["Apartment"]', common_interest: "Freehold", property_attached: 1, count: 6 },
  { structure_type: '["Other"]', common_interest: "Condo/Strata", property_attached: null, count: 6 },
  { structure_type: '["Apartment"]', common_interest: "Leasehold", property_attached: 1, count: 4 },
  { structure_type: '["House"]', common_interest: "Condo/Strata", property_attached: 1, count: 4 },
  { structure_type: '["Other"]', common_interest: "Leasehold", property_attached: null, count: 3 },
  { structure_type: "[]", common_interest: "Leasehold", property_attached: null, count: 3 },
  { structure_type: '["Duplex"]', common_interest: "Freehold", property_attached: 1, count: 1 },
];

function main() {
  return (async () => {
    const fs = require("fs");
    const src = fs.readFileSync(path.join(SRC_DIR, "db.js"), "utf8");
    const filtersMatch = src.match(/const PROPERTY_TYPE_FILTERS = \{([\s\S]*?)\n\};/);
    check("PROPERTY_TYPE_FILTERS block found in db.js", !!filtersMatch);
    const filtersBlock = filtersMatch[1];

    function extractClause(key) {
      const m = filtersBlock.match(new RegExp(`${key}: \`([^\`]*)\``));
      return m ? m[1] : null;
    }
    const condoClause = extractClause("condo");
    const townClause = extractClause("town");
    const semiClause = extractClause("semi");
    const detachedClause = extractClause("detached");
    check("condo clause extracted", !!condoClause);
    check("town clause extracted", !!townClause);
    check("semi clause extracted", !!semiClause);
    check("detached clause extracted", !!detachedClause);

    check(
      "semi/detached clauses use quote-anchored '\"House\"' match, NOT the old unsafe 'House' substring",
      semiClause.includes('"House"') && detachedClause.includes('"House"') &&
        !semiClause.includes("LIKE '%House%'") && !detachedClause.includes("LIKE '%House%'")
    );
    check(
      "town clause requires common_interest IN (Freehold, Leasehold) -- excludes condo townhouses",
      /common_interest IN \('Freehold','Leasehold'\)/.test(townClause)
    );
    check(
      "semi/detached clauses explicitly exclude Condo/Strata",
      semiClause.includes("!= 'Condo/Strata'") && detachedClause.includes("!= 'Condo/Strata'")
    );

    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE listings (
      listing_key TEXT PRIMARY KEY,
      structure_type TEXT,
      common_interest TEXT,
      property_attached INTEGER
    )`);
    const insert = db.prepare(
      "INSERT INTO listings (listing_key, structure_type, common_interest, property_attached) VALUES (?, ?, ?, ?)"
    );
    let seq = 0;
    for (const combo of PRODUCTION_COMBOS) {
      for (let i = 0; i < combo.count; i++) {
        insert.run(`L${seq++}`, combo.structure_type, combo.common_interest, combo.property_attached);
      }
    }
    const totalSeeded = seq;
    check(`seeded ${totalSeeded} rows (all well-defined production combos)`, totalSeeded === 11530);

    function countMatching(clause) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM listings WHERE ${clause}`).get();
      return row.cnt;
    }

    const condoCount = countMatching(condoClause);
    const townCount = countMatching(townClause);
    const semiCount = countMatching(semiClause);
    const detachedCount = countMatching(detachedClause);

    console.log(`\n  Measured against seeded production data: condo=${condoCount} town=${townCount} semi=${semiCount} detached=${detachedCount}`);

    check(
      "FIXED: 'semi' filter does NOT match Row/Townhouse rows anymore (was 2,565 false matches)",
      countMatching(`(${semiClause}) AND structure_type LIKE '%Townhouse%'`) === 0
    );

    const condoTownOverlap = countMatching(`(${condoClause}) AND (${townClause})`);
    check(
      "FIXED: zero listings match BOTH 'condo' and 'town' simultaneously (was 1,305 overlapping)",
      condoTownOverlap === 0,
      `overlap count: ${condoTownOverlap}`
    );

    const pairs = [
      ["condo", condoClause, "semi", semiClause],
      ["condo", condoClause, "detached", detachedClause],
      ["town", townClause, "semi", semiClause],
      ["town", townClause, "detached", detachedClause],
      ["semi", semiClause, "detached", detachedClause],
    ];
    for (const [nameA, clauseA, nameB, clauseB] of pairs) {
      const overlap = countMatching(`(${clauseA}) AND (${clauseB})`);
      check(`'${nameA}' and '${nameB}' are mutually exclusive (zero overlap)`, overlap === 0, `overlap: ${overlap}`);
    }

    check("condo count matches audit (3,559)", condoCount === 3559, `got ${condoCount}`);
    check("town count matches audit (1,260)", townCount === 1260, `got ${townCount}`);
    check("semi count matches full real data (417)", semiCount === 417, `got ${semiCount}`);
    check("detached count includes the NULL-folded rows (6,108 -- measured directly via SQL, authoritative over manual arithmetic)", detachedCount === 6108, `got ${detachedCount}`);

    const caseSql = `CASE
        WHEN ${condoClause} THEN 'condo'
        WHEN ${townClause} THEN 'town'
        WHEN ${semiClause} THEN 'semi'
        WHEN ${detachedClause} THEN 'detached'
        ELSE NULL
      END`;
    const derivedCounts = db.prepare(
      `SELECT ${caseSql} as t, COUNT(*) as cnt FROM listings GROUP BY t`
    ).all();
    const derivedMap = Object.fromEntries(derivedCounts.map((r) => [r.t ?? "null", r.cnt]));
    check(
      "derived_property_type CASE produces the same counts as the individual filters (no drift possible by construction)",
      derivedMap.condo === condoCount && derivedMap.town === townCount &&
        derivedMap.semi === semiCount && derivedMap.detached === detachedCount,
      JSON.stringify(derivedMap)
    );

    const dbSrc = fs.readFileSync(path.join(SRC_DIR, "db.js"), "utf8");
    check("getListingsByCity's SELECT includes derived_property_type", /derivedTypeCase/.test(dbSrc) && /derived_property_type/.test(dbSrc));
    check("returned listing object exposes propertyType", /propertyType: row\.derived_property_type/.test(dbSrc));

    console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  })();
}

main();
