// homepilot-send-lead — Cloudflare Worker
//
// RECONSTRUCTED July 20, 2026. This is NOT extracted from the live deployment —
// Cloudflare's dashboard does not expose source for Workers deployed via Wrangler
// CLI, and no local copy of this file could be found on Sandeep's computer. This
// version was rewritten from scratch based on the worker's known request/response
// contract, as encoded in the project's regression suite (tests/regression_suite.js,
// suite "LeadDelivery&Breakdown") and fragments of past session logs.
//
// CONFIDENCE: HIGH on the request contract (URL, method, exact payload field
// names/types — these are directly asserted by regression suite tests that must
// pass against the real client code). MEDIUM-LOW on the actual email-sending
// implementation below — the general approach (Cloudflare Email Sending binding +
// mimetext to build a raw MIME message) is the standard, documented pattern for
// this kind of worker, but the exact email formatting/subject line/body layout is
// a reasonable guess, not a verified match to what's actually deployed.
//
// Known request contract (from regression_suite.js):
//   POST https://homepilot-send-lead.stakharrealty.workers.dev
//   Body (JSON): { name, email, phone, status, timeline, income, downPayment,
//                  debt, workCity, mortgageRatePct, topMatches, workArrangement,
//                  firstTimeBuyer }
//   Success: HTTP 200, body {"ok":true}
//   Failure: either non-200 HTTP status, or HTTP 200 with {"ok":false,"error":...}
//            index.html's sub() function checks BOTH conditions before showing
//            the success screen (this was Bug 1's fix).
//
// Requires: `npm install mimetext` and a Cloudflare Email Sending binding named
// SEND_EMAIL, routed to stakharrealty@gmail.com (per project notes, the
// destination_address restriction in wrangler.jsonc was removed at one point
// after it caused delivery errors — left unset here for the same reason).

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

const ALLOWED_ORIGINS = ["https://myhomepilot.ca", "https://www.myhomepilot.ca"];
const DESTINATION = "stakharrealty@gmail.com";
const FROM_ADDRESS = "leads@myhomepilot.ca";

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function buildEmailBody(lead) {
  const matches = Array.isArray(lead.topMatches)
    ? lead.topMatches.map((m) => `  - ${m.city || m.n || "Unknown"}: ${m.type || ""} ${m.price ? "$" + m.price : ""}`).join("\n")
    : "  (none)";

  return `New HomePilot lead

Name: ${lead.name || ""}
Email: ${lead.email || ""}
Phone: ${lead.phone || ""}
Current status: ${lead.status || ""}
Timeline: ${lead.timeline || ""}

Income: ${lead.income ?? ""}
Down payment: ${lead.downPayment ?? ""}
Existing debt: ${lead.debt ?? ""}
First-time buyer: ${lead.firstTimeBuyer ?? ""}

Work city: ${lead.workCity || ""}
Work arrangement: ${lead.workArrangement || ""}
Mortgage rate used: ${lead.mortgageRatePct || ""}%

Top matched cities:
${matches}
`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);
    }

    let lead;
    try {
      lead = await request.json();
    } catch (err) {
      return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
    }

    if (!lead.name || !lead.email) {
      return jsonResponse({ ok: false, error: "missing_required_fields" }, 400, origin);
    }

    try {
      const msg = createMimeMessage();
      msg.setSender({ name: "HomePilot Leads", addr: FROM_ADDRESS });
      msg.setRecipient(DESTINATION);
      msg.setSubject(`New HomePilot lead: ${lead.name}`);
      msg.addMessage({
        contentType: "text/plain",
        data: buildEmailBody(lead),
      });

      const emailMessage = new EmailMessage(FROM_ADDRESS, DESTINATION, msg.asRaw());
      await env.SEND_EMAIL.send(emailMessage);

      return jsonResponse({ ok: true }, 200, origin);
    } catch (err) {
      return jsonResponse({ ok: false, error: err && err.message ? err.message : "send_failed" }, 502, origin);
    }
  },
};
