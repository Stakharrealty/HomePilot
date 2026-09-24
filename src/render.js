// render.js — HomePilot card rendering
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules) — the final, most tightly-coupled piece of
// the split. Loaded via <script src="src/render.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: render() (draws the results from rankCities() in ranking.js:
// since 2026-09-24 the three answer cards, then "See all places", drawn by
// renderSeeAll() and opened by toggleSeeAll()), the card builder it uses, and
// selectPropType() (per-property-type panel expansion). They read shared
// global state (results, activeProp, buyPower, workArrangement, etc.)
// declared in main.js — safe because these are function
// declarations, not executed until called, by which point every script has
// fully loaded in both a real browser and this project's test harness.
//
// REWRITTEN 2026-09-23 (IMPROVEMENT_PLAN.md 1.2, 1.4, 1.5). render() no longer
// scores or orders anything itself; rankCities() does, for every consumer.
// What changed on screen:
//   - The main list holds only cities with a home the buyer can comfortably
//     afford, in the order of the one rule. "N cities match your budget"
//     counts only those (REVIEW_BACKLOG.md P1-5); cities where everything is a
//     stretch get their own section below instead of padding the count.
//   - Cities past the buyer's commute limit are set aside with a note ("8
//     hidden — estimated drive over 60 min. Show them"), never ranked.
//   - Each card states the home it recommends (type, price, monthly cost, % of
//     take-home), which is exactly what shownCards records for the PDF
//     report and Compare.
//   - The commute shows as an estimated drive in minutes, not a tier; the
//     orange "Limited Commute ... long daily drive" box is gone, because the
//     buyer has now said how long a drive they accept.
//   - The property list uses getFit() for its labels and full qualification
//     for which types appear (P1-21): it used its own <35 / <=45 thresholds and
//     checked only the minimum down payment, so a home at 45.3% was "Good" in
//     the list and "Stretch" everywhere else, and a type could appear that
//     failed qualification.

// The Great / Good / Stretch colours, from getFit()'s class. One table, used by
// the card, the property list and the breakdown panel.
const FIT_STYLE = {
  fg: { color: '#085041', bg: '#E1F5EE' },
  fo: { color: '#0C447C', bg: '#E6F1FB' },
  fs: { color: '#633806', bg: '#FAEEDA' },
};

function fitPill(fit) {
  const s = FIT_STYLE[fit.cls] || FIT_STYLE.fo;
  return '<span class="fit-pill" style="background:' + s.bg + ';color:' + s.color + '">' + fit.lbl + '</span>';
}

// ── The results since 2026-09-24 (IMPROVEMENT_PLAN.md 2.2) ──────────────────
// Three answers, then "See all places", in the order the user decided:
//   1. the count and the notes (places set aside, and why);
//   2. three answer cards, #answers: Most home, Shortest commute, Lowest
//      monthly cost (answerPicks(), ranking.js). They are today's cards,
//      exactly as cityCardHtml() draws them, each under a small label; side by
//      side on a computer, stacked on a phone (CSS in calculator.html);
//   3. #worthKnowing: HomePilot Worth Knowing (worth-knowing.js), one or two
//      trade-offs worth knowing, or nothing when none is worth it;
//   4. "See all places", closed until the buyer opens it: the rest of the
//      places in the same big cards, ordered by most home unless the buyer
//      picks another order there, then the "Only as a stretch" and "Past your
//      commute limit" sections. It replaced the sort switch above the list.
// "The rest" leaves out the homes the answer cards already show (same place,
// same home type), so no card appears twice. A place can still show twice
// with a different home, as it can among the answers.
// When nothing within the commute limit is comfortable (IMPROVEMENT_PLAN.md
// 2.0, 2026-09-24), the page is not empty. The count line is the heading,
// "Nothing within 60 minutes fits your HomePilot comfort range yet, but you're
// close." (wkEmptyHeading()); #answers holds the three closest options -- the
// lowest % of take-home within the limit, rankCities()'s stretch-only list --
// in the same three-across layout, today's stretch cards, each labelled
// "Closest to fitting · Stretch" (or "· Above your HomePilot comfort range"
// when the card's own pill is not Stretch); then HomePilot Worth Knowing, one tip per
// lever; then "See all places" with the other stretch-only places and, when
// asked for, those past the limit.

// What render() drew above "See all places": renderSeeAll() draws that part
// again on its own when the buyer opens it, closes it or re-sorts it, so an
// answer card the buyer has open stays open.
let answersView = null;

// The empty page shows this many of the closest options (IMPROVEMENT_PLAN.md
// 2.0), in the answer cards' three-across layout.
const CLOSEST_CARDS = 3;

// Card ids. Everything on a card (its breakdowns, AI Insights, the compare
// box) hangs off its id, 'c-' + the place. A place can now have two cards on
// the page, so the first keeps the plain id and a later one gets '__2', '__3'
// ('_' never occurs in the plain id). `seen` carries the count on from the
// answer cards to "See all places".
function cardIdMaker(seen){
  const counts=Object.assign({},seen||{});
  const next=(name)=>{
    const base='c-'+name.replace(/[^a-zA-Z0-9]/g,'-');
    counts[base]=(counts[base]||0)+1;
    return counts[base]===1?base:base+'__'+counts[base];
  };
  next.counts=counts;
  return next;
}

// One card's line in shownCards: the figures on it, which part of the page it
// is in, and its id (Compare finds the ticked card by it).
function shownCardOf(e,section,cardId,extra){
  return Object.assign({city:e.n,type:e.type,price:e.price,monthlyCost:e.costs.total,pctOfTakeHome:e.pct,commuteMin:e.commuteMin,fit:e.fit.lbl,section,cardId},extra||{});
}

function render(){
  const onlyType=activeProp!=='all'?activeProp:null;
  // The three answers. byHome is also the page's count: every order ranks the
  // same places, sets aside the same ones and finds the same stretch-only ones.
  const answers=answerPicks(results,{maxCommute:maxCommuteMin,onlyType});
  const byHome=answers.byHome;
  const {ranked,stretchOnly,overCommute}=byHome;
  const visibleOver=showOverCommute?overCommute:[];
  const noAnswers=!ranked.length;
  // HomePilot Worth Knowing (worth-knowing.js, calculator.html only): its
  // tips, and on the empty page whether the buyer is close.
  const wk=typeof worthKnowing==='function'?worthKnowing(answers,onlyType):null;
  // The empty page's closest options: the stretch-only places within the
  // limit, lowest monthly cost -- so lowest % of take-home -- first.
  const closest=noAnswers?stretchOnly.slice(0,CLOSEST_CARDS):[];

  // The results count is set HERE, not in go() (moved 2026-09-22, audit), and
  // since 2026-09-23 it counts only cities with a home the buyer can
  // comfortably afford (REVIEW_BACKLOG.md P1-5). It used to count every city
  // with any option, so "38 cities match your budget" included cities where
  // every option was a Stretch.
  // When nothing within the limit is comfortable it is the empty page's
  // heading (2.0): "Nothing within 60 minutes fits your HomePilot comfort
  // range yet, but you're close." Places further out that fit, and what
  // would get the buyer there, are HomePilot Worth Knowing's tips.
  const overComfortable=overCommute.filter(e=>e.comfortable).length;
  // "a home", or with a home type picked "a condo", "a detached home" (WK_TYPE,
  // worth-knowing.js; it read "a detached").
  const typeWord=activeProp==='all'?'a home':'a '+((typeof WK_TYPE!=='undefined'&&WK_TYPE[activeProp])||(PROP_LABELS[activeProp]||'home').toLowerCase());
  // "Cities you can afford" heads the list; on the empty page the count line is
  // the heading ("Nothing within 60 minutes fits ... yet"), and the title
  // above it said the opposite, so it steps aside there (2026-09-24).
  const titleEl=document.getElementById('resTitle');
  if(titleEl) titleEl.style.display=noAnswers?'none':'';
  const cntEl=document.getElementById('cnt');
  if(cntEl){
    const n=ranked.length;
    cntEl.innerHTML=n
      ?'<span>'+n+' '+(n===1?'city':'cities')+'</span> with '+typeWord+' that fits your HomePilot comfort range — tap a city for the full monthly breakdown'
      :(typeof wkEmptyHeading==='function'?wkEmptyHeading(wk||{limit:byHome.limit,onlyType,close:false}):'');
  }

  // What was set aside and why. The rule sentence ("Ranked by ...") went into
  // "See all places" with the order it describes (renderSeeAll()).
  const notesEl=document.getElementById('rankNotes');
  if(notesEl){
    const notes=[];
    const cityWord=(k)=>k===1?'city works':'cities work';
    if(stretchOnly.length&&!noAnswers) notes.push(stretchOnly.length+' more '+cityWord(stretchOnly.length)+' only as a stretch — listed under "See all places", after the others.');
    // The empty page: the closest of them are the cards below.
    else if(stretchOnly.length) notes.push(stretchOnly.length+' '+cityWord(stretchOnly.length)+' only as a stretch — '+(stretchOnly.length>closest.length?'the closest '+closest.length+' are below, the rest under "See all places".':(stretchOnly.length===1?'it is':'all are')+' below.'));
    if(byHome.limit!==null&&overCommute.length) notes.push(overCommute.length+' '+(overCommute.length===1?'city':'cities')+' hidden — estimated drive over '+byHome.limit+' min'+(overComfortable?' ('+overComfortable+' with '+typeWord+' that fits your HomePilot comfort range)':'')+'. <button type="button" class="link-btn" onclick="toggleOverCommute()">'+(showOverCommute?'Hide them':'Show them')+'</button>');
    if((workArrangement==='hybrid'||workArrangement==='daily')&&!workZone) notes.push("We couldn't place your work location, so commute isn't used below. Check the work city or postal code.");
    notesEl.innerHTML=notes.map(x=>'<div class="rank-note">'+x+'</div>').join('');
    notesEl.style.display=notes.length?'':'none';
  }

  // The answer cards: cityCardHtml() exactly as every other card, under the
  // label of the question (or questions) it answers. On the empty page, the
  // closest options instead: today's stretch card (the one "Only as a
  // stretch" shows), labelled Stretch or above the HomePilot comfort range.
  const nextId=cardIdMaker();
  const shown=[];
  const slot=(answersAttr,label,e,section,id)=>'<div class="answer-slot" data-answers="'+answersAttr+'">'+
    '<div class="answer-label">'+label+'</div>'+cityCardHtml(e,section,id)+'</div>';
  // A closest option is not comfortable, but not always Stretch: a home under
  // 45% of take-home is one only because its price is above the HomePilot
  // comfort range, and its own pill says Good Fit. The label says which
  // (2026-09-24); it said "Stretch" on every one, over a "Good Fit" pill,
  // and it did not change when the buyer typed their own take-home.
  const closestLabel=(e)=>'Closest to fitting · '+(e.fit.cls==='fs'?'Stretch':'Above your HomePilot comfort range');
  const slots=noAnswers
    ?closest.map(e=>{
      const id=nextId(e.n);
      shown.push(shownCardOf(e,'answer-closest',id,{answers:['closest']}));
      return slot('closest',closestLabel(e),e,'stretch',id);
    })
    :answers.picks.map(p=>{
      const id=nextId(p.entry.n);
      shown.push(shownCardOf(p.entry,'answer-'+p.answers[0],id,{answers:p.answers.slice()}));
      // Each question on one line (.answer-q), so a two-question label wraps at
      // the dot, never mid-phrase ("...MONTHLY / COST").
      return slot(p.answers.join(' '),p.answers.map(q=>'<span class="answer-q">'+ANSWER_LABELS[q]+'</span>').join(' · '),p.entry,'ranked',id);
    });
  const answersEl=document.getElementById('answers');
  if(answersEl) answersEl.innerHTML=slots.length?'<div class="answer-grid answer-grid-'+slots.length+'">'+slots.join('')+'</div>':'';
  // HomePilot Worth Knowing, between the answers and "See all places".
  const wkEl=document.getElementById('worthKnowing');
  if(wkEl) wkEl.innerHTML=typeof worthKnowingHtml==='function'?worthKnowingHtml(wk):'';
  const topHomes=noAnswers?closest:answers.picks.map(p=>p.entry);
  answersView={onlyType,answerHomes:new Set(topHomes.map(homeKey)),answerPlaces:new Set(topHomes.map(e=>e.n)),shown,idCounts:nextId.counts};
  renderSeeAll();

  const rateBarEl=document.getElementById('rateBar');
  const shareBarEl=document.getElementById('shareBar');
  const anyCards=ranked.length+stretchOnly.length+visibleOver.length>0;
  if(!anyCards){
    if(rateBarEl) rateBarEl.style.display='none';
    if(shareBarEl) shareBarEl.style.display='none';
    return;
  }
  // Show rate bar and sync its inputs to current rate
  if(shareBarEl){ shareBarEl.style.display='flex'; }
  if(rateBarEl) {
    rateBarEl.style.display='block';
    const currentPct = (customMortgageRate * 100).toFixed(2);
    const sliderEl = document.getElementById('rateSlider');
    const inputEl  = document.getElementById('rateInput');
    if(sliderEl) sliderEl.value = currentPct;
    if(inputEl)  inputEl.value  = currentPct;
    const hintEl = document.getElementById('rateHint');
    if(hintEl) hintEl.textContent = parseFloat(currentPct) === DEFAULT_MORTGAGE_RATE_PCT ? 'Current market rate' : '';
  }
}

// "See all places": its button, and when open its sort control, the rule in
// force, the rest of the places (#list) and the two sections below them
// (#listMore). Cards are drawn only while it is open, so shownCards -- the
// record the PDF report and Compare are built from -- is always exactly the
// cards on screen.
function renderSeeAll(){
  const v=answersView;
  if(!v) return;
  const ranking=rankCities(results,{sort:resultsSort,maxCommute:maxCommuteMin,onlyType:v.onlyType});
  const {ranked,overCommute}=ranking;
  const visibleOver=showOverCommute?overCommute:[];
  // The cards above (the answers, or on the empty page the closest options)
  // are left out, so no card shows twice.
  const rest=ranked.filter(e=>!v.answerHomes.has(homeKey(e)));
  const stretchOnly=ranking.stretchOnly.filter(e=>!v.answerHomes.has(homeKey(e)));
  const noAnswers=!ranked.length;
  const hasMore=rest.length+stretchOnly.length+visibleOver.length>0;
  // Closed until the buyer opens it, on the empty page too (2.0): its cards
  // are the stretch-only places after the closest three, and the places past
  // the limit when asked for. The count is of the places it adds: the
  // comfortable ones, or on the empty page the stretch-only ones. Places, not
  // cards (2026-09-24): an answer place can come back here with another home
  // (Scarborough's detached, when its condo is the Lowest monthly cost
  // answer), and counting that card made "3 answers + 8 more" against "10
  // cities" on the count line.
  const open=seeAllOpen;
  const moreCount=new Set((noAnswers?stretchOnly:rest).map(e=>e.n).filter(n=>!v.answerPlaces.has(n))).size;

  const btn=document.getElementById('seeAllBtn');
  if(btn){
    btn.style.display=hasMore?'':'none';
    btn.textContent=open?'Hide the other places':'See all places'+(moreCount?' ('+moreCount+' more)':'');
    btn.setAttribute('aria-expanded',String(open));
  }
  const body=document.getElementById('seeAllBody');
  if(body) body.style.display=open&&hasMore?'block':'none';

  // The order: most home unless the buyer picked another here. "Shortest
  // commute" only exists when there is a commute to sort by.
  const withSort=open&&!noAnswers&&(rest.length>1||ranking.sort!=='home');
  const sortEl=document.getElementById('seeAllSort');
  if(sortEl) sortEl.style.display=withSort?'block':'none';
  RESULT_SORTS.forEach(s=>{
    const b=document.getElementById('seeAllSort-'+s);
    if(!b) return;
    if(b.classList) b.classList.toggle('on', s===ranking.sort);
    if(s==='commute') b.style.display=ranking.commuteKnown?'':'none';
  });
  const ruleEl=document.getElementById('seeAllRule');
  if(ruleEl){
    ruleEl.innerHTML=withSort?'<div class="rank-rule">'+rankRuleSentence(ranking.sort,ranking.commuteKnown)+'</div>':'';
    ruleEl.style.display=withSort?'':'none';
  }

  const nextId=cardIdMaker(v.idCounts);
  const drawn=[];
  const card=(e,section)=>{ const id=nextId(e.n); drawn.push(shownCardOf(e,section,id)); return cityCardHtml(e,section,id); };
  // The empty page's message ("No city within a 60-minute drive has any home
  // you can comfortably afford — the closest options are below", and a hint)
  // that stood here is the heading in the count line now, and its hint is
  // HomePilot Worth Knowing (2.0, 2026-09-24).
  const el=document.getElementById('list');
  if(el) el.innerHTML=open?rest.map(e=>card(e,'ranked')).join(''):'';
  const more=document.getElementById('listMore');
  if(more){
    let h='';
    if(open&&stretchOnly.length){
      h+='<div class="more-section"><div class="sec-title">Only as a stretch</div>'+
        '<div class="count">A bank may lend enough for these, but nothing here is comfortable: every option is above your HomePilot comfort range or would take 45% or more of your take-home pay.</div>'+
        stretchOnly.map(e=>card(e,'stretch')).join('')+'</div>';
    }
    if(open&&visibleOver.length){
      h+='<div class="more-section"><div class="sec-title">Past your '+ranking.limit+'-minute commute limit</div>'+
        '<div class="count">Shown because you asked. They are not ranked with the others.</div>'+
        visibleOver.map(e=>card(e,'over')).join('')+'</div>';
    }
    more.innerHTML=h;
  }

  // The on-screen record the PDF report (report.js) and Compare (compare.js)
  // are built from (IMPROVEMENT_PLAN.md 1.2): every card on the page, in
  // screen order, with the exact figures on it and the part of the page it is
  // in: 'answer-home', 'answer-commute', 'answer-cost' or 'answer-also' (a card
  // answering two questions is under its first, and lists both in `answers`),
  // or on the empty page 'answer-closest' (2.0), then 'ranked', 'stretch' and 'over'
  // from "See all places".
  shownCards=[...v.shown,...drawn];
}

// "See all places" / "Hide the other places".
function toggleSeeAll(){
  seeAllOpen=!seeAllOpen;
  if(!results.length) return;
  renderSeeAll();
  // Closing it from far down the list: bring the button back into view.
  const btn=document.getElementById('seeAllBtn');
  if(!seeAllOpen&&btn&&typeof btn.getBoundingClientRect==='function'&&btn.getBoundingClientRect().top<0&&typeof btn.scrollIntoView==='function') btn.scrollIntoView({block:'center'});
}

// One city card. `e` is a rankCities() entry; `section` is 'ranked', 'stretch'
// or 'over'. Every figure on the card comes from the entry, so the card, the
// ranking and shownCards can never show different numbers. `cardId` is the
// card's id from cardIdMaker() (2026-09-24: a place can have two cards on the
// page); without it, the plain 'c-' + place.
function cityCardHtml(e, section, cardId){
  const t=T.en;
  const x=e.city;
  const id=cardId||('c-'+x.n.replace(/[^a-zA-Z0-9]/g,'-'));
  const displayPrice=e.price;
  const c=e.costs;
  const fit=e.fit;
  const net=netMonthlyIncome||grossMonthlyIncome*0.72;
  const PLBL={condo:'Condos',town:'Townhomes',semi:'Semi-Detached Homes',detached:'Detached Homes'};
  // Estimated drive, as a plain fact. Green when short; the neutral colour
  // otherwise; red only on a card past the buyer's own limit.
  const commuteBadge=e.commuteMin===null?'':
    '<div class="commute-badge'+(section==='over'?' access-limited':e.commuteMin<=25?' access-excellent':'')+'">About '+e.commuteMin+' min drive · estimate</div>';
  let unlockNote='';
  if(section==='stretch'){
    unlockNote='<div style="font-size:12px;color:#996600;margin-top:6px;display:flex;align-items:center;gap:5px"><span>⚠</span>Even the '+(PROP_LABELS[e.type]||'home').toLowerCase()+' here is beyond comfortable</div>';
  } else if(section==='over'){
    unlockNote='<div style="font-size:12px;color:#8C2F2F;margin-top:6px">Over your '+maxCommuteMin+'-minute limit</div>';
  }
  // Every type the buyer can actually buy here (full qualification), for the
  // monthly range and the property list below.
  const options=(activeProp==='all'?['condo','town','semi','detached']:[activeProp])
    .map(tp=>qualifyingOption(x,tp)).filter(Boolean);
  // .city-body holds everything above "View Available Homes". It changes
  // nothing on its own; side by side it lets the answer cards line their
  // buttons up (the .answer-grid rules in calculator.html).
  return '<div class="city" id="'+id+'" onclick="toggle(\''+id+'\')">'+
    '<div class="city-body">'+
    '<div class="ct"><div><div class="cn">'+x.n+'</div>'+
      '<div class="card-headline">'+(PROP_LABELS[e.type]||e.type)+' · '+fc(displayPrice)+' '+fitPill(fit)+'</div>'+
      commuteBadge+'</div>'+
    '<div style="text-align:right">'+
      '<div style="font-size:10px;color:#555;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px">'+t.true_cost+'</div>'+
      '<div style="font-size:17px;font-weight:800;color:#1D9E75;white-space:nowrap" id="'+id+'-mtotal">'+fc(c.total)+'/mo</div>'+
      '<div style="font-size:11px;color:#777;margin-top:2px" id="'+id+'-mmort">'+(e.pct!==null?e.pct+'% of take-home':t.mortgage+': '+fc(c.mort)+'/mo')+'</div>'+
    '</div></div>'+
    unlockNote+
    buildWhyRanked(x, c, net, e.commuteMin, e.type, displayPrice)+
    (devMode?buildDevPanel(e,section):'')+
    (function(){
      // PROPERTY LIST — every type the buyer can actually buy in this city,
      // each with its monthly cost, its share of take-home pay, and getFit()'s
      // label (the same label used everywhere else).
      if(!options.length) return '';
      let h='<div style="font-size:11px;color:#999;margin-top:10px;margin-bottom:6px;text-align:center;letter-spacing:0.01em">Tap a property type to see full cost breakdown</div>';
      h+='<div style="border:1px solid #eaeaea;border-radius:10px;overflow:hidden">';
      options.forEach((r,i)=>{
        const rowId='pt-row-'+id+'-'+r.type;
        const panelId='pt-panel-'+id+'-'+r.type;
        const pct=net>0?Math.round(r.costs.total/net*100):0;
        const s=FIT_STYLE[r.fit.cls]||FIT_STYLE.fo;
        h+='<div style="'+(i>0?'border-top:1px solid #f0f0f0;':'')+'">'+
          // Tappable row
          '<div id="'+rowId+'" onclick="event.stopPropagation();selectPropType(\''+id+'\',\''+r.type+'\',\''+x.n+'\')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer;transition:background 0.15s">'+
          '<div><div style="font-size:13px;font-weight:700;color:#2a2a2a">'+(PROP_LABELS[r.type]||r.type)+'</div>'+
          '<div style="font-size:11px;color:#999;margin-top:2px">'+fc(r.price)+' · '+fc(r.costs.total)+'/mo</div></div>'+
          '<div style="display:flex;align-items:center;gap:8px">'+
          '<div style="font-size:17px;font-weight:800;color:#222">'+pct+'%</div>'+
          '<div style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:'+s.bg+';color:'+s.color+'">'+r.fit.lbl+'</div>'+
          '<div id="'+rowId+'-chevron" style="font-size:13px;color:#bbb;transition:transform 0.2s">›</div>'+
          '</div>'+
          '</div>'+
          // Accordion panel — renders directly under this row
          '<div id="'+panelId+'" style="display:none;border-top:1px solid #f0f0f0"></div>'+
        '</div>';
      });
      h+='</div>';
      h+='<div style="font-size:11px;color:#aaa;margin-top:4px;text-align:right">% of monthly take-home</div>';
      return h;
    })()+
    // AI Insights sits right under the property type ladder (moved here
    // July 27 2026 per feedback — reads more naturally right after the
    // user has seen the concrete price/cost breakdown, rather than before
    // it at the top of the card).
    '<div class="ai-insights-trigger" id="ai-trigger-'+id+'" onclick="event.stopPropagation();toggleAiInsights(\''+id+'\',\''+x.n+'\')" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:10px 12px;margin:10px 0;background:linear-gradient(135deg,#F3EEFB,#EEF7F3);border:1px solid #E3DAF5;border-radius:10px">'+
    '<span style="font-size:13px;font-weight:700;color:#5B3A7E">✨ AI Insights for '+x.n+'</span>'+
    '<span id="ai-trigger-chevron-'+id+'" style="font-size:13px;color:#5B3A7E;transition:transform 0.2s">›</span>'+
    '</div>'+
    '<div class="ai-insights" id="ai-'+id+'" style="display:none;margin-bottom:6px"></div>'+
    '<label class="cmp-cb" onclick="event.stopPropagation()" id="cmp-lbl-'+id+'">'+
    '<input type="checkbox" id="cmp-chk-'+id+'" onchange="toggleCmpCity(\''+x.n+'\',this)">'+
    '<span class="cmp-cb-lbl">Compare this city (select up to 3 cities)</span></label>'+
    '<div class="bk">'+
    (fit.cls==='fs'?'<div style="font-size:12px;color:#633806;background:#FAEEDA;border-radius:8px;padding:8px 10px;margin-top:10px;line-height:1.6;">'+t.stretch_warn+'</div>':'')+
    '</div>'+
    '</div>'+
    '<a class="view-btn"'+listingsLinkAttrs(x.n,activeProp,displayPrice)+'>View Available '+(activeProp==='all'?'Homes':PLBL[activeProp])+' in '+x.n+'</a>'+
    '</div>';
}

function selectPropType(cityId, tp, cityName) {
  const panel   = document.getElementById('pt-panel-' + cityId + '-' + tp);
  const chevron = document.getElementById('pt-row-' + cityId + '-' + tp + '-chevron');
  if(!panel) return;

  // If same type clicked again — toggle off
  const isOpen = panel.style.display !== 'none';
  // Close all panels and reset all rows for this city first
  ['condo','town','semi','detached'].forEach(t => {
    const p = document.getElementById('pt-panel-' + cityId + '-' + t);
    const r = document.getElementById('pt-row-'   + cityId + '-' + t);
    const c = document.getElementById('pt-row-'   + cityId + '-' + t + '-chevron');
    if(p) p.style.display = 'none';
    if(r) r.style.background = '';
    if(c) c.style.transform = '';
  });
  // If it was already open — just close it (toggle off)
  if(isOpen) return;

  // Highlight selected row + rotate chevron
  const selectedRow = document.getElementById('pt-row-' + cityId + '-' + tp);
  if(selectedRow) selectedRow.style.background = '#F0FDF9';
  if(chevron) chevron.style.transform = 'rotate(90deg)';

  const html = costPanelHtml(cityName, tp);
  if(!html) return;
  // Which breakdown this is, so refreshOpenCostPanels() can draw it again.
  panel.dataset.city = cityName;
  panel.dataset.type = tp;
  panel.innerHTML = html;
  panel.style.display = 'block';
}

// Draws every cost breakdown that is open again, in place, from the current
// answers. Called when the buyer ticks the rebate box inside one
// (setLttRebateConfirmed(), closingcosts.js): the rest of the page does not
// use the rebate, so re-rendering the cards would only close the breakdown
// the buyer is reading.
function refreshOpenCostPanels() {
  document.querySelectorAll('[id^="pt-panel-"]').forEach(panel => {
    if(panel.style.display === 'none' || !panel.dataset || !panel.dataset.city) return;
    const html = costPanelHtml(panel.dataset.city, panel.dataset.type);
    if(html) panel.innerHTML = html;
  });
}

// The rebate box's own change handler. The breakdown it sits in is drawn
// again (the rebate line comes or goes above the box), so the page is
// scrolled by however far the box moved, and the box keeps the focus: the
// buyer stays where they were.
function onLttRebateBox(box) {
  const panel = box && box.closest ? box.closest('[id^="pt-panel-"]') : null;
  const before = box && box.getBoundingClientRect ? box.getBoundingClientRect().top : null;
  setLttRebateConfirmed(!!(box && box.checked));
  const again = panel ? panel.querySelector('.ltt-rebate-box') : null;
  if(!again) return;
  const shift = before === null ? 0 : again.getBoundingClientRect().top - before;
  if(shift && typeof window.scrollBy === 'function') window.scrollBy(0, shift);
  if(typeof again.focus === 'function') again.focus({ preventScroll: true });
}

// The breakdown under one home type: monthly cost, financial impact and cash
// to close. Returns '' when the city or its price for that type is unknown.
function costPanelHtml(cityName, tp) {
  // Find city object
  const cityObj = window._allMarkets && window._allMarkets.find(m => m.n === cityName);
  if(!cityObj) return '';

  const pt    = PT[cityName] || {};
  const price = pt[tp];
  if(!price) return '';

  const c     = calcCosts(cityObj, price, fam_selected, dn_selected, tp);
  const net   = (netMonthlyIncome || grossMonthlyIncome * 0.72) || 1; // guard: never zero
  const remaining = net - c.total;
  const burdenPct = net > 0 ? Math.round(c.total / net * 100) : 0;
  // Rebate only when the buyer confirmed they qualify, and non-resident taxes
  // when they are not a citizen or PR (2026-09-23, closingcosts.js).
  const cc    = calcClosingCosts(cityName, price, buyerLttRebateApplies(), { foreignBuyer: canadianResident === false });
  const effectiveDn = Math.min(dn_selected, price); // cash-rich buyer: can't put more down than the price
  const cashToClose = effectiveDn + cc.total;
  const PLBL  = {condo:'Condo',town:'Townhouse',semi:'Semi-Detached',detached:'Detached'};

  // Fit label: getFit(), the one Great / Good / Stretch function
  // (REVIEW_BACKLOG.md P1-21). This panel used its own <35 / <=45 thresholds,
  // so a home at 45.3% of take-home read "Good Fit" here and "Stretch" on
  // the card above it.
  const fitObj = getFit(c.total, grossMonthlyIncome) || { cls: 'fs', lbl: T.en.fit_stretch_lbl };
  const fitLbl = fitObj.lbl, fitColor = (FIT_STYLE[fitObj.cls] || FIT_STYLE.fs).color, fitBg = (FIT_STYLE[fitObj.cls] || FIT_STYLE.fs).bg;

  const sectionHead = (title) =>
    '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#888;margin:14px 0 8px">' + title + '</div>';

  const sectionHeadHighlight = (title) =>
    '<div style="font-size:13px;font-weight:800;color:#1a1a1a;margin:16px 0 8px">' + title + '</div>';

  // gap and nowrap (2026-09-24): in a third-width answer card on a computer
  // a label ran into its figure ("Estimated Cash Required to Close" 0.1px
  // from "~$123,950"). Now the label wraps and the figure keeps its distance;
  // where there is room, as on a phone, nothing changes.
  const row = (label, value, color) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f5f5f5">' +
    '<div style="font-size:12px;color:#666">' + label + '</div>' +
    '<div style="font-size:13px;font-weight:700;white-space:nowrap;color:' + (color||'#1a1a1a') + '">' + value + '</div>' +
    '</div>';

  const totalRow = (label, value, color) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;margin-top:4px">' +
    '<div style="font-size:13px;font-weight:700;color:#1a1a1a">' + label + '</div>' +
    '<div style="font-size:15px;font-weight:800;white-space:nowrap;color:' + (color||'#1a1a1a') + '">' + value + '</div>' +
    '</div>';

  let html = '<div style="background:#FAFAFA;border-top:2px solid #1D9E75;padding:14px 16px">';

  // Header
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">' +
    '<div style="font-size:14px;font-weight:800;color:#1a1a1a">' + PLBL[tp] + ' — ' + fc(price) + '</div>' +
    '<div style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:' + fitBg + ';color:' + fitColor + '">' + fitLbl + '</div>' +
    '</div>';

  // SECTION 1 — Monthly Cost
  html += sectionHead('Monthly Cost Breakdown');
  html += row('Purchase Price', fc(price));
  html += row('Down Payment', '-' + fc(effectiveDn));
  html += row('Mortgage Amount (loan)', fc(Math.max(0, price - effectiveDn)), '#1a1a1a');
  html += row('Mortgage Payment', fc(c.mort) + '/mo');
  html += row('Property Tax', fc(c.tax) + '/mo');
  html += row('Insurance', fc(c.ins) + '/mo');
  html += row('Utilities', fc(c.util) + '/mo');
  html += row('Maintenance Reserve', fc(c.maint) + '/mo');
  if(tp === 'condo' && c.condoFee > 0) html += row('Condo Fees', fc(c.condoFee) + '/mo');
  html += totalRow('Total Monthly Cost', fc(c.total) + '/mo', '#1D9E75');
  html += '<div style="font-size:10px;color:#aaa;margin-top:8px;line-height:1.6">Mortgage, property tax, and insurance are calculated or sourced per city. Utilities and maintenance are general estimates and may not reflect your actual usage — verify with current bills where possible.</div>';

  // SECTION 2 — Financial Impact
  html += sectionHeadHighlight('Financial Impact');
  html += row('Net Monthly Income', fc(Math.round(net)) + '/mo');
  html += row('Housing Cost', fc(Math.round(c.total)) + '/mo', burdenPct >= 45 ? '#C05A00' : '#1a1a1a');
  html += row('Income Remaining', fc(Math.round(remaining)) + '/mo', remaining < 2000 ? '#DC2626' : '#1D9E75');
  html += totalRow('% of Income Consumed', burdenPct + '%', burdenPct >= 45 ? '#C05A00' : '#085041');

  // SECTION 3 — Closing Costs
  html += sectionHeadHighlight('Estimated Closing Costs');
  html += row('Down Payment', fc(dn_selected));
  html += row('Provincial Land Transfer Tax', fc(cc.ltt.provNet));
  if(cc.isToronto) html += row('Toronto Land Transfer Tax', fc(cc.ltt.muniNet));
  if(cc.ltt.totalRebate > 0) html += row('First-Time Buyer Rebate', '-' + fc(cc.ltt.totalRebate), '#1D9E75');
  // The rebate's own question, next to it (2026-09-24, IMPROVEMENT_PLAN.md
  // 2.3a D; it was a box on the form). Offered to a first-time buyer, as on
  // the form, and not to a buyer who said they are not a citizen or PR: the
  // rebates never apply to them (lttRebateApplies(), closingcosts.js), so the
  // box could not change anything. Unticked until the buyer ticks it.
  if(firstTimeBuyer === true && canadianResident !== false) {
    html += '<label class="ltt-rebate-row" onclick="event.stopPropagation()" style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:12px;color:#666;line-height:1.45;cursor:pointer">' +
      '<input type="checkbox" class="ltt-rebate-box" onchange="onLttRebateBox(this)"' + (lttRebateConfirmed ? ' checked' : '') + ' style="margin-top:1px;flex-shrink:0">' +
      '<span>Neither I nor my spouse has ever owned a home, anywhere in the world (including outside Canada)</span>' +
    '</label>';
  }
  if(cc.nrst > 0) html += row('Ontario Non-Resident Speculation Tax (25%)', fc(cc.nrst), '#C05A00');
  if(cc.mnrst > 0) html += row('Toronto Non-Resident Speculation Tax (10%)', fc(cc.mnrst), '#C05A00');
  html += row('Legal Fees', '~' + fc(cc.legal));
  html += row('Title Insurance', '~' + fc(cc.titleIns));
  html += row('Home Inspection', '~' + fc(cc.inspection));
  html += row('Moving Costs', '~' + fc(cc.moving));
  html += row('Adjustments', '~' + fc(cc.adjustments));
  html += totalRow('Estimated Cash Required to Close', '~' + fc(cashToClose), '#1a1a1a');
  if(firstTimeBuyer && canadianResident !== false && !buyerLttRebateApplies()) {
    html += '<div class="ltt-rebate-note" style="font-size:11px;color:#6B5A1E;background:#FBF6E6;border-radius:8px;padding:8px 10px;margin-top:8px;line-height:1.5">First-time buyer land transfer tax rebate not included. It applies only if neither you nor your spouse has ever owned a home anywhere in the world, and you are a Canadian citizen or permanent resident. Tick the box under the land transfer tax above if that is you.</div>';
  }


  html += '<div style="font-size:10px;color:#aaa;margin-top:10px;line-height:1.6">Estimates only — actual costs vary by transaction. New builds: HST may apply.</div>';

  // "View Available Homes" opens the dedicated listings page for this city +
  // property type (tp): a plain link, in the same tab on a phone and a new
  // tab on a computer. See listingsLinkAttrs() in listings-display.js.
  html += '<a class="view-btn" style="margin-top:12px"'+listingsLinkAttrs(cityName,tp,price)+'>View Available '+(PLBL[tp]||tp)+' in '+cityName+'</a>';

  html += '</div>';

  return html;
}
