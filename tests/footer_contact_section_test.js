// Footer Contact section test (added 2026-09-16).
//
// Verifies the footer on index.html and calculator.html includes a
// dedicated Contact column (phone click-to-call, email mailto, brokerage
// name/branch, office address, RECO registration #), and that the same
// details were appended to the trademark disclosure paragraph.
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

  // ── Trademark disclosure paragraph updated with the same details ──
  const disclosureMatch = content.match(
    /<p class="ft-trademark-text">([\s\S]*?)<\/p>/
  );
  check(`${name}: trademark disclosure paragraph found`, !!disclosureMatch);
  if (disclosureMatch) {
    const disclosure = disclosureMatch[1];
    check(
      `${name}: disclosure includes Caledon Branch office address`,
      /16069 Airport Rd Unit 1, Caledon Village, ON L7C 1G4/.test(disclosure)
    );
    check(
      `${name}: disclosure includes RECO registration number`,
      /RECO Registration #5035266/.test(disclosure)
    );
    check(
      `${name}: disclosure includes click-to-call phone link`,
      /<a href="tel:\+14167258087">\(416\) 725-8087<\/a>/.test(disclosure)
    );
    check(
      `${name}: disclosure includes mailto email link`,
      /<a href="mailto:stakharrealty@gmail\.com">stakharrealty@gmail\.com<\/a>/.test(
        disclosure
      )
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
