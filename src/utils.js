// utils.js — HomePilot small shared helpers and static reference data
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/utils.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: CITY_GEO (lat/lng/zoom per city, used by map-related features),
// INCOM_PROP (property-type mapping for INCOM listing links), buildIncomUrl(),
// fc() (currency formatter), PROP_LABELS, getPriceForType() (the non-strict
// variant — see ranking.js for getPriceForTypeStrict), and
// estimateOntarioNetAnnual() (gross-to-net income estimate).
//
// Note: the actual loadScenarioFromURL() CALL (as opposed to its definition,
// which lives in scenario-share.js) intentionally stays at the very end of
// index.html's own inline script — it's real init code that must run last,
// after every module has loaded, not a definition to relocate.

const CITY_GEO={"Welland":{lat:42.9922,lng:-79.2482,zoom:12},"Fort Erie":{lat:42.9154,lng:-79.0202,zoom:12},"Belleville":{lat:44.1628,lng:-77.3832,zoom:12},"Oshawa":{lat:43.8971,lng:-78.8658,zoom:12},"Hamilton":{lat:43.2557,lng:-79.8711,zoom:12},"Peterborough":{lat:44.3091,lng:-78.3197,zoom:12},"Barrie":{lat:44.3894,lng:-79.6903,zoom:12},"Midland":{lat:44.7493,lng:-79.8883,zoom:12},"Kingston":{lat:44.2312,lng:-76.4860,zoom:12},"St. Catharines":{lat:43.1594,lng:-79.2469,zoom:12},"Niagara Falls":{lat:43.1066,lng:-79.0687,zoom:12},"Wasaga Beach":{lat:44.5204,lng:-80.0166,zoom:12},"Cobourg":{lat:43.9594,lng:-78.1677,zoom:12},"Ottawa":{lat:45.4215,lng:-75.6972,zoom:11},"Grand Valley":{lat:43.9001,lng:-80.0478,zoom:13},"Shelburne":{lat:44.0784,lng:-80.2042,zoom:13},"Innisfil":{lat:44.3001,lng:-79.5833,zoom:12},"Georgina":{lat:44.3001,lng:-79.4333,zoom:12},"Centre Wellington":{lat:43.7001,lng:-80.3833,zoom:12},"Clarington":{lat:43.9167,lng:-78.6000,zoom:12},"Scugog":{lat:44.1001,lng:-78.9500,zoom:12},"Cambridge":{lat:43.3601,lng:-80.3123,zoom:12},"Kitchener":{lat:43.4516,lng:-80.4925,zoom:12},"Waterloo":{lat:43.4668,lng:-80.5164,zoom:12},"Collingwood":{lat:44.5001,lng:-80.2167,zoom:12},"Guelph":{lat:43.5448,lng:-80.2482,zoom:12},"Orangeville":{lat:43.9193,lng:-80.0940,zoom:13},"Acton":{lat:43.6334,lng:-80.0333,zoom:13},"Whitby":{lat:43.8975,lng:-78.9429,zoom:12},"Ajax":{lat:43.8508,lng:-79.0209,zoom:12},"Pickering":{lat:43.8384,lng:-79.0868,zoom:12},"Bradford":{lat:44.1167,lng:-79.5500,zoom:12},"Newmarket":{lat:44.0501,lng:-79.4663,zoom:12},"Brampton":{lat:43.7315,lng:-79.7624,zoom:12},"Toronto - Scarborough":{lat:43.7764,lng:-79.2318,zoom:12},"Mississauga":{lat:43.5890,lng:-79.6441,zoom:12},"Milton":{lat:43.5183,lng:-79.8774,zoom:12},"Georgetown":{lat:43.6501,lng:-79.9167,zoom:13},"Halton Hills":{lat:43.6501,lng:-79.9167,zoom:12},"Bolton":{lat:43.8784,lng:-79.7330,zoom:13},"Erin":{lat:43.7667,lng:-80.0667,zoom:13},"Aurora":{lat:44.0001,lng:-79.4500,zoom:12},"Toronto - Etobicoke":{lat:43.6501,lng:-79.5500,zoom:12},"Toronto - North York":{lat:43.7615,lng:-79.4111,zoom:12},"Toronto - East End":{lat:43.6751,lng:-79.3000,zoom:12},"Toronto - West End":{lat:43.6501,lng:-79.4500,zoom:12},"Toronto - Downtown":{lat:43.6532,lng:-79.3832,zoom:13},"Burlington":{lat:43.3255,lng:-79.7990,zoom:12},"Vaughan":{lat:43.8361,lng:-79.4982,zoom:12},"Markham":{lat:43.8561,lng:-79.3370,zoom:12},"Caledon":{lat:43.8784,lng:-79.8686,zoom:12},"Richmond Hill":{lat:43.8828,lng:-79.4403,zoom:12},"Oakville":{lat:43.4675,lng:-79.6877,zoom:12},"Mono":{lat:44.0167,lng:-80.0667,zoom:13},"King City":{lat:43.9334,lng:-79.5333,zoom:13}};
const INCOM_PROP={condo:["Apartment/Condo","Condo Apt","Co-op Apt","Stacked"],town:["Attached/Townhouse","Row/Townhouse"],semi:["Semi-Detached"],detached:["Detached","Bungalow"],all:[]};

function buildIncomUrl(cityName,maxPrice,propType){
  const geo=CITY_GEO[cityName]||{lat:43.7,lng:-79.4,zoom:11};
  const showOnly=INCOM_PROP[propType]&&INCOM_PROP[propType].length?INCOM_PROP[propType]:[];
  const minPrice=maxPrice>0?Math.round(maxPrice*0.75/1000)*1000:0;
  const search={searchType:"residential",listingType:["Sale"],openHouse:{from:0,to:0},bed:0,marketdays:0,bath:0,searchBy:"searchall",searchByText:cityName+", ON, Canada",priceRange:{min:minPrice,max:maxPrice>0?Math.round(maxPrice/1000)*1000:0},feetRange:{min:0,max:0},showOnly:showOnly,priceDrop:false,powerOfSale:false,sortby:"highprice",condoType:"",condoOccupancy:"",condoStatus:"",condoBuilder:"",keywords:[],PostalCode:false,Province:false,City:false};
  const data={search,location:{Longitude:geo.lng,Latitude:geo.lat,Zoom:geo.zoom||12,mapViewType:"roadmap",mapInfoType:[],selectedPathID:"",Bounds:{south:geo.lat-0.08,west:geo.lng-0.15,north:geo.lat+0.08,east:geo.lng+0.15}},controlSpecial:{}};
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  return`https://www.sandeeptakhar.com/mapsearchapp/search/${encoded}`;
}

function fc(n){return new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n);}

const PROP_LABELS={condo:"Condo",town:"Townhouse",semi:"Semi-Detached",detached:"Detached"};
function getPriceForType(cityName,type,bp){
  const t=PT[cityName];if(!t)return type==='all'?bp:null;
  const price=t[type];
  if(!price)return null; // null in PT means property type doesn't exist here
  if(!meetsMinDownPayment(price,dn_selected))return null; // explicit DP safety check
  // Allow up to 10% over buying power (Stretch zone), not 30%
  return price<=bp*1.10?price:null;
}

function estimateOntarioNetAnnual(grossAnnual){
  let fed=0;
  if(grossAnnual<=55867)fed=grossAnnual*0.15;else if(grossAnnual<=111733)fed=8380+(grossAnnual-55867)*0.205;else if(grossAnnual<=154906)fed=19822+(grossAnnual-111733)*0.26;else if(grossAnnual<=220000)fed=31043+(grossAnnual-154906)*0.29;else fed=49945+(grossAnnual-220000)*0.33;
  fed=Math.max(0,fed-2232);
  let ont=0;
  if(grossAnnual<=51446)ont=grossAnnual*0.0505;else if(grossAnnual<=102894)ont=2598+(grossAnnual-51446)*0.0915;else if(grossAnnual<=150000)ont=7308+(grossAnnual-102894)*0.1116;else if(grossAnnual<=220000)ont=12564+(grossAnnual-150000)*0.1216;else ont=21076+(grossAnnual-220000)*0.1316;
  ont=Math.max(0,ont-579);
  const cpp=Math.min(grossAnnual*0.0595,3867),ei=Math.min(grossAnnual*0.0166,1049);
  return Math.max(0,grossAnnual-(fed+ont+cpp+ei));
}
