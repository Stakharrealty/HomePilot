// Footer Contact section test (added 2026-09-16; updated 2026-09-16 for the
// two-column trademark/disclosure layout; updated again 2026-09-16 to move
// the agent info block down to the bottom-right of the footer; updated
// again 2026-09-16 to move the RE/MAX + CREA + REALTOR® logos to sit full
// width above the trademark paragraph instead of beside it).
//
// Verifies the footer on index.html and calculator.html includes:
//   1. A dedicated Contact column (phone click-to-call, email mailto,
//      brokerage name/branch, office address, RECO registration #).
//   2. The RE/MAX, CREA, and REALTOR® logos (.ft-trademark-logos) sitting
//      directly above the trademark paragraph, full width -- not beside
//      it in a two-column layout.
//   3. The exact trademark paragraph text, unchanged.
//   4. The agent info block (name, phone, brokerage/branch, address,
//      RECO#) in .ft-bottom, right-aligned next to the copyright line on
//      desktop.
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

  // ── Logos sit full-width above the trademark paragraph ─────────────
  const tmBlockMatch = content.match(
    /<div class="ft-trademark">([\s\S]*?)<\/div>\s*<div class="ft-bottom">/
  );
  check(`${name}: .ft-trademark block found`, !!tmBlockMatch);
  if (tmBlockMatch) {
    const tmBlock = tmBlockMatch[1];
    const logosIdx = tmBlock.indexOf('<div class="ft-trademark-logos">');
    const paragraphIdx = tmBlock.indexOf('<p class="ft-trademark-text">');
    check(
      `${name}: .ft-trademark-logos row exists`,
      logosIdx !== -1
    );
    check(
      `${name}: logos row comes BEFORE the trademark paragraph (above it, not beside it)`,
      logosIdx !== -1 && paragraphIdx !== -1 && logosIdx < paragraphIdx
    );
    check(
      `${name}: no leftover .ft-tm-top / .ft-tm-right wrapper from the old side-by-side layout`,
      !/ft-tm-top|ft-tm-right/.test(tmBlock)
    );
  }

  const paragraphMatch = content.match(
    /<p class="ft-trademark-text">([\s\S]*?)<\/p>/
  );
  check(`${name}: trademark paragraph found`, !!paragraphMatch);
  if (paragraphMatch) {
    const EXPECTED_PARAGRAPH =
      "This site is operated by <strong>Sandeep Takhar</strong>, a REALTOR® with <strong>RE/MAX Realty Specialists Inc., Brokerage</strong>. REALTORS®, and the REALTOR® logo are certification marks owned by REALTOR® Canada Inc. and licensed exclusively to The Canadian Real Estate Association (CREA). These certification marks identify real estate professionals who are members of CREA and who must abide by CREA's By-Laws, Rules, and the REALTOR® Code. The MLS® trademark and the MLS® logo are owned by CREA and identify the quality of services provided by real estate professionals who are members of CREA.";
    check(
      `${name}: paragraph text is unchanged`,
      paragraphMatch[1] === EXPECTED_PARAGRAPH
    );
  }

  check(
    `${name}: RE/MAX logo present (invert/brightness filter via .ft-tm-logo)`,
    /alt="RE\/MAX Realty Specialists Inc\., Brokerage" class="ft-tm-logo"/.test(
      content
    )
  );
  check(
    `${name}: CREA logo present`,
    /alt="The Canadian Real Estate Association" class="ft-tm-logo"/.test(
      content
    )
  );
  check(
    `${name}: REALTOR® logo present`,
    /src="src\/assets\/realtor-r\.svg" alt="REALTOR® logo" class="ft-tm-logo"/.test(
      content
    )
  );

  // ── Agent info block lives in the footer bottom row, not by the logos ──
  const bottomMatch = content.match(
    /<div class="ft-bottom">([\s\S]*?)<\/div>\s*<\/footer>/
  );
  check(`${name}: .ft-bottom block found`, !!bottomMatch);
  if (bottomMatch) {
    check(
      `${name}: .ft-bottom contains the info block (bottom-right of the footer)`,
      /<div class="ft-tm-info">/.test(bottomMatch[1])
    );
    check(
      `${name}: copyright line still present in .ft-bottom`,
      /ft-copyright/.test(bottomMatch[1])
    );
  }

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
