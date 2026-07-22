// Phase 3 (DDF) — $select field verification test for homepilot-listings.
//
// Why this exists: on 2026-07-21, DaysOnMarket and ListOfficeName were both
// added to $select without checking whether they actually exist on CREA's
// Property entity. Both errored in production ("Could not find a property
// named 'X' on type 'DDF.Core.Entities.Property'") — caught only by manually
// hitting /test after the fact. This test catches that BEFORE deploy, by
// checking every field named in the real source against a live /metadata
// response.
//
// NETWORK REQUIREMENT: this test makes a real HTTP call to the deployed
// Worker's public /metadata endpoint. It will NOT run in network-restricted
// sandboxes (this is expected — it's designed to run in CI, which has full
// internet access). If it can't reach the endpoint, it fails loudly rather
// than silently skipping, so a broken network in CI is never mistaken for
// a passing test.
//
// Run: node tests/listings_metadata_field_test.js

const fs = require("fs");
const path = require("path");

const QUERY_SRC = path.join(
  __dirname,
  "..",
  "workers",
  "homepilot-listings",
  "src",
  "query.js"
);
const METADATA_URL = "https://homepilot-listings.stakharrealty.workers.dev/metadata";

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

async function main() {
  const src = fs.readFileSync(QUERY_SRC, "utf8");

  // Extract the real $select field list. query.js builds this from a
  // SELECT_FIELDS array (module split, 2026-07-21) rather than a literal
  // string, so match that array directly.
  const selectMatch = src.match(/const SELECT_FIELDS\s*=\s*\[([\s\S]*?)\];/);
  check("SELECT_FIELDS array found in query.js", !!selectMatch);
  if (!selectMatch) {
    console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
    process.exit(1);
  }
  const selectedFields = [...selectMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  console.log(`  Fields to verify: ${selectedFields.join(", ")}`);

  // Fetch live metadata
  let xml;
  try {
    const resp = await fetch(METADATA_URL);
    check("metadata endpoint reachable", resp.ok, `status ${resp.status}`);
    xml = await resp.text();
  } catch (e) {
    check("metadata endpoint reachable", false, e.message);
    console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
    console.log(
      "NOTE: if this failed due to network restrictions (not a real 4xx/5xx), " +
        "this test is expected to only run in CI, not in offline/sandboxed environments."
    );
    process.exit(1);
  }

  check("metadata response is non-empty XML", xml.length > 100);

  // Find the Property EntityType block and extract its Property element names
  const propertyEntityMatch = xml.match(
    /<EntityType Name="Property"[\s\S]*?<\/EntityType>/
  );
  check("Property EntityType found in metadata", !!propertyEntityMatch);

  const entityBlock = propertyEntityMatch ? propertyEntityMatch[0] : "";
  const realFieldNames = new Set(
    [...entityBlock.matchAll(/<Property Name="([^"]+)"/g)].map((m) => m[1])
  );
  check(
    "Property entity has a non-trivial field list",
    realFieldNames.size > 10,
    `found ${realFieldNames.size} fields`
  );

  // The actual point of this test: every field we SELECT must be real
  for (const field of selectedFields) {
    check(
      `$select field "${field}" exists on Property entity`,
      realFieldNames.has(field)
    );
  }

  // Regression guard: the two fields that previously broke production must
  // never silently reappear in $select without this test catching it.
  const KNOWN_BAD_FIELDS = ["DaysOnMarket", "ListOfficeName"];
  for (const badField of KNOWN_BAD_FIELDS) {
    check(
      `previously-broken field "${badField}" is not in current $select`,
      !selectedFields.includes(badField)
    );
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();
