// Footer Contact section test (added 2026-09-16, updated 2026-09-16 for the
// two-column trademark/disclosure layout).
//
// Verifies the footer on index.html and calculator.html includes:
//   1. A dedicated Contact column (phone click-to-call, email mailto,
//      brokerage name/branch, office address, RECO registration #).
//   2. A two-column trademark/disclosure area (.ft-tm-top): the exact
//      trademark paragraph on the left, and the RE/MAX + CREA logos plus
//      an info block (name, phone, brokerage/branch, address, RECO#) on
//      the right (.ft-tm-right), which stacks below the paragraph on
//      mobile via flex-direction.
//
// Run: node tests/footer_contact_section_test.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML_FILES = ["index.html", "calculator.html"].map((f) => ({
  name: f,
  content: fs.readFileSync(path.join(ROOT, f), "utf8"),
}));

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

for (const { name, content } of HTML_FILES) {
  console.log(`\n${name}`);

  // ── Footer Contact column ──────────────────────────────────────────
  check(
    `${name}: footer has a "Contact" column title`,
    /<p class="ft-col-title">Contact<\/p>/.test(content)
  );
  check(
    `${name}: click-to-call phone link (tel:+14167258087)`,
    /<a href="tel:\+14167258087">\(416\) 725-8087<\/a>/.test(content)
  );
  check(
    `${name}: mailto email link (stakharrealty@gmail.com)`,
    /<a href="mailto:stakharrealty@gmail\.com">stakharrealty@gmail\.com<\/a>/.test(
      content
    )
  );
  check(
    `${name}: brokerage name + Caledon Branch shown in contact column`,
    /RE\/MAX Realty Specialists Inc\., Brokerage &ndash; Caledon Branch/.test(
      content
    )
  );
  check(
    `${name}: office address shown in contact column`,
    /16069 Airport Rd Unit 1, Caledon Village, ON L7C 1G4/.test(content)
  );
  check(
    `${name}: RECO registration number shown in contact column`,
    /RECO Registration #5035266/.test(content)
  );

  // ── Two-column trademark/disclosure layout ─────────────────────────
  check(
    `${name}: .ft-tm-top wraps the paragraph + right-side block`,
    /<div class="ft-tm-top">/.test(content)
  );
  check(
    `${name}: .ft-tm-right holds the logos + info block`,
    /<div class="ft-tm-right">/.test(content)
  );

  const paragraphMatch = content.match(
    /<p class="ft-trademark-text">([\s\S]*?)<\/p>/
  );
  check(`${name}: trademark paragraph found`, !!paragraphMatch);
  if (paragraphMatch) {
    const EXPECTED_PARAGRAPH =
      "This site is operated by <strong>Sandeep Takhar</strong>, a REALTOR® with <strong>RE/MAX Realty Specialists Inc., Brokerage</strong>. REALTORS®, and the REALTOR® logo are certification marks owned by REALTOR® Canada Inc. and licensed exclusively to The Canadian Real Estate Association (CREA). These certification marks identify real estate professionals who are members of CREA and who must abide by CREA's By-Laws, Rules, and the REALTOR® Code. The MLS® trademark and the MLS® logo are owned by CREA and identify the quality of services provided by real estate professionals who are members of CREA.";
    check(
      `${name}: paragraph text matches exactly as specified (no phone/address/RECO baked in)`,
      paragraphMatch[1] === EXPECTED_PARAGRAPH
    );
  }

  check(
    `${name}: RE/MAX logo still present (invert/brightness filter via .ft-tm-logo)`,
    /alt="RE\/MAX Realty Specialists Inc\., Brokerage" class="ft-tm-logo"/.test(
      content
    )
  );
  check(
    `${name}: CREA logo still present`,
    /alt="The Canadian Real Estate Association" class="ft-tm-logo"/.test(
      content
    )
  );

  const infoMatch = content.match(
    /<div class="ft-tm-info">([\s\S]*?)<\/div>/
  );
  check(`${name}: .ft-tm-info block found`, !!infoMatch);
  if (infoMatch) {
    const info = infoMatch[1];
    check(`${name}: info block shows the agent name`, /Sandeep Takhar/.test(info));
    check(
      `${name}: info block includes click-to-call phone link`,
      /<a href="tel:\+14167258087">\(416\) 725-8087<\/a>/.test(info)
    );
    check(
      `${name}: info block includes Caledon Branch`,
      /RE\/MAX Realty Specialists Inc\., Brokerage &ndash; Caledon Branch/.test(
        info
      )
    );
    check(
      `${name}: info block includes office address`,
      /16069 Airport Rd Unit 1, Caledon Village, ON L7C 1G4/.test(info)
    );
    check(
      `${name}: info block includes RECO registration number`,
      /RECO Registration #5035266/.test(info)
    );
  }

  // Sanity: <style> block still well-formed after the CSS additions.
  const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
  check(`${name}: has a well-formed <style> block`, !!styleMatch);
  if (styleMatch) {
    const css = styleMatch[1];
    const opens = (css.match(/\{/g) || []).length;
    const closes = (css.match(/\}/g) || []).length;
    check(
      `${name}: <style> block has balanced braces (found ${opens} '{' and ${closes} '}')`,
      opens === closes
    );
  }
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
