// ai.js — HomePilot AI city insights
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/ai.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: toggleAiInsights() (collapse/expand the AI insights box — a
// separate, dedicated toggle from the card's own expand/collapse, by design)
// and fetchCityInsights() (builds the prompt client-side, including the
// content guardrails — no exact commute times, no crime claims, no school
// rankings, no price predictions, no demographic/ethnic framing — then calls
// the homepilot-insights Worker, which proxies to Anthropic and returns the
// response as-is for parsing here).

function toggleAiInsights(cityId,cityName){
  const aiBox=document.getElementById("ai-"+cityId);
  const chevron=document.getElementById("ai-trigger-chevron-"+cityId);
  if(!aiBox)return;
  const isOpen=aiBox.style.display!=="none";
  if(isOpen){
    aiBox.style.display="none";
    if(chevron)chevron.style.transform="rotate(0deg)";
    return;
  }
  aiBox.style.display="block";
  if(chevron)chevron.style.transform="rotate(90deg)";
  if(aiBox.dataset.loaded!=="true"){
    aiBox.innerHTML='<div class="ai-loading"><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div><div class="ai-loading-dot"></div>'+
      '<span>Getting your personalized city insights...</span></div>';
    fetchCityInsights(cityId,cityName);
  }
}

async function fetchCityInsights(cityId,cityName){
  const aiBox=document.getElementById("ai-"+cityId);
  if(!aiBox||aiBox.dataset.loaded==="true")return;

  const annualIncome=grossMonthlyIncome*12;
  const tier=getBuyerTier(annualIncome);
  const tierLabel=tier===3?"high income ($300K+)":tier===2?"comfortable income ($150K-$300K)":"budget-conscious ($80K-$150K)";
  const bp=buyPower;

  const prompt=`You are a straightforward Canadian real estate advisor helping a GTA homebuyer evaluate ${cityName}, Ontario.

Buyer profile:
- Annual income: $${Math.round(annualIncome).toLocaleString()}
- Buying power: $${Math.round(bp).toLocaleString()}
- Buyer type: ${tierLabel}
- Note: All prices in HomePilot reflect TYPICAL ENTRY prices (40th-50th percentile of current listings), not floor prices. This is what the buyer actually needs to spend.

Generate exactly 3 sections in this JSON format. Be specific and honest, not generic marketing language. Use real, well-known facts about ${cityName} where you're confident of them.

STRICT RULES - do not violate these, they are non-negotiable:
- NEVER state an exact commute time or drive time in minutes. Commute is handled elsewhere in this app using real data - do not estimate or invent one.
- NEVER make claims about crime, safety levels, or "how safe" an area is. This requires real, sourced, current data you do not have.
- NEVER rank or rate schools, or claim schools are "good", "excellent", or "top-tier". This requires real, sourced data you do not have.
- NEVER predict future home price appreciation, market performance, or describe an area as an "investment opportunity". This is financial speculation you are not qualified to make and creates real liability.
- NEVER describe a neighborhood's desirability in terms of the ethnic, cultural, or religious composition of its residents. This is never relevant to affordability or livability and must not appear in any section.
- NEVER state specific population or demographic statistics you cannot verify.

Return ONLY valid JSON, no markdown, no explanation:
{
  "whyBuyers": "2-3 sentences on practical, concrete reasons buyers choose ${cityName} - e.g. more space for the money, housing stock type, proximity to amenities. Avoid generic phrases like 'family-friendly' or 'growing community' without specifics.",
  "tradeOffs": "2-3 sentences of honest trade-offs a buyer should know - e.g. fewer transit options, distance from downtown amenities, older housing stock. Do not sugarcoat, but stay within the strict rules above.",
  "lifestyleSnapshot": "3-5 short lifestyle tags separated by ' · ', chosen from concrete, observable categories only - e.g. 'Suburban · Car-dependent · Newer subdivisions' or 'Urban · Walkable core · Established neighborhood'. Not marketing copy, not demographic claims."
}`;

  try{
    const res=await fetch("https://homepilot-insights.stakharrealty.workers.dev",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({prompt:prompt})
    });
    const data=await res.json();
    const raw=data.content.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
    const parsed=JSON.parse(raw);
    // Access to Work — deliberately NOT part of the AI prompt. Sourced directly from
    // the same real drive-time data used everywhere else on the card, so this line
    // can never invent a commute figure the way a freeform AI section could.
    const cm = workArrangement==='remote' ? null : calcCommuteMinutes(cityName);
    const commuteTier = getAccessTier(cm);
    const ACCESS_NOTE = {
      'Excellent Commute':'Well suited to a daily commute',
      'Good Commute':'Manageable for a daily commute',
      'Moderate Commute':'Better suited to hybrid or flexible schedules',
      'Limited Commute':'A long daily drive — worth weighing against hybrid or remote roles'
    };
    const accessHtml = !commuteTier
      ? '<div class="ai-section ai-commute"><div class="ai-section-header">🚗 Access to Work</div><div class="ai-section-body">Not a factor — remote work.</div></div>'
      : '<div class="ai-section ai-commute"><div class="ai-section-header">🚗 Access to Work</div><div class="ai-section-body"><strong>'+commuteTier.label+'</strong> — '+(ACCESS_NOTE[commuteTier.label]||'')+'</div></div>';

    aiBox.innerHTML=
      '<div class="ai-section ai-positive"><div class="ai-section-header">✅ Why buyers choose this city</div><div class="ai-section-body">'+parsed.whyBuyers+'</div></div>'+
      '<div class="ai-section ai-negative"><div class="ai-section-header">⚠️ Trade-offs to know</div><div class="ai-section-body">'+parsed.tradeOffs+'</div></div>'+
      accessHtml+
      '<div class="ai-section ai-family"><div class="ai-section-header">📍 Lifestyle snapshot</div><div class="ai-section-body">'+parsed.lifestyleSnapshot+'</div></div>'+
      '<div style="font-size:11px;color:#999;margin-top:10px;line-height:1.5">These observations are generated from HomePilot\'s city profiles and affordability analysis. They\'re intended to help compare cities and should be used alongside your own research.</div>';
    aiBox.dataset.loaded="true";
  }catch(e){
    aiBox.innerHTML='<div style="font-size:12px;color:#c0392b;padding:12px;background:#fdf0ee;border-radius:8px">Could not load city insights. Please try again.</div>';
    console.error("AI insights error:",e);
  }
}
