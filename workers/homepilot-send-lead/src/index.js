var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var ALLOWED_ORIGIN = "https://myhomepilot.ca";
var DESTINATION_EMAIL = "stakharrealty@gmail.com";
var FROM_EMAIL = "leads@myhomepilot.ca";
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
function escapeHtml(str) {
  if (str === void 0 || str === null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(escapeHtml, "escapeHtml");
function buildEmailHtml(lead) {
  const matches = Array.isArray(lead.topMatches) ? lead.topMatches : [];
  const matchRows = matches.map(
    (m) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(
      m.city
    )}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(
      m.type
    )}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(
      m.price
    )}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;">${escapeHtml(
      m.monthlyCost
    )}</td></tr>`
  ).join("");
  return `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;">
    <h2 style="margin-bottom:4px;">New HomePilot Lead</h2>
    <p style="color:#666;margin-top:0;">${(/* @__PURE__ */ new Date()).toISOString()}</p>

    <h3>Contact</h3>
    <p>
      <strong>Name:</strong> ${escapeHtml(lead.name)}<br/>
      <strong>Email:</strong> ${escapeHtml(lead.email)}<br/>
      <strong>Phone:</strong> ${escapeHtml(lead.phone)}<br/>
      <strong>Renting or Own:</strong> ${escapeHtml(lead.status)}<br/>
      <strong>Timeline:</strong> ${escapeHtml(lead.timeline)}
    </p>

    <h3>Financial Profile</h3>
    <p>
      <strong>Income:</strong> ${escapeHtml(lead.income)}<br/>
      <strong>Down payment:</strong> ${escapeHtml(lead.downPayment)}<br/>
      <strong>Monthly debt:</strong> ${escapeHtml(lead.debt)}<br/>
      <strong>Family size:</strong> ${escapeHtml(lead.familySize)}<br/>
      <strong>First-time buyer:</strong> ${escapeHtml(lead.firstTimeBuyer)}<br/>
      <strong>Mortgage rate used:</strong> ${escapeHtml(lead.mortgageRate)}
    </p>

    <h3>Work / Commute</h3>
    <p>
      <strong>Work city:</strong> ${escapeHtml(lead.workCity)}<br/>
      <strong>Work arrangement:</strong> ${escapeHtml(lead.workArrangement)}
    </p>

    <h3>Top Matches Shown To Buyer</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="text-align:left;padding:4px 8px;">City</th>
          <th style="text-align:left;padding:4px 8px;">Type</th>
          <th style="text-align:left;padding:4px 8px;">Price</th>
          <th style="text-align:left;padding:4px 8px;">Monthly Cost</th>
        </tr>
      </thead>
      <tbody>${matchRows || "<tr><td colspan=4 style='padding:8px;'>No matches recorded</td></tr>"}</tbody>
    </table>

    <p style="color:#999;font-size:12px;margin-top:24px;">
      Sent automatically by HomePilot (myhomepilot.ca)
    </p>
  </div>`;
}
__name(buildEmailHtml, "buildEmailHtml");
var index_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
    let lead;
    try {
      lead = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    }
    if (!lead || !lead.email || !lead.name) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields: name and email" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        }
      );
    }
    try {
      const html = buildEmailHtml(lead);
      const subject = `New HomePilot Lead: ${lead.name}`;
      const sendPayload = {
        to: DESTINATION_EMAIL,
        from: { email: FROM_EMAIL, name: "HomePilot" },
        subject,
        html
      };
      if (lead.email) {
        sendPayload.replyTo = { email: lead.email, name: lead.name ? String(lead.name) : "" };
      }
      await env.SEND_EMAIL.send(sendPayload);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    } catch (err) {
      console.error("send-lead error:", err && err.message ? err.message : err);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Failed to send email. Please try again.",
          debug: err && err.message ? err.message : String(err)
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
        }
      );
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
