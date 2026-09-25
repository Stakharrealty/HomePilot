// cities.js — HomePilot city data
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/cities.js"></script> before the main
// inline script, same shared global scope as before.

// City descriptions (a `d` field on every row) were DELETED 2026-09-23
// (REVIEW_BACKLOG.md P1-24, IMPROVEMENT_PLAN.md 1.5). Nothing on screen read
// them -- the only reader, cardDesc in render.js, was dead code -- but they
// shipped in public JavaScript, and Brampton's described the city by the
// ethnic background of its residents, which the app's own AI guardrail
// forbids. Most of the rest made claims nobody maintained
// ("GO Transit expansion", "top-ranked schools", "strong investment").
//
// TYPICAL PRICES AND CONDO FEES (2026-09-24, IMPROVEMENT_PLAN.md 3.1a and 3.2).
// Each place's typical price per home type, and its condo fee, now come from
// HomePilot's own listings where there are enough of them, and from the
// hand-typed tables everywhere else. This file holds, in order:
//   1. M -- the places. Unchanged, except that part 5 may lower a `min`.
//   2. PT_TYPED and CONDO_FEES_TYPED -- the hand-typed tables: the fallback.
//   3. The GENERATED block -- PT_LISTED and CONDO_FEES_LISTED, written only by
//      tools/city-prices.mjs. Never edit it by hand; re-run the script.
//   4. PT, PT_SOURCE and CONDO_FEES -- what the rest of the app reads: the
//      listings figure where there is one, else the typed one. Same names and
//      shapes as before, so no reader had to change.
//   5. Each place's `min` in M, lowered to its cheapest PT price if above it.
const M=[
  {n:"Welland",r:"niag",min:280000,avg:420000,max:700000,tx:0.01757,ut:{1:180,2:220,3:270,4:310,5:360},ins:85},
  {n:"Fort Erie",r:"niag",min:280000,avg:430000,max:730000,tx:0.01895,ut:{1:185,2:225,3:275,4:315,5:365},ins:85},
  {n:"Belleville",r:"east2",min:280000,avg:430000,max:750000,tx:0.01752,ut:{1:175,2:215,3:260,4:300,5:350},ins:85},
  {n:"Oshawa",r:"east",min:300000,avg:450000,max:920000,tx:0.01376,ut:{1:200,2:245,3:295,4:340,5:390},ins:90},
  {n:"Hamilton",r:"niag",min:310000,avg:480000,max:1050000,tx:0.01327,ut:{1:200,2:240,3:290,4:330,5:380},ins:95},
  {n:"Peterborough",r:"east2",min:310000,avg:450000,max:820000,tx:0.01538,ut:{1:180,2:220,3:265,4:305,5:355},ins:85},
  {n:"Barrie",r:"north",min:320000,avg:470000,max:930000,tx:0.01291,ut:{1:195,2:240,3:285,4:330,5:380},ins:90},
  {n:"Kingston",r:"east2",min:310000,avg:460000,max:880000,tx:0.01445,ut:{1:175,2:215,3:260,4:300,5:350},ins:85},
  {n:"St. Catharines",r:"niag",min:310000,avg:460000,max:880000,tx:0.01632,ut:{1:190,2:230,3:280,4:320,5:370},ins:88},
  {n:"Niagara Falls",r:"niag",min:310000,avg:460000,max:860000,tx:0.01505,ut:{1:190,2:230,3:280,4:320,5:370},ins:88},
  {n:"Midland",r:"north",min:320000,avg:460000,max:780000,tx:0.01716,ut:{1:185,2:225,3:275,4:315,5:365},ins:88},
  {n:"Cobourg",r:"east2",min:330000,avg:490000,max:920000,tx:0.01793,ut:{1:180,2:220,3:265,4:305,5:355},ins:88},
  {n:"Ottawa",r:"east2",min:330000,avg:520000,max:1180000,tx:0.01169,ut:{1:185,2:225,3:270,4:310,5:360},ins:90},
  {n:"Wasaga Beach",r:"north",min:330000,avg:490000,max:870000,tx:0.01187,ut:{1:190,2:235,3:280,4:320,5:370},ins:88},
  {n:"Cambridge",r:"wloo",min:340000,avg:510000,max:990000,tx:0.01308,ut:{1:195,2:235,3:285,4:325,5:375},ins:90},
  {n:"Kitchener",r:"wloo",min:340000,avg:510000,max:1020000,tx:0.01212,ut:{1:195,2:235,3:285,4:325,5:375},ins:90},
  {n:"Waterloo",r:"wloo",min:340000,avg:520000,max:1020000,tx:0.01204,ut:{1:195,2:235,3:285,4:325,5:375},ins:90},
  {n:"Grand Valley",r:"duff",min:380000,avg:530000,max:840000,tx:0.00874,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Shelburne",r:"duff",min:390000,avg:540000,max:880000,tx:0.00877,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Innisfil",r:"north",min:360000,avg:530000,max:980000,tx:0.0119,ut:{1:195,2:240,3:285,4:330,5:380},ins:90},
  {n:"Georgina",r:"north",min:380000,avg:540000,max:970000,tx:0.01069,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Centre Wellington",r:"duff",min:390000,avg:550000,max:970000,tx:0.01105,ut:{1:195,2:240,3:285,4:330,5:380},ins:92},
  {n:"Clarington",r:"east",min:390000,avg:560000,max:980000,tx:0.01224,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Scugog",r:"east",min:390000,avg:550000,max:980000,tx:0.01177,ut:{1:195,2:240,3:290,4:335,5:385},ins:92},
  {n:"Collingwood",r:"north",min:350000,avg:540000,max:1450000,tx:0.0095,ut:{1:195,2:240,3:285,4:330,5:380},ins:95},
  {n:"Guelph",r:"duff",min:380000,avg:580000,max:1170000,tx:0.01229,ut:{1:195,2:235,3:285,4:325,5:375},ins:95},
  {n:"Orangeville",r:"duff",min:420000,avg:610000,max:980000,tx:0.00941,ut:{1:200,2:245,3:295,4:340,5:390},ins:95},
  {n:"Whitby",r:"east",min:400000,avg:620000,max:1080000,tx:0.01199,ut:{1:205,2:250,3:300,4:345,5:395},ins:95},
  {n:"Ajax",r:"east",min:400000,avg:620000,max:1070000,tx:0.01183,ut:{1:205,2:250,3:300,4:345,5:395},ins:95},
  {n:"Bradford",r:"north",min:450000,avg:660000,max:1170000,tx:0.00998,ut:{1:200,2:245,3:295,4:340,5:390},ins:98},
  {n:"Newmarket",r:"north",min:420000,avg:650000,max:1270000,tx:0.00841,ut:{1:200,2:245,3:295,4:340,5:390},ins:98},
  {n:"Pickering",r:"east",min:420000,avg:650000,max:1170000,tx:0.01161,ut:{1:205,2:250,3:300,4:345,5:395},ins:98},
  {n:"Acton",r:"west",min:430000,avg:640000,max:1050000,tx:0.00853,ut:{1:200,2:245,3:295,4:340,5:390},ins:95},
  {n:"Mississauga",r:"gta",min:380000,avg:650000,max:1470000,tx:0.01034,ut:{1:205,2:250,3:305,4:350,5:400},ins:105},
  {n:"Brampton",r:"gta",min:400000,avg:660000,max:1080000,tx:0.01039,ut:{1:210,2:255,3:310,4:355,5:405},ins:105},
  {n:"Toronto - Scarborough",r:"gta",min:360000,avg:580000,max:1170000,tx:0.00666,ut:{1:180,2:220,3:265,4:305,5:350},ins:105},
  {n:"Toronto - North York",r:"gta",min:400000,avg:680000,max:1760000,tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:108},
  {n:"Toronto - East End",r:"gta",min:420000,avg:680000,max:1470000,tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:108},
  {n:"Toronto - Etobicoke",r:"gta",min:400000,avg:670000,max:1470000,tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:108},
  {n:"Toronto - Downtown",r:"gta",min:420000,avg:720000,max:1960000,tx:0.00666,ut:{1:160,2:195,3:235,4:270,5:315},ins:110},
  {n:"Erin",r:"duff",min:500000,avg:760000,max:1250000,tx:0.01105,ut:{1:205,2:250,3:300,4:345,5:395},ins:108},
  {n:"Milton",r:"west",min:450000,avg:720000,max:1270000,tx:0.00734,ut:{1:205,2:250,3:300,4:345,5:395},ins:105},
  {n:"Georgetown",r:"west",min:500000,avg:760000,max:1270000,tx:0.00853,ut:{1:200,2:245,3:295,4:340,5:390},ins:108},
  {n:"Halton Hills",r:"west",min:500000,avg:760000,max:1270000,tx:0.00853,ut:{1:200,2:245,3:295,4:340,5:390},ins:108},
  {n:"Bolton",r:"gta",min:520000,avg:760000,max:1170000,tx:0.00842,ut:{1:205,2:250,3:300,4:345,5:395},ins:108},
  {n:"Aurora",r:"north",min:450000,avg:760000,max:1470000,tx:0.00803,ut:{1:205,2:250,3:300,4:345,5:395},ins:110},
  {n:"Toronto - West End",r:"gta",min:500000,avg:800000,max:1960000,tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:112},
  {n:"Vaughan",r:"north",min:460000,avg:800000,max:1760000,tx:0.00733,ut:{1:210,2:255,3:305,4:355,5:405},ins:112},
  {n:"Markham",r:"north",min:460000,avg:820000,max:1760000,tx:0.007,ut:{1:210,2:255,3:305,4:355,5:405},ins:112},
  {n:"Caledon",r:"gta",min:550000,avg:870000,max:1760000,tx:0.00842,ut:{1:210,2:255,3:310,4:355,5:410},ins:110},
  {n:"Richmond Hill",r:"north",min:480000,avg:860000,max:1960000,tx:0.00737,ut:{1:210,2:255,3:305,4:355,5:405},ins:118},
  {n:"Burlington",r:"west",min:480000,avg:860000,max:1760000,tx:0.00972,ut:{1:205,2:250,3:300,4:345,5:395},ins:115},
  {n:"Oakville",r:"west",min:520000,avg:1100000,max:2940000,tx:0.0076,ut:{1:215,2:260,3:315,4:360,5:415},ins:145},
  {n:"Mono",r:"duff",min:700000,avg:1050000,max:1960000,tx:0.0066,ut:{1:215,2:260,3:315,4:360,5:415},ins:118},
  {n:"King City",r:"north",min:900000,avg:1500000,max:3920000,tx:0.00829,ut:{1:225,2:275,3:330,4:380,5:435},ins:165}
];

// ── TYPICAL ENTRY PRICES (40th–50th percentile of active listings, 2025) ──
// null = this property type does not realistically exist in this city at
// buyer-accessible prices. The filter suppresses it entirely -- unless the
// listings have 10+ of that type: then PT (below) takes the listings figure
// and the type shows (the owner's decision, 2026-09-24: show them all, the
// Innisfil resort condos and the thin 10-19 counts included).
// These are NOT floor prices. They represent what a typical buyer actually needs
// to spend to enter this market for a liveable, representative property.
// HAND-TYPED, and since 2026-09-24 the FALLBACK: the app reads PT (below), which
// takes the listings figure wherever PT_LISTED has one. Values unchanged.
const PT_TYPED={
  // Dufferin / Sandeep's core market
  "Bolton":           {condo:null,    town:800000,  semi:875000,   detached:1050000},
  "Caledon":          {condo:null,    town:875000,  semi:975000,   detached:1250000},
  "Orangeville":      {condo:460000,  town:630000,  semi:695000,   detached:775000 },
  "Shelburne":        {condo:null,    town:555000,  semi:615000,   detached:695000 },
  "Grand Valley":     {condo:null,    town:null,    semi:null,     detached:670000 },
  "Mono":             {condo:null,    town:null,    semi:null,     detached:975000 },
  "Erin":             {condo:null,    town:null,    semi:null,     detached:925000 },
  "Centre Wellington":{condo:null,    town:615000,  semi:null,     detached:840000 },
  // Halton / West GTA
  "Georgetown":       {condo:null,    town:775000,  semi:875000,   detached:1075000},
  "Halton Hills":     {condo:null,    town:760000,  semi:860000,   detached:1050000},
  "Acton":            {condo:null,    town:700000,  semi:780000,   detached:950000 },
  "Milton":           {condo:575000,  town:775000,  semi:875000,   detached:1075000},
  "Burlington":       {condo:585000,  town:820000,  semi:925000,   detached:1200000},
  "Oakville":         {condo:640000,  town:925000,  semi:1125000,  detached:1550000},
  // Peel
  "Brampton":         {condo:540000,  town:740000,  semi:840000,   detached:1025000},
  "Mississauga":      {condo:585000,  town:820000,  semi:975000,   detached:1400000},
  // Toronto
  "Toronto - Scarborough": {condo:545000, town:720000, semi:925000, detached:1075000},
  "Toronto - North York":  {condo:615000, town:800000, semi:1125000,detached:1450000},
  "Toronto - East End":    {condo:595000, town:null,   semi:1125000,detached:1550000},
  "Toronto - Etobicoke":   {condo:595000, town:775000, semi:1125000,detached:1400000},
  "Toronto - West End":    {condo:615000, town:null,   semi:1225000,detached:1650000},
  "Toronto - Downtown":    {condo:635000, town:null,   semi:1325000,detached:1750000},
  // York Region
  "Vaughan":          {condo:605000,  town:875000,  semi:975000,   detached:1350000},
  "Richmond Hill":    {condo:615000,  town:925000,  semi:1075000,  detached:1450000},
  "Markham":          {condo:595000,  town:875000,  semi:1025000,  detached:1400000},
  "Aurora":           {condo:580000,  town:825000,  semi:975000,   detached:1250000},
  "Newmarket":        {condo:555000,  town:775000,  semi:875000,   detached:1075000},
  "King City":        {condo:null,    town:null,    semi:null,     detached:1650000},
  "Bradford":         {condo:null,    town:720000,  semi:825000,   detached:1025000},
  "Georgina":         {condo:null,    town:565000,  semi:635000,   detached:825000 },
  // Durham
  "Pickering":        {condo:545000,  town:740000,  semi:820000,   detached:1025000},
  "Ajax":             {condo:535000,  town:720000,  semi:800000,   detached:1000000},
  "Whitby":           {condo:525000,  town:700000,  semi:780000,   detached:975000 },
  "Oshawa":           {condo:430000,  town:595000,  semi:665000,   detached:820000 },
  "Clarington":       {condo:null,    town:595000,  semi:665000,   detached:840000 },
  "Scugog":           {condo:null,    town:null,    semi:null,     detached:800000 },
  // Simcoe / Barrie
  "Barrie":           {condo:430000,  town:595000,  semi:675000,   detached:800000 },
  "Innisfil":         {condo:null,    town:565000,  semi:635000,   detached:800000 },
  "Collingwood":      {condo:495000,  town:665000,  semi:null,     detached:875000 },
  "Wasaga Beach":     {condo:null,    town:595000,  semi:null,     detached:800000 },
  "Midland":          {condo:null,    town:null,    semi:null,     detached:665000 },
  // Waterloo Region
  "Kitchener":        {condo:430000,  town:615000,  semi:665000,   detached:800000 },
  "Waterloo":         {condo:450000,  town:635000,  semi:695000,   detached:840000 },
  "Cambridge":        {condo:410000,  town:595000,  semi:645000,   detached:770000 },
  "Guelph":           {condo:490000,  town:665000,  semi:740000,   detached:900000 },
  // Hamilton / Niagara
  "Hamilton":         {condo:440000,  town:615000,  semi:695000,   detached:840000 },
  "St. Catharines":   {condo:390000,  town:545000,  semi:595000,   detached:720000 },
  "Niagara Falls":    {condo:380000,  town:515000,  semi:575000,   detached:700000 },
  "Welland":          {condo:299000,  town:475000,  semi:535000,   detached:655000 },
  "Fort Erie":        {condo:340000,  town:460000,  semi:525000,   detached:635000 },
  // Eastern Ontario
  "Peterborough":     {condo:390000,  town:535000,  semi:595000,   detached:720000 },
  "Cobourg":          {condo:null,    town:515000,  semi:null,     detached:740000 },
  "Belleville":       {condo:360000,  town:495000,  semi:555000,   detached:665000 },
  "Kingston":         {condo:430000,  town:595000,  semi:665000,   detached:800000 },
  "Ottawa":           {condo:440000,  town:615000,  semi:695000,   detached:825000 },
};

// ── MONTHLY CONDO FEES by city (approximate average for a typical unit) ──
// These are NOT included in mortgage or tax — they are a real additional cost.
// Source: average maintenance fees from MPAC/MLS 2024–25 data
// HAND-TYPED ESTIMATES, and since 2026-09-24 the FALLBACK: the app reads
// CONDO_FEES (below), which takes the real median fee wherever
// CONDO_FEES_LISTED has one. Values unchanged.
const CONDO_FEES_TYPED={
  "Toronto - Downtown":800,"Toronto - West End":750,"Toronto - East End":700,
  "Toronto - North York":680,"Toronto - Etobicoke":650,"Toronto - Scarborough":600,
  "Mississauga":620,"Brampton":520,"Vaughan":580,"Richmond Hill":560,
  "Markham":560,"Aurora":530,"Newmarket":510,"Oakville":640,"Burlington":600,
  "Milton":500,"Pickering":490,"Ajax":480,"Whitby":470,"Oshawa":430,
  "Hamilton":430,"Guelph":470,"Kitchener":420,"Waterloo":440,"Cambridge":400,
  "Barrie":420,"Collingwood":490,"Kingston":440,"Ottawa":500,"Orangeville":410,
  "St. Catharines":390,"Niagara Falls":380,"Belleville":360,"Peterborough":370,
  "Clarington":430,"Innisfil":430,"Georgetown":450,"Halton Hills":450,
  "Georgina":420,"Wasaga Beach":420,"Cobourg":380,
};

// BEGIN GENERATED by tools/city-prices.mjs -- do not edit by hand; run `node tools/city-prices.mjs`.
// Run 2026-09-24 on the live listings: those updated since 2026-09-23T09:10:49.085Z, the
// listings page's own 36-hour window. price = 40th-percentile asking price of the
// place's listings of that type x 0.97, to the nearest $10,000, only where it has 10+ of them.
// fee = median real monthly fee of the place's condo listings, only where 10+ have one.
// n = listings (or fees) behind the figure. A place or type left out keeps its typed figure,
// including the KEEP_TYPED prices in tools/city-prices.mjs.
const CITY_PRICES_RUN={"date":"2026-09-24","asOf":"2026-09-24T21:10:49.085Z","listingsSince":"2026-09-23T09:10:49.085Z","percentile":0.4,"saleToList":0.97,"priceStep":10000,"minListings":10,"minFees":10};
const PT_LISTED={
  "Welland":{condo:{price:410000,n:25},town:{price:510000,n:26},semi:{price:490000,n:32},detached:{price:550000,n:233}},
  "Fort Erie":{condo:{price:480000,n:15},town:{price:560000,n:29},detached:{price:580000,n:303}},
  "Belleville":{condo:{price:340000,n:35},town:{price:500000,n:30},detached:{price:540000,n:219}},
  "Oshawa":{condo:{price:420000,n:115},town:{price:660000,n:51},semi:{price:610000,n:48},detached:{price:730000,n:423}},
  "Hamilton":{condo:{price:410000,n:421},town:{price:650000,n:170},semi:{price:630000,n:73},detached:{price:740000,n:1140}},
  "Peterborough":{condo:{price:440000,n:41},town:{price:530000,n:21},detached:{price:560000,n:261}},
  "Barrie":{condo:{price:410000,n:215},town:{price:570000,n:110},semi:{price:600000,n:36},detached:{price:730000,n:504}},
  "Kingston":{condo:{price:350000,n:129},town:{price:490000,n:39},semi:{price:480000,n:45},detached:{price:630000,n:347}},
  "St. Catharines":{condo:{price:360000,n:124},semi:{price:490000,n:34},detached:{price:580000,n:366}},
  "Niagara Falls":{condo:{price:420000,n:99},town:{price:610000,n:24},semi:{price:510000,n:23},detached:{price:610000,n:363}},
  "Midland":{condo:{price:460000,n:17},town:{price:550000,n:16},detached:{price:570000,n:102}},
  "Cobourg":{condo:{price:410000,n:35},town:{price:660000,n:19},semi:{price:630000,n:11},detached:{price:710000,n:100}},
  "Ottawa":{condo:{price:360000,n:1186},town:{price:580000,n:627},semi:{price:620000,n:185},detached:{price:820000,n:1463}},
  "Wasaga Beach":{condo:{price:410000,n:19},town:{price:530000,n:38},detached:{price:700000,n:310}},
  "Cambridge":{condo:{price:440000,n:74},town:{price:630000,n:41},semi:{price:510000,n:18},detached:{price:780000,n:209}},
  "Kitchener":{condo:{price:360000,n:242},town:{price:630000,n:40},semi:{price:580000,n:23},detached:{price:760000,n:256}},
  "Waterloo":{condo:{price:390000,n:198},town:{price:630000,n:11},semi:{price:580000,n:13},detached:{price:820000,n:104}},
  "Shelburne":{detached:{price:730000,n:57}},
  "Innisfil":{condo:{price:480000,n:49},town:{price:680000,n:35},detached:{price:820000,n:338}},
  "Georgina":{condo:{price:510000,n:10},town:{price:660000,n:11},detached:{price:810000,n:366}},
  "Centre Wellington":{condo:{price:440000,n:24},town:{price:660000,n:18},detached:{price:820000,n:123}},
  "Clarington":{condo:{price:450000,n:64},town:{price:630000,n:46},semi:{price:680000,n:19},detached:{price:840000,n:294}},
  "Collingwood":{condo:{price:490000,n:150},town:{price:590000,n:16},semi:{price:590000,n:10},detached:{price:830000,n:130}},
  "Guelph":{condo:{price:480000,n:248},town:{price:660000,n:28},semi:{price:710000,n:23},detached:{price:840000,n:228}},
  "Orangeville":{condo:{price:460000,n:21},town:{price:600000,n:20},semi:{price:620000,n:17},detached:{price:810000,n:79}},
  "Whitby":{condo:{price:480000,n:46},town:{price:740000,n:71},semi:{price:850000,n:21},detached:{price:1020000,n:265}},
  "Ajax":{condo:{price:540000,n:40},town:{price:690000,n:38},semi:{price:780000,n:15},detached:{price:950000,n:199}},
  "Bradford":{town:{price:710000,n:10},semi:{price:710000,n:13},detached:{price:1060000,n:108}},
  "Newmarket":{condo:{price:590000,n:48},town:{price:780000,n:34},semi:{price:780000,n:25},detached:{price:1070000,n:214}},
  "Pickering":{condo:{price:530000,n:111},town:{price:780000,n:69},semi:{price:820000,n:16},detached:{price:1120000,n:198}},
  "Acton":{detached:{price:860000,n:23}},
  "Mississauga":{condo:{price:520000,n:1190},town:{price:870000,n:59},semi:{price:890000,n:200},detached:{price:1310000,n:904}},
  "Brampton":{condo:{price:480000,n:358},town:{price:730000,n:207},semi:{price:760000,n:217},detached:{price:970000,n:1014}},
  "Toronto - Scarborough":{condo:{price:480000,n:687},town:{price:730000,n:46},semi:{price:780000,n:68},detached:{price:970000,n:640}},
  "Toronto - North York":{condo:{price:530000,n:1297},town:{price:860000,n:55},semi:{price:870000,n:131},detached:{price:1890000,n:894}},
  "Toronto - East End":{condo:{price:480000,n:266},town:{price:910000,n:25},semi:{price:1070000,n:117}},
  "Toronto - Etobicoke":{condo:{price:530000,n:738},town:{price:1140000,n:23},semi:{price:870000,n:24},detached:{price:1260000,n:500}},
  "Toronto - Downtown":{condo:{price:580000,n:2426},town:{price:1350000,n:87},semi:{price:1450000,n:135},detached:{price:2330000,n:145}},
  "Milton":{condo:{price:540000,n:106},town:{price:790000,n:88},semi:{price:870000,n:36},detached:{price:1210000,n:239}},
  "Georgetown":{condo:{price:610000,n:15},town:{price:860000,n:23},detached:{price:1120000,n:100}},
  "Halton Hills":{condo:{price:610000,n:19},town:{price:860000,n:23}},
  "Bolton":{town:{price:850000,n:18},semi:{price:840000,n:13},detached:{price:1070000,n:68}},
  "Aurora":{condo:{price:580000,n:79},town:{price:880000,n:35},semi:{price:840000,n:12},detached:{price:1440000,n:164}},
  "Toronto - West End":{condo:{price:530000,n:472},town:{price:990000,n:22},semi:{price:970000,n:98},detached:{price:1210000,n:409}},
  "Vaughan":{condo:{price:560000,n:516},town:{price:970000,n:124},semi:{price:970000,n:46},detached:{price:1540000,n:566}},
  "Markham":{condo:{price:580000,n:445},town:{price:950000,n:142},semi:{price:970000,n:67},detached:{price:1450000,n:442}},
  "Caledon":{condo:{price:620000,n:14},town:{price:810000,n:38},semi:{price:860000,n:21},detached:{price:1260000,n:361}},
  "Richmond Hill":{condo:{price:550000,n:269},town:{price:970000,n:119},semi:{price:1000000,n:35},detached:{price:1580000,n:534}},
  "Burlington":{condo:{price:580000,n:319},town:{price:890000,n:41},semi:{price:880000,n:22},detached:{price:1260000,n:290}},
  "Oakville":{condo:{price:520000,n:281},town:{price:1020000,n:155},semi:{price:1020000,n:26},detached:{price:1750000,n:564}},
  "Mono":{detached:{price:1450000,n:65}},
  "King City":{condo:{price:540000,n:15},town:{price:1260000,n:10},detached:{price:2420000,n:69}},
};
const CONDO_FEES_LISTED={
  "Welland":{fee:376,n:23},
  "Fort Erie":{fee:349,n:15},
  "Belleville":{fee:613,n:35},
  "Oshawa":{fee:481,n:115},
  "Hamilton":{fee:563,n:417},
  "Peterborough":{fee:494,n:40},
  "Barrie":{fee:629,n:215},
  "Kingston":{fee:556,n:129},
  "St. Catharines":{fee:568,n:124},
  "Niagara Falls":{fee:466,n:93},
  "Midland":{fee:608,n:17},
  "Cobourg":{fee:581,n:35},
  "Ottawa":{fee:578,n:1182},
  "Wasaga Beach":{fee:649,n:19},
  "Cambridge":{fee:530,n:74},
  "Kitchener":{fee:502,n:239},
  "Waterloo":{fee:571,n:196},
  "Innisfil":{fee:580,n:48},
  "Georgina":{fee:527,n:10},
  "Centre Wellington":{fee:525,n:24},
  "Clarington":{fee:456,n:64},
  "Collingwood":{fee:572,n:149},
  "Guelph":{fee:478,n:248},
  "Orangeville":{fee:573,n:21},
  "Whitby":{fee:631,n:45},
  "Ajax":{fee:611,n:40},
  "Newmarket":{fee:578,n:48},
  "Pickering":{fee:521,n:111},
  "Mississauga":{fee:683,n:1188},
  "Brampton":{fee:627,n:358},
  "Toronto - Scarborough":{fee:689,n:683},
  "Toronto - North York":{fee:728,n:1292},
  "Toronto - East End":{fee:732,n:266},
  "Toronto - Etobicoke":{fee:733,n:735},
  "Toronto - Downtown":{fee:698,n:2408},
  "Milton":{fee:486,n:105},
  "Georgetown":{fee:790,n:15},
  "Halton Hills":{fee:555,n:19},
  "Aurora":{fee:769,n:78},
  "Toronto - West End":{fee:679,n:467},
  "Vaughan":{fee:628,n:510},
  "Markham":{fee:603,n:444},
  "Caledon":{fee:540,n:14},
  "Richmond Hill":{fee:697,n:268},
  "Burlington":{fee:681,n:319},
  "Oakville":{fee:624,n:278},
  "King City":{fee:509,n:15},
};
// END GENERATED

// ── WHAT THE APP READS ──
// PT[place][type]: the listings figure (PT_LISTED) where the place has 10+
// listings of that type, else the typed one -- which may be null, meaning the
// type is hidden in this place. A type typed as null that has 10+ listings
// takes the listings figure: the listings show it exists.
// PT_SOURCE[place][type]: 'listings' or 'typed' -- where each PT figure came from.
const PT={};
const PT_SOURCE={};
for(const place of Object.keys(PT_TYPED)){
  const listed=PT_LISTED[place]||{};
  PT[place]={};
  PT_SOURCE[place]={};
  for(const type of Object.keys(PT_TYPED[place])){
    const cell=listed[type];
    const fromListings=!!(cell&&cell.price>0);
    PT[place][type]=fromListings?cell.price:PT_TYPED[place][type];
    PT_SOURCE[place][type]=fromListings?'listings':'typed';
  }
}

// CONDO_FEES[place]: the median real monthly fee of the place's condo listings
// (CONDO_FEES_LISTED) where 10+ of them have a usable fee, else the typed
// estimate. A place in neither has no entry, as before (readers default to $500).
// CONDO_FEES_SOURCE[place]: 'listings' or 'typed'.
const CONDO_FEES={...CONDO_FEES_TYPED};
const CONDO_FEES_SOURCE={};
for(const place of Object.keys(CONDO_FEES)) CONDO_FEES_SOURCE[place]='typed';
for(const place of Object.keys(CONDO_FEES_LISTED)){
  if(CONDO_FEES_LISTED[place].fee>0){
    CONDO_FEES[place]=CONDO_FEES_LISTED[place].fee;
    CONDO_FEES_SOURCE[place]='listings';
  }
}

// ── ENTRY FLOOR: no place's `min` above its cheapest PT price ──
// candidateCities() in main.js drops a place before any costing unless
// m.min <= the buyer's buying power. When the listings put a home type below
// the place's old typed `min`, a buyer who can afford that home must still see
// the place, so `min` comes down to it. Lowered only, never raised; `avg` and
// `max` are not touched.
for(const m of M){
  const prices=Object.values(PT[m.n]||{}).filter((v)=>v>0);
  if(prices.length){
    const cheapest=Math.min(...prices);
    if(m.min>cheapest) m.min=cheapest;
  }
}
