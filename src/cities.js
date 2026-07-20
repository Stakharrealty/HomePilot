// cities.js — HomePilot city data
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/cities.js"></script> before the main
// inline script, same shared global scope as before.

const M=[
  {n:"Welland",r:"niag",min:280000,avg:420000,max:700000,d:"Most affordable in Niagara, condos from $280K, growing community",tx:0.01757,ut:{1:180,2:220,3:270,4:310,5:360},ins:85},
  {n:"Fort Erie",r:"niag",min:280000,avg:430000,max:730000,d:"US border town, very affordable, condos and townhomes available",tx:0.01895,ut:{1:185,2:225,3:275,4:315,5:365},ins:85},
  {n:"Belleville",r:"east2",min:280000,avg:430000,max:750000,d:"Bay of Quinte, condos from $280K, very affordable",tx:0.01752,ut:{1:175,2:215,3:260,4:300,5:350},ins:85},
  {n:"Oshawa",r:"east",min:300000,avg:450000,max:920000,d:"Most affordable in Durham, condos from $300K, GO Transit",tx:0.01376,ut:{1:200,2:245,3:295,4:340,5:390},ins:90},
  {n:"Hamilton",r:"niag",min:310000,avg:480000,max:1050000,d:"Arts city, condos from $310K, GO Transit, strong investment",tx:0.01327,ut:{1:200,2:240,3:290,4:330,5:380},ins:95},
  {n:"Peterborough",r:"east2",min:310000,avg:450000,max:820000,d:"Cottage country gateway, condos from $310K, Trent University",tx:0.01538,ut:{1:180,2:220,3:265,4:305,5:355},ins:85},
  {n:"Barrie",r:"north",min:320000,avg:470000,max:930000,d:"Lake Simcoe city, condos from $320K, GO Transit expansion",tx:0.01291,ut:{1:195,2:240,3:285,4:330,5:380},ins:90},
  {n:"Kingston",r:"east2",min:310000,avg:460000,max:880000,d:"Historic city, condos from $310K, Queen's University",tx:0.01445,ut:{1:175,2:215,3:260,4:300,5:350},ins:85},
  {n:"St. Catharines",r:"niag",min:310000,avg:460000,max:880000,d:"Niagara hub, condos from $310K, wine country",tx:0.01632,ut:{1:190,2:230,3:280,4:320,5:370},ins:88},
  {n:"Niagara Falls",r:"niag",min:310000,avg:460000,max:860000,d:"Very affordable, condos from $310K, US border access",tx:0.01505,ut:{1:190,2:230,3:280,4:320,5:370},ins:88},
  {n:"Midland",r:"north",min:320000,avg:460000,max:780000,d:"Georgian Bay waterfront, condos from $320K, relaxed lifestyle",tx:0.01716,ut:{1:185,2:225,3:275,4:315,5:365},ins:88},
  {n:"Cobourg",r:"east2",min:330000,avg:490000,max:920000,d:"Lake Ontario beach town, condos from $330K, GO Train access",tx:0.01793,ut:{1:180,2:220,3:265,4:305,5:355},ins:88},
  {n:"Ottawa",r:"east2",min:330000,avg:520000,max:1180000,d:"Nation's capital, condos from $330K, stable government jobs",tx:0.01169,ut:{1:185,2:225,3:270,4:310,5:360},ins:90},
  {n:"Wasaga Beach",r:"north",min:330000,avg:490000,max:870000,d:"World's longest freshwater beach, condos from $330K",tx:0.01187,ut:{1:190,2:235,3:280,4:320,5:370},ins:88},
  {n:"Cambridge",r:"wloo",min:340000,avg:510000,max:990000,d:"Grand River city, condos from $340K, affordable Waterloo Region",tx:0.01308,ut:{1:195,2:235,3:285,4:325,5:375},ins:90},
  {n:"Kitchener",r:"wloo",min:340000,avg:510000,max:1020000,d:"Tech hub, condos from $340K, LRT transit, young population",tx:0.01212,ut:{1:195,2:235,3:285,4:325,5:375},ins:90},
  {n:"Waterloo",r:"wloo",min:340000,avg:520000,max:1020000,d:"University city, condos from $340K, tech corridor",tx:0.01204,ut:{1:195,2:235,3:285,4:325,5:375},ins:90},
  {n:"Grand Valley",r:"duff",min:380000,avg:530000,max:840000,d:"Hidden gem, very affordable, quiet near Orangeville",tx:0.00874,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Shelburne",r:"duff",min:390000,avg:540000,max:880000,d:"Most affordable in the corridor, newer builds, fast-growing",tx:0.00877,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Innisfil",r:"north",min:360000,avg:530000,max:980000,d:"Lakefront community, condos from $360K, Friday Harbour",tx:0.0119,ut:{1:195,2:240,3:285,4:330,5:380},ins:90},
  {n:"Georgina",r:"north",min:380000,avg:540000,max:970000,d:"Lake Simcoe access, condos from $380K, affordable",tx:0.01069,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Centre Wellington",r:"duff",min:390000,avg:550000,max:970000,d:"Elora and Fergus, condos from $390K, heritage charm",tx:0.01105,ut:{1:195,2:240,3:285,4:330,5:380},ins:92},
  {n:"Clarington",r:"east",min:390000,avg:560000,max:980000,d:"Bowmanville, condos from $390K, affordable Durham",tx:0.01224,ut:{1:200,2:245,3:295,4:340,5:390},ins:92},
  {n:"Scugog",r:"east",min:390000,avg:550000,max:980000,d:"Port Perry area, condos from $390K, lakefront charm",tx:0.01177,ut:{1:195,2:240,3:290,4:335,5:385},ins:92},
  {n:"Collingwood",r:"north",min:350000,avg:540000,max:1450000,d:"Four seasons resort, condos from $350K, ski and Georgian Bay",tx:0.0095,ut:{1:195,2:240,3:285,4:330,5:380},ins:95},
  {n:"Guelph",r:"duff",min:380000,avg:580000,max:1170000,d:"University city, condos from $380K, strong rental market",tx:0.01229,ut:{1:195,2:235,3:285,4:325,5:375},ins:95},
  {n:"Orangeville",r:"duff",min:420000,avg:610000,max:980000,d:"Vibrant town, condos from $420K, 1hr from Toronto",tx:0.00941,ut:{1:200,2:245,3:295,4:340,5:390},ins:95},
  {n:"Whitby",r:"east",min:400000,avg:620000,max:1080000,d:"Growing town, condos from $400K, GO Transit, established neighborhoods",tx:0.01199,ut:{1:205,2:250,3:300,4:345,5:395},ins:95},
  {n:"Ajax",r:"east",min:400000,avg:620000,max:1070000,d:"Lake Ontario views, condos from $400K, diverse community",tx:0.01183,ut:{1:205,2:250,3:300,4:345,5:395},ins:95},
  {n:"Bradford",r:"north",min:450000,avg:660000,max:1170000,d:"Between Toronto and Barrie, condos from $450K, GO Transit",tx:0.00998,ut:{1:200,2:245,3:295,4:340,5:390},ins:98},
  {n:"Newmarket",r:"north",min:420000,avg:650000,max:1270000,d:"Growing town, condos from $420K, GO Transit, historic downtown core",tx:0.00841,ut:{1:200,2:245,3:295,4:340,5:390},ins:98},
  {n:"Pickering",r:"east",min:420000,avg:650000,max:1170000,d:"Close to Toronto, condos from $420K, GO Transit",tx:0.01161,ut:{1:205,2:250,3:300,4:345,5:395},ins:98},
  {n:"Acton",r:"west",min:430000,avg:640000,max:1050000,d:"Affordable Halton option, small town feel",tx:0.00853,ut:{1:200,2:245,3:295,4:340,5:390},ins:95},
  {n:"Mississauga",r:"gta",min:380000,avg:650000,max:1470000,d:"Urban convenience, condos from $380K, excellent transit",tx:0.01034,ut:{1:205,2:250,3:305,4:350,5:400},ins:105},
  {n:"Brampton",r:"gta",min:400000,avg:660000,max:1080000,d:"Large South Asian community, condos from $400K, great value",tx:0.01039,ut:{1:210,2:255,3:310,4:355,5:405},ins:105},
  {n:"Toronto - Scarborough",r:"gta",min:360000,avg:580000,max:1170000,d:"Best value in Toronto, condos from $360K, diverse community",tx:0.00666,ut:{1:180,2:220,3:265,4:305,5:350},ins:105},
  {n:"Toronto - North York",r:"gta",min:400000,avg:680000,max:1760000,d:"Great transit, condos from $400K, diverse communities",tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:108},
  {n:"Toronto - East End",r:"gta",min:420000,avg:680000,max:1470000,d:"Leslieville, Danforth, The Beach, condos from $420K",tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:108},
  {n:"Toronto - Etobicoke",r:"gta",min:400000,avg:670000,max:1470000,d:"Close to airport, condos from $400K, lakefront areas",tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:108},
  {n:"Toronto - Downtown",r:"gta",min:420000,avg:720000,max:1960000,d:"Walkable urban lifestyle, condos from $420K, strong rental",tx:0.00666,ut:{1:160,2:195,3:235,4:270,5:315},ins:110},
  {n:"Erin",r:"duff",min:500000,avg:760000,max:1250000,d:"Charming village feel, large properties, close to Guelph",tx:0.01105,ut:{1:205,2:250,3:300,4:345,5:395},ins:108},
  {n:"Milton",r:"west",min:450000,avg:720000,max:1270000,d:"Fast-growing, condos from $450K, young families, great value",tx:0.00734,ut:{1:205,2:250,3:300,4:345,5:395},ins:105},
  {n:"Georgetown",r:"west",min:500000,avg:760000,max:1270000,d:"GO Transit access, established community",tx:0.00853,ut:{1:200,2:245,3:295,4:340,5:390},ins:108},
  {n:"Halton Hills",r:"west",min:500000,avg:760000,max:1270000,d:"Close to Brampton and Mississauga",tx:0.00853,ut:{1:200,2:245,3:295,4:340,5:390},ins:108},
  {n:"Bolton",r:"gta",min:520000,avg:760000,max:1170000,d:"40 min from Brampton, townhomes from $520K, family-friendly",tx:0.00842,ut:{1:205,2:250,3:300,4:345,5:395},ins:108},
  {n:"Aurora",r:"north",min:450000,avg:760000,max:1470000,d:"Upscale suburban, condos from $450K, low-density residential",tx:0.00803,ut:{1:205,2:250,3:300,4:345,5:395},ins:110},
  {n:"Toronto - West End",r:"gta",min:500000,avg:800000,max:1960000,d:"Roncesvalles, Bloor West, condos from $500K, trendy",tx:0.00666,ut:{1:185,2:225,3:270,4:315,5:365},ins:112},
  {n:"Vaughan",r:"north",min:460000,avg:800000,max:1760000,d:"Master-planned communities, condos from $460K, diverse",tx:0.00733,ut:{1:210,2:255,3:305,4:355,5:405},ins:112},
  {n:"Markham",r:"north",min:460000,avg:820000,max:1760000,d:"Tech hub, condos from $460K, top-ranked schools",tx:0.007,ut:{1:210,2:255,3:305,4:355,5:405},ins:112},
  {n:"Caledon",r:"gta",min:550000,avg:870000,max:1760000,d:"Rural charm, townhomes from $550K, larger lots",tx:0.00842,ut:{1:210,2:255,3:310,4:355,5:410},ins:110},
  {n:"Richmond Hill",r:"north",min:480000,avg:860000,max:1960000,d:"Prestigious address, condos from $480K, established community",tx:0.00737,ut:{1:210,2:255,3:305,4:355,5:405},ins:118},
  {n:"Burlington",r:"west",min:480000,avg:860000,max:1760000,d:"Lakefront city, condos from $480K, walkable downtown core",tx:0.00972,ut:{1:205,2:250,3:300,4:345,5:395},ins:115},
  {n:"Oakville",r:"west",min:520000,avg:1100000,max:2940000,d:"Upscale lakefront, condos from $520K, marina and waterfront trails",tx:0.0076,ut:{1:215,2:260,3:315,4:360,5:415},ins:145},
  {n:"Mono",r:"duff",min:700000,avg:1050000,max:1960000,d:"Estate lots, privacy, nature — ideal for families wanting space",tx:0.0066,ut:{1:215,2:260,3:315,4:360,5:415},ins:118},
  {n:"King City",r:"north",min:900000,avg:1500000,max:3920000,d:"Estate homes, rural luxury, large lots, very exclusive",tx:0.00829,ut:{1:225,2:275,3:330,4:380,5:435},ins:165}
];

// ── TYPICAL ENTRY PRICES (40th–50th percentile of active listings, 2025) ──
// null = this property type does not realistically exist in this city at
// buyer-accessible prices. The filter suppresses it entirely.
// These are NOT floor prices. They represent what a typical buyer actually needs
// to spend to enter this market for a liveable, representative property.
const PT={
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
const CONDO_FEES={
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
