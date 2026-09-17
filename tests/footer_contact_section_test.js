// Footer Contact section test (added 2026-09-16; updated repeatedly the
// same day as the footer trademark/disclosure area layout evolved):
//   1. Added a dedicated Contact column.
//   2. Two-column trademark/disclosure layout (paragraph + logos+info
//      side by side), then simplified.
//   3. Agent info block moved to the bottom-right of the footer.
//   4. RE/MAX + CREA + REALTOR® logos moved to sit full width above the
//      trademark paragraph.
//   5. Agent info block moved back up to sit beside the trademark
//      paragraph on the same row (.ft-tm-row), in the open space to its
//      right -- out of the .ft-bottom row entirely, clear of the
//      copyright line and the on-page WhatsApp widget.
//   6. The Contact column's detail lines (phone/email/brokerage/address/
//      RECO#) were removed, leaving just the "Contact" heading -- that
//      contact info now lives solely in the .ft-tm-info block beside the
//      trademark paragraph (name/brokerage/phone/RECO#; no address or
//      email there either, by design).
//
// Verifies the footer on index.html and calculator.html includes:
//   1. A "Contact" column heading with NO detail lines under it (and no
//      mailto link anywhere in the footer, since email only ever lived
//      in that column).
//   2. The RE/MAX, CREA, and REALTOR® logos (.ft-trademark-logos) sitting
//      directly above the trademark paragraph, full width.
//   3. The exact trademark paragraph text, unchanged.
//   4. .ft-tm-row wraps the trademark paragraph and the agent info block
//      (name, brokerage, phone, RECO#) side by side, with the info block
//      AFTER the paragraph in DOM order (so it sits to its right) and
//      NOT inside .ft-bottom.
//   5. .ft-bottom contains only the copyright line.
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

  // ── Footer Contact column: heading only, detail lines removed ───────
  check(
    `${name}: footer has a "Contact" column title`,
    /<p class="ft-col-title">Contact<\/p>/.test(content)
  );
  const contactColMatch = content.match(
    /<p class="ft-col-title">Contact<\/p>([\s\S]*?)<\/div>/
  );
  check(`${name}: Contact column block found`, !!contactColMatch);
  if (contactColMatch) {
    const contactCol = contactColMatch[1];
    check(
      `${name}: Contact column has no .ft-contact-line detail rows (heading only)`,
      !/ft-contact-line/.test(contactCol)
    );
    check(
      `${name}: Contact column has no .ft-contact-reco line (heading only)`,
      !/ft-contact-reco/.test(contactCol)
    );
  }
  check(
    `${name}: no mailto link anywhere in the footer (email only ever lived in the removed Contact column)`,
    !/mailto:stakharrealty@gmail\.com/.test(content)
  );
  check(
    `${name}: office address text no longer appears anywhere (was only in the removed Contact column)`,
    !/16069 Airport Rd Unit 1, Caledon Village, ON L7C 1G4/.test(content)
  );
  check(
    `${name}: click-to-call phone link still present (now only via the .ft-tm-info block)`,
    /<a href="tel:\+14167258087">\(416\) 725-8087<\/a>/.test(content)
  );
  check(
    `${name}: RECO registration number still present (now only via the .ft-tm-info block)`,
    /RECO Registration #5035266/.test(content)
  );

  // ── Logos sit full-width above the trademark paragraph ─────────────
  const tmBlockMatch = content.match(
    /<div class="ft-trademark">([\s\S]*?)<\/div>\s*<div class="ft-bottom">/
  );
  check(`${name}: .ft-trademark block found`, !!tmBlockMatch);
  let tmBlock = "";
  if (tmBlockMatch) {
    tmBlock = tmBlockMatch[1];
    const logosIdx = tmBlock.indexOf('<div class="ft-trademark-logos">');
    const rowIdx = tmBlock.indexOf('<div class="ft-tm-row">');
    check(`${name}: .ft-trademark-logos row exists`, logosIdx !== -1);
    check(
      `${name}: logos row comes BEFORE .ft-tm-row (above the paragraph, not beside it)`,
      logosIdx !== -1 && rowIdx !== -1 && logosIdx < rowIdx
    );
  }

  // ── .ft-tm-row: paragraph + info block side by side ────────────────
  check(`${name}: .ft-tm-row wraps the paragraph + info block`, /<div class="ft-tm-row">/.test(content));
  const rowMatch = content.match(
    /<div class="ft-tm-row">([\s\S]*?)<\/div>\s*<\/div>\s*<p class="ft-disclaimer"/
  );
  check(`${name}: .ft-tm-row block found`, !!rowMatch);
  if (rowMatch) {
    const row = rowMatch[1];
    const paragraphIdx = row.indexOf('<p class="ft-trademark-text">');
    const infoIdx = row.indexOf('<div class="ft-tm-info">');
    check(
      `${name}: info block comes AFTER the paragraph in .ft-tm-row (sits to its right)`,
      paragraphIdx !== -1 && infoIdx !== -1 && paragraphIdx < infoIdx
    );
  }
  check(
    `${name}: no leftover .ft-tm-top / .ft-tm-right wrapper from an earlier layout`,
    !/ft-tm-top\b|ft-tm-right\b/.test(tmBlock)
  );

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

  // ── .ft-bottom holds ONLY the copyright line now ────────────────────
  const bottomMatch = content.match(
    /<div class="ft-bottom">([\s\S]*?)<\/div>\s*<\/footer>/
  );
  check(`${name}: .ft-bottom block found`, !!bottomMatch);
  if (bottomMatch) {
    check(
      `${name}: copyright line present in .ft-bottom`,
      /ft-copyright/.test(bottomMatch[1])
    );
    check(
      `${name}: info block is NOT in .ft-bottom anymore (moved up beside the paragraph)`,
      !/ft-tm-info/.test(bottomMatch[1])
    );
  }

  // ── Info block content: name (prominent), brokerage, phone, RECO# ──
  const infoMatch = content.match(/<div class="ft-tm-info">([\s\S]*?)<\/div>/);
  check(`${name}: .ft-tm-info block found`, !!infoMatch);
  if (infoMatch) {
    const info = infoMatch[1];
    const nameIdx = info.indexOf("Sandeep Takhar");
    const brokerageIdx = info.indexOf("RE/MAX Realty Specialists Inc., Brokerage");
    const phoneIdx = info.indexOf("tel:+14167258087");
    const recoIdx = info.indexOf("RECO Registration #5035266");
    check(`${name}: info block shows the agent name`, nameIdx !== -1);
    check(
      `${name}: name line uses the prominent .ft-tm-info-name style`,
      /<p class="ft-tm-info-line ft-tm-info-name">Sandeep Takhar<\/p>/.test(info)
    );
    check(
      `${name}: info block includes the brokerage name`,
      brokerageIdx !== -1
    );
    check(
      `${name}: info block includes click-to-call phone link`,
      /<a href="tel:\+14167258087">\(416\) 725-8087<\/a>/.test(info)
    );
    check(
      `${name}: info block includes RECO registration number`,
      recoIdx !== -1
    );
    check(
      `${name}: info block order is name, brokerage, phone, RECO#`,
      nameIdx !== -1 &&
        brokerageIdx !== -1 &&
        phoneIdx !== -1 &&
        recoIdx !== -1 &&
        nameIdx < brokerageIdx &&
        brokerageIdx < phoneIdx &&
        phoneIdx < recoIdx
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
