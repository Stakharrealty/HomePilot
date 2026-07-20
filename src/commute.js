// commute.js — HomePilot commute calculation
//
// Extracted from index.html on July 20, 2026 as part of Phase 2 (splitting the
// single-file app into modules). Pure relocation — no logic changed, no values
// changed. Loaded via <script src="src/commute.js"></script> before the main
// inline script, same shared global scope as before.
//
// Contains: DRIVE_TABLE, FSA_TO_WORK_ZONE, CITY_TO_WORK_ZONE, getWorkZone(),
// SUBZONE_ADJUST, calcCommuteMinutes(), getCommuteScore(), ACCESS_TIERS,
// getAccessTier(). Depends on the global `workZone` variable, which is set
// elsewhere (main script) — unchanged from original behavior.

const DRIVE_TABLE = {
  // ── DUFFERIN / ORANGEVILLE BELT (no 400-series, county roads) ──
  'Grand Valley':     {brampton:65, mississauga:80, toronto_west:90, toronto_downtown:100, toronto_north:95, toronto_east:110, vaughan:80, markham:110, richmond_hill:90, oakville:90, burlington:100, hamilton:110, ajax_whitby:120, newmarket_aurora:95, barrie:120, kitchener:110, guelph:90, milton:70, georgetown:55, orangeville:20, shelburne:30, mono:25, bolton:55, caledon:50, king_city:80, erin:65, scarborough:115, pickering:120, oshawa:130, ajax:125, whitby:128, georgina:110, scugog:130, innisfil:115, collingwood:140, wasaga_beach:135, midland:150, st_catharines:145, niagara_falls:155, welland:160, fort_erie:170, acton:60, centre_wellington:55, cobourg:165, peterborough:160, belleville:200, kingston:245, ottawa:480},
  'Shelburne':        {brampton:70, mississauga:85, toronto_west:95, toronto_downtown:105, toronto_north:100, toronto_east:115, vaughan:85, markham:115, richmond_hill:95, oakville:95, burlington:105, hamilton:115, ajax_whitby:125, newmarket_aurora:100, barrie:110, kitchener:105, guelph:85, milton:75, georgetown:60, orangeville:20, shelburne:5,  mono:35, bolton:65, caledon:60, king_city:90, erin:75, scarborough:120, pickering:125, oshawa:135, ajax:130, whitby:133, georgina:115, scugog:135, innisfil:115, collingwood:140, wasaga_beach:135, midland:155, st_catharines:145, niagara_falls:155, welland:160, fort_erie:170, acton:70, centre_wellington:60, cobourg:170, peterborough:165, belleville:205, kingston:250, ottawa:485},
  'Mono':             {brampton:55, mississauga:70, toronto_west:80, toronto_downtown:90,  toronto_north:80,  toronto_east:100, vaughan:65, markham:95,  richmond_hill:75, oakville:80, burlington:90,  hamilton:100, ajax_whitby:110, newmarket_aurora:80,  barrie:100, kitchener:100, guelph:80, milton:60, georgetown:50, orangeville:20, shelburne:35, mono:5,  bolton:30, caledon:25, king_city:60, erin:45, scarborough:105, pickering:110, oshawa:120, ajax:115, whitby:118, georgina:95,  scugog:120, innisfil:100, collingwood:125, wasaga_beach:120, midland:135, st_catharines:135, niagara_falls:145, welland:150, fort_erie:160, acton:50, centre_wellington:65, cobourg:155, peterborough:150, belleville:190, kingston:235, ottawa:470},
  'Orangeville':      {brampton:55, mississauga:70, toronto_west:80, toronto_downtown:90,  toronto_north:80,  toronto_east:100, vaughan:65, markham:95,  richmond_hill:75, oakville:80, burlington:90,  hamilton:100, ajax_whitby:110, newmarket_aurora:80,  barrie:95,  kitchener:95,  guelph:75, milton:55, georgetown:45, orangeville:5,  shelburne:20, mono:20, bolton:35, caledon:30, king_city:65, erin:50, scarborough:105, pickering:110, oshawa:120, ajax:115, whitby:118, georgina:95,  scugog:120, innisfil:100, collingwood:125, wasaga_beach:120, midland:135, st_catharines:130, niagara_falls:140, welland:145, fort_erie:155, acton:50, centre_wellington:60, cobourg:155, peterborough:150, belleville:190, kingston:235, ottawa:470},
  'Erin':             {brampton:45, mississauga:55, toronto_west:65, toronto_downtown:75,  toronto_north:70,  toronto_east:85,  vaughan:70, markham:90,  richmond_hill:75, oakville:55, burlington:65,  hamilton:75,  ajax_whitby:100, newmarket_aurora:80,  barrie:110, kitchener:80,  guelph:55, milton:35, georgetown:25, orangeville:45, shelburne:60, mono:40, bolton:50, caledon:45, king_city:75, erin:5,  scarborough:90,  pickering:95,  oshawa:105, ajax:100, whitby:103, georgina:100, scugog:110, innisfil:115, collingwood:140, wasaga_beach:135, midland:150, st_catharines:110, niagara_falls:120, welland:125, fort_erie:135, acton:30, centre_wellington:55, cobourg:145, peterborough:135, belleville:180, kingston:225, ottawa:460},

  // ── BOLTON / CALEDON / KING (Hwy 50 / Hwy 27 / no direct 400) ──
  'Bolton':           {brampton:30, mississauga:45, toronto_west:50, toronto_downtown:60,  toronto_north:45,  toronto_east:70,  vaughan:30, markham:60,  richmond_hill:45, oakville:55, burlington:65,  hamilton:80,  ajax_whitby:85,  newmarket_aurora:50,  barrie:80,  kitchener:90,  guelph:70, milton:45, georgetown:30, orangeville:35, shelburne:55, mono:25, bolton:5,  caledon:20, king_city:35, erin:45, scarborough:75,  pickering:80,  oshawa:90,  ajax:85,  whitby:88,  georgina:65,  scugog:95,  innisfil:75,  collingwood:105, wasaga_beach:100, midland:115, st_catharines:115, niagara_falls:125, welland:130, fort_erie:140, acton:45, centre_wellington:80, cobourg:130, peterborough:120, belleville:165, kingston:210, ottawa:445},
  'Caledon':          {brampton:35, mississauga:50, toronto_west:55, toronto_downtown:65,  toronto_north:50,  toronto_east:75,  vaughan:40, markham:70,  richmond_hill:50, oakville:60, burlington:70,  hamilton:85,  ajax_whitby:90,  newmarket_aurora:55,  barrie:85,  kitchener:95,  guelph:75, milton:45, georgetown:30, orangeville:30, shelburne:50, mono:20, bolton:20, caledon:5,  king_city:40, erin:40, scarborough:80,  pickering:85,  oshawa:95,  ajax:90,  whitby:93,  georgina:70,  scugog:100, innisfil:80,  collingwood:110, wasaga_beach:105, midland:120, st_catharines:120, niagara_falls:130, welland:135, fort_erie:145, acton:45, centre_wellington:80, cobourg:135, peterborough:125, belleville:170, kingston:215, ottawa:450},
  'King City':        {brampton:50, mississauga:60, toronto_west:55, toronto_downtown:55,  toronto_north:35,  toronto_east:60,  vaughan:20, markham:45,  richmond_hill:25, oakville:65, burlington:75,  hamilton:90,  ajax_whitby:75,  newmarket_aurora:30,  barrie:65,  kitchener:105, guelph:85, milton:55, georgetown:50, orangeville:60, shelburne:80, mono:50, bolton:35, caledon:40, king_city:5,  erin:70, scarborough:65,  pickering:75,  oshawa:85,  ajax:80,  whitby:83,  georgina:55,  scugog:85,  innisfil:60,  collingwood:90,  wasaga_beach:85,  midland:100, st_catharines:130, niagara_falls:140, welland:145, fort_erie:155, acton:70, centre_wellington:100, cobourg:115, peterborough:110, belleville:155, kingston:200, ottawa:430},

  // ── HALTON / WEST GTA (Hwy 401, QEW, 407 access) ──
  'Georgetown':       {brampton:30, mississauga:35, toronto_west:45, toronto_downtown:55,  toronto_north:55,  toronto_east:65,  vaughan:55, markham:75,  richmond_hill:65, oakville:25, burlington:35,  hamilton:55,  ajax_whitby:85,  newmarket_aurora:70,  barrie:100, kitchener:65,  guelph:40, milton:25, georgetown:5,  orangeville:45, shelburne:60, mono:45, bolton:30, caledon:30, king_city:50, erin:25, scarborough:75,  pickering:80,  oshawa:90,  ajax:85,  whitby:88,  georgina:85,  scugog:100, innisfil:100, collingwood:125, wasaga_beach:120, midland:135, st_catharines:95,  niagara_falls:105, welland:110, fort_erie:120, acton:15, centre_wellington:45, cobourg:125, peterborough:120, belleville:160, kingston:205, ottawa:440},
  'Halton Hills':     {brampton:30, mississauga:35, toronto_west:45, toronto_downtown:55,  toronto_north:55,  toronto_east:65,  vaughan:55, markham:75,  richmond_hill:65, oakville:25, burlington:35,  hamilton:55,  ajax_whitby:85,  newmarket_aurora:70,  barrie:100, kitchener:65,  guelph:40, milton:25, georgetown:5,  orangeville:45, shelburne:60, mono:45, bolton:30, caledon:30, king_city:50, erin:25, scarborough:75,  pickering:80,  oshawa:90,  ajax:85,  whitby:88,  georgina:85,  scugog:100, innisfil:100, collingwood:125, wasaga_beach:120, midland:135, st_catharines:95,  niagara_falls:105, welland:110, fort_erie:120, acton:15, centre_wellington:45, cobourg:125, peterborough:120, belleville:160, kingston:205, ottawa:440},
  'Acton':            {brampton:40, mississauga:45, toronto_west:55, toronto_downtown:65,  toronto_north:65,  toronto_east:75,  vaughan:65, markham:85,  richmond_hill:75, oakville:35, burlington:45,  hamilton:60,  ajax_whitby:95,  newmarket_aurora:80,  barrie:110, kitchener:55,  guelph:30, milton:30, georgetown:15, orangeville:50, shelburne:65, mono:50, bolton:40, caledon:40, king_city:65, erin:30, scarborough:85,  pickering:90,  oshawa:100, ajax:95,  whitby:98,  georgina:95,  scugog:110, innisfil:110, collingwood:135, wasaga_beach:130, midland:145, st_catharines:100, niagara_falls:110, welland:115, fort_erie:125, acton:5,  centre_wellington:40, cobourg:135, peterborough:130, belleville:170, kingston:215, ottawa:450},
  'Milton':           {brampton:30, mississauga:30, toronto_west:40, toronto_downtown:50,  toronto_north:55,  toronto_east:60,  vaughan:55, markham:70,  richmond_hill:65, oakville:20, burlington:25,  hamilton:45,  ajax_whitby:80,  newmarket_aurora:75,  barrie:105, kitchener:60,  guelph:35, milton:5,  georgetown:25, orangeville:55, shelburne:70, mono:55, bolton:45, caledon:45, king_city:55, erin:35, scarborough:70,  pickering:75,  oshawa:85,  ajax:80,  whitby:83,  georgina:90,  scugog:100, innisfil:100, collingwood:130, wasaga_beach:125, midland:140, st_catharines:85,  niagara_falls:95,  welland:100, fort_erie:110, acton:30, centre_wellington:50, cobourg:120, peterborough:115, belleville:155, kingston:200, ottawa:435},
  'Oakville':         {brampton:35, mississauga:20, toronto_west:30, toronto_downtown:40,  toronto_north:50,  toronto_east:50,  vaughan:50, markham:65,  richmond_hill:60, oakville:5,  burlington:20,  hamilton:35,  ajax_whitby:75,  newmarket_aurora:75,  barrie:110, kitchener:70,  guelph:50, milton:20, georgetown:25, orangeville:75, shelburne:90, mono:70, bolton:55, caledon:60, king_city:65, erin:55, scarborough:65,  pickering:70,  oshawa:80,  ajax:75,  whitby:78,  georgina:95,  scugog:100, innisfil:110, collingwood:140, wasaga_beach:135, midland:150, st_catharines:75,  niagara_falls:85,  welland:90,  fort_erie:100, acton:35, centre_wellington:65, cobourg:115, peterborough:115, belleville:155, kingston:200, ottawa:435},
  'Burlington':       {brampton:45, mississauga:30, toronto_west:40, toronto_downtown:50,  toronto_north:60,  toronto_east:60,  vaughan:60, markham:75,  richmond_hill:70, oakville:20, burlington:5,   hamilton:20,  ajax_whitby:85,  newmarket_aurora:85,  barrie:120, kitchener:65,  guelph:45, milton:25, georgetown:35, orangeville:85, shelburne:100, mono:80, bolton:65, caledon:70, king_city:75, erin:65, scarborough:75,  pickering:80,  oshawa:90,  ajax:85,  whitby:88,  georgina:105, scugog:110, innisfil:120, collingwood:150, wasaga_beach:145, midland:160, st_catharines:60,  niagara_falls:70,  welland:75,  fort_erie:85,  acton:45, centre_wellington:65, cobourg:125, peterborough:125, belleville:165, kingston:210, ottawa:445},

  // ── BRAMPTON / MISSISSAUGA / TORONTO (GTA core) ──
  'Brampton':         {brampton:10, mississauga:25, toronto_west:35, toronto_downtown:45,  toronto_north:40,  toronto_east:55,  vaughan:35, markham:60,  richmond_hill:50, oakville:35, burlington:45,  hamilton:65,  ajax_whitby:75,  newmarket_aurora:55,  barrie:90,  kitchener:90,  guelph:65, milton:30, georgetown:25, orangeville:55, shelburne:70, mono:50, bolton:30, caledon:35, king_city:50, erin:45, scarborough:65,  pickering:65,  oshawa:80,  ajax:70,  whitby:75,  georgina:75,  scugog:90,  innisfil:90,  collingwood:120, wasaga_beach:115, midland:130, st_catharines:100, niagara_falls:110, welland:115, fort_erie:125, acton:40, centre_wellington:80, cobourg:115, peterborough:115, belleville:160, kingston:205, ottawa:440},
  'Mississauga':      {brampton:25, mississauga:10, toronto_west:20, toronto_downtown:35,  toronto_north:45,  toronto_east:45,  vaughan:45, markham:60,  richmond_hill:55, oakville:20, burlington:30,  hamilton:50,  ajax_whitby:70,  newmarket_aurora:70,  barrie:105, kitchener:80,  guelph:55, milton:30, georgetown:35, orangeville:70, shelburne:85, mono:65, bolton:45, caledon:50, king_city:60, erin:55, scarborough:55,  pickering:60,  oshawa:75,  ajax:65,  whitby:68,  georgina:85,  scugog:90,  innisfil:100, collingwood:130, wasaga_beach:125, midland:140, st_catharines:85,  niagara_falls:95,  welland:100, fort_erie:110, acton:45, centre_wellington:75, cobourg:110, peterborough:110, belleville:155, kingston:200, ottawa:435},
  'Toronto - Downtown':    {brampton:45, mississauga:35, toronto_west:20, toronto_downtown:10, toronto_north:25,  toronto_east:20,  vaughan:40, markham:45,  richmond_hill:45, oakville:40, burlington:50,  hamilton:70,  ajax_whitby:60,  newmarket_aurora:65,  barrie:100, kitchener:95,  guelph:75, milton:50, georgetown:55, orangeville:90, shelburne:105, mono:85, bolton:60, caledon:65, king_city:55, erin:75, scarborough:35,  pickering:40,  oshawa:65,  ajax:50,  whitby:55,  georgina:80,  scugog:85,  innisfil:95,  collingwood:130, wasaga_beach:125, midland:140, st_catharines:105, niagara_falls:115, welland:120, fort_erie:130, acton:65, centre_wellington:90, cobourg:100, peterborough:110, belleville:150, kingston:195, ottawa:430},
  'Toronto - West End':    {brampton:35, mississauga:25, toronto_west:10, toronto_downtown:20, toronto_north:30,  toronto_east:30,  vaughan:40, markham:50,  richmond_hill:50, oakville:30, burlington:40,  hamilton:60,  ajax_whitby:65,  newmarket_aurora:65,  barrie:100, kitchener:90,  guelph:70, milton:40, georgetown:45, orangeville:80, shelburne:95, mono:75, bolton:50, caledon:55, king_city:55, erin:65, scarborough:40,  pickering:50,  oshawa:65,  ajax:55,  whitby:60,  georgina:80,  scugog:85,  innisfil:95,  collingwood:130, wasaga_beach:125, midland:140, st_catharines:100, niagara_falls:110, welland:115, fort_erie:125, acton:55, centre_wellington:85, cobourg:105, peterborough:110, belleville:155, kingston:200, ottawa:435},
  'Toronto - East End':    {brampton:55, mississauga:45, toronto_west:30, toronto_downtown:20, toronto_north:35,  toronto_east:10,  vaughan:50, markham:35,  richmond_hill:45, oakville:50, burlington:60,  hamilton:80,  ajax_whitby:45,  newmarket_aurora:65,  barrie:100, kitchener:105, guelph:85, milton:60, georgetown:65, orangeville:100, shelburne:115, mono:95, bolton:70, caledon:75, king_city:60, erin:85, scarborough:20,  pickering:30,  oshawa:50,  ajax:40,  whitby:43,  georgina:80,  scugog:80,  innisfil:100, collingwood:135, wasaga_beach:130, midland:145, st_catharines:115, niagara_falls:125, welland:130, fort_erie:140, acton:75, centre_wellington:100, cobourg:90,  peterborough:100, belleville:140, kingston:185, ottawa:420},
  'Toronto - North York':  {brampton:45, mississauga:45, toronto_west:30, toronto_downtown:25, toronto_north:15,  toronto_east:30,  vaughan:25, markham:30,  richmond_hill:30, oakville:50, burlington:60,  hamilton:80,  ajax_whitby:55,  newmarket_aurora:45,  barrie:85,  kitchener:100, guelph:80, milton:55, georgetown:50, orangeville:80, shelburne:95, mono:75, bolton:50, caledon:50, king_city:35, erin:70, scarborough:40,  pickering:50,  oshawa:65,  ajax:55,  whitby:60,  georgina:65,  scugog:75,  innisfil:80,  collingwood:115, wasaga_beach:110, midland:125, st_catharines:115, niagara_falls:125, welland:130, fort_erie:140, acton:65, centre_wellington:95, cobourg:105, peterborough:105, belleville:150, kingston:195, ottawa:430},
  'Toronto - Etobicoke':   {brampton:30, mississauga:20, toronto_west:15, toronto_downtown:25, toronto_north:35,  toronto_east:35,  vaughan:40, markham:55,  richmond_hill:50, oakville:25, burlington:35,  hamilton:55,  ajax_whitby:70,  newmarket_aurora:65,  barrie:100, kitchener:85,  guelph:65, milton:35, georgetown:40, orangeville:75, shelburne:90, mono:70, bolton:50, caledon:55, king_city:55, erin:60, scarborough:50,  pickering:55,  oshawa:70,  ajax:60,  whitby:65,  georgina:85,  scugog:90,  innisfil:100, collingwood:135, wasaga_beach:130, midland:145, st_catharines:90,  niagara_falls:100, welland:105, fort_erie:115, acton:50, centre_wellington:80, cobourg:110, peterborough:110, belleville:155, kingston:200, ottawa:435},
  'Toronto - Scarborough': {brampton:60, mississauga:50, toronto_west:40, toronto_downtown:30, toronto_north:40,  toronto_east:15,  vaughan:55, markham:30,  richmond_hill:40, oakville:55, burlington:65,  hamilton:85,  ajax_whitby:35,  newmarket_aurora:65,  barrie:100, kitchener:110, guelph:90, milton:65, georgetown:70, orangeville:105, shelburne:120, mono:100, bolton:75, caledon:80, king_city:65, erin:90, scarborough:10,  pickering:25,  oshawa:45,  ajax:35,  whitby:38,  georgina:80,  scugog:75,  innisfil:100, collingwood:135, wasaga_beach:130, midland:145, st_catharines:120, niagara_falls:130, welland:135, fort_erie:145, acton:80, centre_wellington:105, cobourg:85,  peterborough:95,  belleville:135, kingston:180, ottawa:415},

  // ── VAUGHAN / YORK REGION (Hwy 400, 404, 407) ──
  'Vaughan':          {brampton:35, mississauga:45, toronto_west:40, toronto_downtown:40,  toronto_north:25,  toronto_east:50,  vaughan:10, markham:35,  richmond_hill:20, oakville:50, burlington:60,  hamilton:80,  ajax_whitby:65,  newmarket_aurora:30,  barrie:65,  kitchener:100, guelph:80, milton:50, georgetown:45, orangeville:65, shelburne:85, mono:55, bolton:30, caledon:40, king_city:20, erin:70, scarborough:60,  pickering:65,  oshawa:80,  ajax:70,  whitby:73,  georgina:55,  scugog:85,  innisfil:70,  collingwood:100, wasaga_beach:95,  midland:110, st_catharines:115, niagara_falls:125, welland:130, fort_erie:140, acton:65, centre_wellington:95, cobourg:110, peterborough:105, belleville:150, kingston:195, ottawa:430},
  'Richmond Hill':    {brampton:50, mississauga:55, toronto_west:50, toronto_downtown:45,  toronto_north:30,  toronto_east:40,  vaughan:20, markham:25,  richmond_hill:10, oakville:65, burlington:75,  hamilton:90,  ajax_whitby:55,  newmarket_aurora:25,  barrie:60,  kitchener:110, guelph:90, milton:65, georgetown:60, orangeville:75, shelburne:95, mono:65, bolton:45, caledon:50, king_city:25, erin:80, scarborough:50,  pickering:55,  oshawa:70,  ajax:60,  whitby:63,  georgina:50,  scugog:75,  innisfil:65,  collingwood:95,  wasaga_beach:90,  midland:105, st_catharines:125, niagara_falls:135, welland:140, fort_erie:150, acton:75, centre_wellington:105, cobourg:105, peterborough:100, belleville:145, kingston:190, ottawa:425},
  'Markham':          {brampton:60, mississauga:60, toronto_west:55, toronto_downtown:45,  toronto_north:30,  toronto_east:35,  vaughan:35, markham:10,  richmond_hill:25, oakville:70, burlington:80,  hamilton:95,  ajax_whitby:40,  newmarket_aurora:40,  barrie:80,  kitchener:115, guelph:95, milton:70, georgetown:70, orangeville:90, shelburne:110, mono:80, bolton:60, caledon:65, king_city:45, erin:90, scarborough:35,  pickering:40,  oshawa:55,  ajax:45,  whitby:50,  georgina:55,  scugog:65,  innisfil:85,  collingwood:115, wasaga_beach:110, midland:125, st_catharines:130, niagara_falls:140, welland:145, fort_erie:155, acton:85, centre_wellington:115, cobourg:95,  peterborough:95,  belleville:135, kingston:180, ottawa:415},
  'Aurora':           {brampton:55, mississauga:65, toronto_west:60, toronto_downtown:55,  toronto_north:40,  toronto_east:55,  vaughan:30, markham:40,  richmond_hill:20, oakville:75, burlington:85,  hamilton:100, ajax_whitby:65,  newmarket_aurora:15,  barrie:50,  kitchener:115, guelph:95, milton:70, georgetown:60, orangeville:75, shelburne:95, mono:65, bolton:50, caledon:55, king_city:30, erin:85, scarborough:65,  pickering:70,  oshawa:80,  ajax:75,  whitby:78,  georgina:40,  scugog:80,  innisfil:55,  collingwood:85,  wasaga_beach:80,  midland:100, st_catharines:135, niagara_falls:145, welland:150, fort_erie:160, acton:80, centre_wellington:110, cobourg:110, peterborough:105, belleville:150, kingston:195, ottawa:430},
  'Newmarket':        {brampton:60, mississauga:70, toronto_west:65, toronto_downtown:60,  toronto_north:45,  toronto_east:60,  vaughan:35, markham:45,  richmond_hill:25, oakville:80, burlington:90,  hamilton:105, ajax_whitby:70,  newmarket_aurora:10,  barrie:45,  kitchener:120, guelph:100, milton:75, georgetown:65, orangeville:80, shelburne:100, mono:70, bolton:55, caledon:60, king_city:35, erin:90, scarborough:70,  pickering:75,  oshawa:85,  ajax:80,  whitby:83,  georgina:35,  scugog:85,  innisfil:50,  collingwood:80,  wasaga_beach:75,  midland:95,  st_catharines:140, niagara_falls:150, welland:155, fort_erie:165, acton:85, centre_wellington:115, cobourg:110, peterborough:105, belleville:150, kingston:195, ottawa:430},
  'Bradford':         {brampton:65, mississauga:75, toronto_west:70, toronto_downtown:65,  toronto_north:50,  toronto_east:65,  vaughan:40, markham:55,  richmond_hill:35, oakville:85, burlington:95,  hamilton:110, ajax_whitby:80,  newmarket_aurora:20,  barrie:35,  kitchener:125, guelph:105, milton:80, georgetown:70, orangeville:85, shelburne:105, mono:75, bolton:60, caledon:65, king_city:40, erin:95, scarborough:75,  pickering:80,  oshawa:90,  ajax:85,  whitby:88,  georgina:40,  scugog:90,  innisfil:40,  collingwood:70,  wasaga_beach:65,  midland:85,  st_catharines:145, niagara_falls:155, welland:160, fort_erie:170, acton:90, centre_wellington:120, cobourg:115, peterborough:110, belleville:155, kingston:200, ottawa:435},
  'Georgina':         {brampton:75, mississauga:85, toronto_west:80, toronto_downtown:75,  toronto_north:60,  toronto_east:70,  vaughan:50, markham:55,  richmond_hill:40, oakville:95, burlington:105, hamilton:120, ajax_whitby:80,  newmarket_aurora:30,  barrie:55,  kitchener:130, guelph:110, milton:95, georgetown:85, orangeville:100, shelburne:120, mono:90, bolton:70, caledon:75, king_city:55, erin:110, scarborough:80,  pickering:85,  oshawa:90,  ajax:85,  whitby:85,  georgina:5,   scugog:95,  innisfil:65,  collingwood:90,  wasaga_beach:85,  midland:105, st_catharines:155, niagara_falls:165, welland:170, fort_erie:180, acton:105, centre_wellington:135, cobourg:120, peterborough:110, belleville:155, kingston:200, ottawa:430},

  // ── DURHAM REGION (Hwy 401, 407 east) ──
  'Pickering':        {brampton:60, mississauga:50, toronto_west:45, toronto_downtown:40,  toronto_north:50,  toronto_east:25,  vaughan:60, markham:35,  richmond_hill:45, oakville:60, burlington:70,  hamilton:90,  ajax_whitby:15,  newmarket_aurora:65,  barrie:100, kitchener:115, guelph:95, milton:70, georgetown:70, orangeville:105, shelburne:120, mono:100, bolton:80, caledon:85, king_city:75, erin:95, scarborough:25,  pickering:5,   oshawa:30,  ajax:15,  whitby:20,  georgina:85,  scugog:65,  innisfil:105, collingwood:140, wasaga_beach:135, midland:150, st_catharines:125, niagara_falls:135, welland:140, fort_erie:150, acton:85, centre_wellington:115, cobourg:80,  peterborough:90,  belleville:130, kingston:175, ottawa:410},
  'Ajax':             {brampton:65, mississauga:55, toronto_west:50, toronto_downtown:45,  toronto_north:55,  toronto_east:30,  vaughan:65, markham:35,  richmond_hill:50, oakville:65, burlington:75,  hamilton:95,  ajax_whitby:10,  newmarket_aurora:70,  barrie:105, kitchener:120, guelph:100, milton:75, georgetown:75, orangeville:110, shelburne:125, mono:105, bolton:85, caledon:90, king_city:80, erin:100, scarborough:30,  pickering:15,  oshawa:25,  ajax:5,   whitby:15,  georgina:85,  scugog:60,  innisfil:105, collingwood:140, wasaga_beach:135, midland:150, st_catharines:130, niagara_falls:140, welland:145, fort_erie:155, acton:90, centre_wellington:120, cobourg:75,  peterborough:85,  belleville:125, kingston:170, ottawa:405},
  'Whitby':           {brampton:70, mississauga:60, toronto_west:55, toronto_downtown:55,  toronto_north:60,  toronto_east:40,  vaughan:70, markham:45,  richmond_hill:55, oakville:70, burlington:80,  hamilton:100, ajax_whitby:15,  newmarket_aurora:75,  barrie:110, kitchener:125, guelph:105, milton:80, georgetown:80, orangeville:115, shelburne:130, mono:110, bolton:90, caledon:95, king_city:85, erin:105, scarborough:35,  pickering:20,  oshawa:20,  ajax:15,  whitby:5,   georgina:90,  scugog:55,  innisfil:110, collingwood:145, wasaga_beach:140, midland:155, st_catharines:135, niagara_falls:145, welland:150, fort_erie:160, acton:95, centre_wellington:125, cobourg:70,  peterborough:80,  belleville:120, kingston:165, ottawa:400},
  'Oshawa':           {brampton:80, mississauga:70, toronto_west:65, toronto_downtown:65,  toronto_north:70,  toronto_east:50,  vaughan:80, markham:55,  richmond_hill:65, oakville:80, burlington:90,  hamilton:110, ajax_whitby:25,  newmarket_aurora:85,  barrie:120, kitchener:135, guelph:115, milton:90, georgetown:90, orangeville:125, shelburne:140, mono:120, bolton:100, caledon:105, king_city:95, erin:115, scarborough:45,  pickering:30,  oshawa:5,   ajax:25,  whitby:20,  georgina:95,  scugog:45,  innisfil:115, collingwood:150, wasaga_beach:145, midland:160, st_catharines:145, niagara_falls:155, welland:160, fort_erie:170, acton:105, centre_wellington:135, cobourg:60,  peterborough:70,  belleville:110, kingston:155, ottawa:390},
  'Clarington':       {brampton:90, mississauga:80, toronto_west:75, toronto_downtown:75,  toronto_north:80,  toronto_east:60,  vaughan:90, markham:65,  richmond_hill:75, oakville:90, burlington:100, hamilton:120, ajax_whitby:35,  newmarket_aurora:95,  barrie:130, kitchener:145, guelph:125, milton:100, georgetown:100, orangeville:135, shelburne:150, mono:130, bolton:110, caledon:115, king_city:105, erin:125, scarborough:55,  pickering:40,  oshawa:25,  ajax:35,  whitby:30,  georgina:105, scugog:40,  innisfil:120, collingwood:155, wasaga_beach:150, midland:165, st_catharines:155, niagara_falls:165, welland:170, fort_erie:180, acton:115, centre_wellington:145, cobourg:50,  peterborough:60,  belleville:100, kingston:145, ottawa:380},
  'Scugog':           {brampton:90, mississauga:85, toronto_west:80, toronto_downtown:80,  toronto_north:75,  toronto_east:65,  vaughan:85, markham:65,  richmond_hill:70, oakville:95, burlington:105, hamilton:120, ajax_whitby:40,  newmarket_aurora:85,  barrie:115, kitchener:140, guelph:120, milton:100, georgetown:95, orangeville:130, shelburne:150, mono:120, bolton:100, caledon:105, king_city:90, erin:115, scarborough:60,  pickering:50,  oshawa:45,  ajax:55,  whitby:50,  georgina:90,  scugog:5,   innisfil:110, collingwood:145, wasaga_beach:140, midland:150, st_catharines:155, niagara_falls:165, welland:170, fort_erie:180, acton:110, centre_wellington:140, cobourg:65,  peterborough:60,  belleville:105, kingston:150, ottawa:385},

  // ── SIMCOE / BARRIE (Hwy 400) ──
  'Barrie':           {brampton:90, mississauga:100, toronto_west:95, toronto_downtown:95, toronto_north:80,  toronto_east:100, vaughan:65, markham:90,  richmond_hill:70, oakville:110, burlington:120, hamilton:130, ajax_whitby:115, newmarket_aurora:50,  barrie:10,  kitchener:145, guelph:125, milton:100, georgetown:90, orangeville:100, shelburne:120, mono:95, bolton:80, caledon:85, king_city:65, erin:115, scarborough:110, pickering:110, oshawa:120, ajax:115, whitby:118, georgina:55,  scugog:115, innisfil:20,  collingwood:45,  wasaga_beach:40,  midland:55,  st_catharines:175, niagara_falls:185, welland:190, fort_erie:200, acton:115, centre_wellington:145, cobourg:155, peterborough:130, belleville:185, kingston:230, ottawa:455},
  'Innisfil':         {brampton:80, mississauga:90, toronto_west:85, toronto_downtown:85,  toronto_north:70,  toronto_east:90,  vaughan:55, markham:80,  richmond_hill:60, oakville:100, burlington:110, hamilton:120, ajax_whitby:105, newmarket_aurora:40,  barrie:20,  kitchener:135, guelph:115, milton:95, georgetown:85, orangeville:90, shelburne:110, mono:85, bolton:70, caledon:75, king_city:55, erin:105, scarborough:100, pickering:105, oshawa:115, ajax:105, whitby:108, georgina:45,  scugog:110, innisfil:5,   collingwood:55,  wasaga_beach:50,  midland:65,  st_catharines:165, niagara_falls:175, welland:180, fort_erie:190, acton:105, centre_wellington:135, cobourg:145, peterborough:125, belleville:175, kingston:220, ottawa:450},
  'Collingwood':      {brampton:120, mississauga:130, toronto_west:125, toronto_downtown:130, toronto_north:110, toronto_east:130, vaughan:100, markham:120, richmond_hill:105, oakville:140, burlington:150, hamilton:155, ajax_whitby:145, newmarket_aurora:90, barrie:45,  kitchener:175, guelph:155, milton:135, georgetown:120, orangeville:125, shelburne:145, mono:120, bolton:110, caledon:115, king_city:100, erin:145, scarborough:145, pickering:150, oshawa:155, ajax:145, whitby:148, georgina:90,  scugog:150, innisfil:55,  collingwood:5,   wasaga_beach:30,  midland:50,  st_catharines:205, niagara_falls:215, welland:220, fort_erie:230, acton:145, centre_wellington:170, cobourg:190, peterborough:165, belleville:210, kingston:255, ottawa:480},
  'Wasaga Beach':     {brampton:110, mississauga:120, toronto_west:115, toronto_downtown:120, toronto_north:100, toronto_east:120, vaughan:90,  markham:110, richmond_hill:95, oakville:130, burlington:140, hamilton:150, ajax_whitby:135, newmarket_aurora:80,  barrie:35,  kitchener:165, guelph:145, milton:125, georgetown:110, orangeville:115, shelburne:135, mono:110, bolton:100, caledon:105, king_city:90, erin:135, scarborough:135, pickering:140, oshawa:145, ajax:135, whitby:138, georgina:80,  scugog:140, innisfil:50,  collingwood:30,  wasaga_beach:5,   midland:40,  st_catharines:195, niagara_falls:205, welland:210, fort_erie:220, acton:135, centre_wellington:160, cobourg:180, peterborough:155, belleville:200, kingston:245, ottawa:470},
  'Midland':          {brampton:130, mississauga:140, toronto_west:135, toronto_downtown:140, toronto_north:120, toronto_east:140, vaughan:110, markham:130, richmond_hill:115, oakville:150, burlington:160, hamilton:170, ajax_whitby:155, newmarket_aurora:100, barrie:55,  kitchener:180, guelph:160, milton:145, georgetown:130, orangeville:135, shelburne:155, mono:130, bolton:120, caledon:125, king_city:110, erin:155, scarborough:155, pickering:155, oshawa:160, ajax:155, whitby:158, georgina:100, scugog:155, innisfil:65,  collingwood:50,  wasaga_beach:40,  midland:5,   st_catharines:215, niagara_falls:225, welland:230, fort_erie:240, acton:155, centre_wellington:180, cobourg:195, peterborough:170, belleville:215, kingston:260, ottawa:480},

  // ── WATERLOO REGION (Hwy 401) ──
  'Kitchener':        {brampton:90, mississauga:80, toronto_west:85, toronto_downtown:100, toronto_north:105, toronto_east:110, vaughan:105, markham:115, richmond_hill:110, oakville:75, burlington:65,  hamilton:65,  ajax_whitby:125, newmarket_aurora:120, barrie:145, kitchener:10,  guelph:30, milton:55, georgetown:55, orangeville:110, shelburne:120, mono:105, bolton:95, caledon:100, king_city:110, erin:80, scarborough:120, pickering:125, oshawa:135, ajax:125, whitby:128, georgina:140, scugog:145, innisfil:145, collingwood:175, wasaga_beach:170, midland:185, st_catharines:100, niagara_falls:110, welland:115, fort_erie:125, acton:55, centre_wellington:45, cobourg:175, peterborough:170, belleville:215, kingston:260, ottawa:490},
  'Waterloo':         {brampton:95, mississauga:85, toronto_west:90, toronto_downtown:105, toronto_north:110, toronto_east:115, vaughan:110, markham:120, richmond_hill:115, oakville:80, burlington:70,  hamilton:70,  ajax_whitby:130, newmarket_aurora:125, barrie:150, kitchener:15,  guelph:25, milton:60, georgetown:60, orangeville:115, shelburne:125, mono:110, bolton:100, caledon:105, king_city:115, erin:85, scarborough:125, pickering:130, oshawa:140, ajax:130, whitby:133, georgina:145, scugog:150, innisfil:150, collingwood:180, wasaga_beach:175, midland:190, st_catharines:105, niagara_falls:115, welland:120, fort_erie:130, acton:60, centre_wellington:50, cobourg:180, peterborough:175, belleville:220, kingston:265, ottawa:495},
  'Cambridge':        {brampton:85, mississauga:75, toronto_west:80, toronto_downtown:95,  toronto_north:100, toronto_east:105, vaughan:100, markham:110, richmond_hill:105, oakville:70, burlington:60,  hamilton:55,  ajax_whitby:120, newmarket_aurora:115, barrie:140, kitchener:25,  guelph:20, milton:45, georgetown:50, orangeville:105, shelburne:115, mono:100, bolton:90, caledon:95, king_city:105, erin:75, scarborough:115, pickering:120, oshawa:130, ajax:120, whitby:123, georgina:135, scugog:140, innisfil:140, collingwood:170, wasaga_beach:165, midland:180, st_catharines:90,  niagara_falls:100, welland:105, fort_erie:115, acton:45, centre_wellington:40, cobourg:165, peterborough:160, belleville:205, kingston:250, ottawa:480},
  'Guelph':           {brampton:65, mississauga:55, toronto_west:60, toronto_downtown:75,  toronto_north:80,  toronto_east:85,  vaughan:80,  markham:90,  richmond_hill:85, oakville:50, burlington:45,  hamilton:50,  ajax_whitby:100, newmarket_aurora:95,  barrie:120, kitchener:30,  guelph:10, milton:35, georgetown:30, orangeville:90, shelburne:100, mono:85, bolton:75, caledon:80, king_city:85, erin:55, scarborough:95,  pickering:100, oshawa:115, ajax:105, whitby:108, georgina:115, scugog:120, innisfil:120, collingwood:150, wasaga_beach:145, midland:160, st_catharines:85,  niagara_falls:95,  welland:100, fort_erie:110, acton:30, centre_wellington:25, cobourg:150, peterborough:145, belleville:190, kingston:235, ottawa:465},
  'Centre Wellington':{brampton:80, mississauga:75, toronto_west:80, toronto_downtown:90,  toronto_north:90,  toronto_east:100, vaughan:90,  markham:100, richmond_hill:95, oakville:65, burlington:60,  hamilton:65,  ajax_whitby:115, newmarket_aurora:105, barrie:130, kitchener:45,  guelph:25, milton:55, georgetown:45, orangeville:95, shelburne:105, mono:90, bolton:85, caledon:90, king_city:100, erin:70, scarborough:110, pickering:115, oshawa:125, ajax:115, whitby:120, georgina:120, scugog:130, innisfil:130, collingwood:160, wasaga_beach:155, midland:170, st_catharines:100, niagara_falls:110, welland:115, fort_erie:125, acton:40, centre_wellington:5,  cobourg:160, peterborough:155, belleville:200, kingston:245, ottawa:475},

  // ── HAMILTON / NIAGARA (QEW, Hwy 403) ──
  'Hamilton':         {brampton:65, mississauga:50, toronto_west:55, toronto_downtown:70,  toronto_north:80,  toronto_east:80,  vaughan:80,  markham:90,  richmond_hill:90, oakville:35, burlington:20,  hamilton:10,  ajax_whitby:95,  newmarket_aurora:100, barrie:130, kitchener:65,  guelph:50, milton:40, georgetown:50, orangeville:110, shelburne:120, mono:100, bolton:85, caledon:90, king_city:95, erin:80, scarborough:90,  pickering:95,  oshawa:110, ajax:100, whitby:103, georgina:120, scugog:125, innisfil:130, collingwood:160, wasaga_beach:155, midland:170, st_catharines:45,  niagara_falls:55,  welland:60,  fort_erie:70,  acton:65, centre_wellington:70, cobourg:145, peterborough:145, belleville:185, kingston:230, ottawa:460},
  'St. Catharines':   {brampton:100, mississauga:85, toronto_west:90, toronto_downtown:105, toronto_north:115, toronto_east:115, vaughan:115, markham:125, richmond_hill:120, oakville:70, burlington:55,  hamilton:45,  ajax_whitby:130, newmarket_aurora:135, barrie:165, kitchener:100, guelph:85, milton:60, georgetown:70, orangeville:145, shelburne:160, mono:140, bolton:120, caledon:125, king_city:130, erin:115, scarborough:125, pickering:130, oshawa:145, ajax:135, whitby:140, georgina:155, scugog:160, innisfil:165, collingwood:200, wasaga_beach:195, midland:210, st_catharines:5,   niagara_falls:20,  welland:25,  fort_erie:35,  acton:90, centre_wellington:105, cobourg:180, peterborough:185, belleville:225, kingston:270, ottawa:500},
  'Niagara Falls':    {brampton:110, mississauga:95, toronto_west:100, toronto_downtown:115, toronto_north:125, toronto_east:125, vaughan:125, markham:135, richmond_hill:130, oakville:80, burlington:65,  hamilton:55,  ajax_whitby:140, newmarket_aurora:145, barrie:175, kitchener:110, guelph:95, milton:70, georgetown:80, orangeville:155, shelburne:170, mono:150, bolton:130, caledon:135, king_city:140, erin:125, scarborough:135, pickering:140, oshawa:155, ajax:145, whitby:148, georgina:165, scugog:170, innisfil:175, collingwood:210, wasaga_beach:205, midland:220, st_catharines:20,  niagara_falls:5,   welland:20,  fort_erie:30,  acton:100, centre_wellington:115, cobourg:190, peterborough:195, belleville:235, kingston:280, ottawa:510},
  'Welland':          {brampton:115, mississauga:100, toronto_west:105, toronto_downtown:120, toronto_north:130, toronto_east:130, vaughan:130, markham:140, richmond_hill:135, oakville:85, burlington:70,  hamilton:60,  ajax_whitby:145, newmarket_aurora:150, barrie:180, kitchener:115, guelph:100, milton:75, georgetown:85, orangeville:160, shelburne:175, mono:155, bolton:135, caledon:140, king_city:145, erin:130, scarborough:140, pickering:145, oshawa:160, ajax:150, whitby:153, georgina:170, scugog:175, innisfil:180, collingwood:215, wasaga_beach:210, midland:225, st_catharines:25,  niagara_falls:20,  welland:5,   fort_erie:25,  acton:105, centre_wellington:120, cobourg:195, peterborough:200, belleville:240, kingston:285, ottawa:515},
  'Fort Erie':        {brampton:125, mississauga:110, toronto_west:115, toronto_downtown:130, toronto_north:140, toronto_east:140, vaughan:140, markham:150, richmond_hill:145, oakville:95, burlington:80,  hamilton:70,  ajax_whitby:155, newmarket_aurora:160, barrie:190, kitchener:125, guelph:110, milton:85, georgetown:95, orangeville:170, shelburne:185, mono:165, bolton:145, caledon:150, king_city:155, erin:140, scarborough:150, pickering:155, oshawa:170, ajax:160, whitby:163, georgina:180, scugog:185, innisfil:190, collingwood:225, wasaga_beach:220, midland:235, st_catharines:35,  niagara_falls:30,  welland:25,  fort_erie:5,   acton:115, centre_wellington:130, cobourg:205, peterborough:210, belleville:250, kingston:295, ottawa:525},

  // ── EASTERN ONTARIO (Hwy 401 east) ──
  'Cobourg':          {brampton:120, mississauga:110, toronto_west:105, toronto_downtown:100, toronto_north:110, toronto_east:80,  vaughan:115, markham:90,  richmond_hill:100, oakville:120, burlington:130, hamilton:145, ajax_whitby:65,  newmarket_aurora:120, barrie:140, kitchener:170, guelph:150, milton:115, georgetown:115, orangeville:165, shelburne:180, mono:160, bolton:140, caledon:145, king_city:130, erin:155, scarborough:85,  pickering:80,  oshawa:60,  ajax:75,  whitby:70,  georgina:120, scugog:65,  innisfil:140, collingwood:185, wasaga_beach:180, midland:190, st_catharines:180, niagara_falls:190, welland:195, fort_erie:205, acton:135, centre_wellington:160, cobourg:5,   peterborough:60,  belleville:85,  kingston:130, ottawa:355},
  'Peterborough':     {brampton:130, mississauga:120, toronto_west:115, toronto_downtown:110, toronto_north:110, toronto_east:100, vaughan:115, markham:100, richmond_hill:105, oakville:135, burlington:145, hamilton:160, ajax_whitby:85,  newmarket_aurora:110, barrie:120, kitchener:180, guelph:160, milton:125, georgetown:125, orangeville:165, shelburne:180, mono:155, bolton:135, caledon:140, king_city:120, erin:150, scarborough:100, pickering:90,  oshawa:70,  ajax:85,  whitby:80,  georgina:105, scugog:55,  innisfil:120, collingwood:160, wasaga_beach:155, midland:155, st_catharines:190, niagara_falls:200, welland:205, fort_erie:215, acton:145, centre_wellington:155, cobourg:60,  peterborough:5,   belleville:75,  kingston:120, ottawa:340},
  'Belleville':       {brampton:165, mississauga:155, toronto_west:150, toronto_downtown:145, toronto_north:150, toronto_east:130, vaughan:155, markham:130, richmond_hill:140, oakville:165, burlington:175, hamilton:190, ajax_whitby:110, newmarket_aurora:160, barrie:185, kitchener:210, guelph:190, milton:160, georgetown:160, orangeville:205, shelburne:220, mono:200, bolton:175, caledon:180, king_city:165, erin:195, scarborough:135, pickering:130, oshawa:110, ajax:125, whitby:120, georgina:160, scugog:105, innisfil:175, collingwood:210, wasaga_beach:205, midland:215, st_catharines:225, niagara_falls:235, welland:240, fort_erie:250, acton:185, centre_wellington:200, cobourg:85,  peterborough:75,  belleville:5,   kingston:80,  ottawa:275},
  'Kingston':         {brampton:210, mississauga:200, toronto_west:195, toronto_downtown:190, toronto_north:195, toronto_east:175, vaughan:200, markham:175, richmond_hill:185, oakville:210, burlington:220, hamilton:235, ajax_whitby:155, newmarket_aurora:205, barrie:230, kitchener:255, guelph:235, milton:205, georgetown:205, orangeville:250, shelburne:265, mono:245, bolton:225, caledon:230, king_city:215, erin:240, scarborough:180, pickering:175, oshawa:155, ajax:170, whitby:165, georgina:205, scugog:150, innisfil:220, collingwood:260, wasaga_beach:250, midland:255, st_catharines:270, niagara_falls:280, welland:285, fort_erie:295, acton:230, centre_wellington:245, cobourg:130, peterborough:120, belleville:80,  kingston:5,   ottawa:195},
  'Ottawa':           {brampton:450, mississauga:440, toronto_west:435, toronto_downtown:430, toronto_north:435, toronto_east:415, vaughan:440, markham:415, richmond_hill:425, oakville:450, burlington:460, hamilton:475, ajax_whitby:395, newmarket_aurora:445, barrie:460, kitchener:495, guelph:475, milton:445, georgetown:445, orangeville:490, shelburne:505, mono:480, bolton:460, caledon:465, king_city:450, erin:480, scarborough:420, pickering:410, oshawa:390, ajax:405, whitby:400, georgina:435, scugog:385, innisfil:450, collingwood:480, wasaga_beach:470, midland:480, st_catharines:500, niagara_falls:510, welland:515, fort_erie:525, acton:470, centre_wellington:475, cobourg:355, peterborough:340, belleville:275, kingston:195, ottawa:5},
  'Brock':            {brampton:90, mississauga:85, toronto_west:80, toronto_downtown:80,  toronto_north:75,  toronto_east:65,  vaughan:85,  markham:65,  richmond_hill:70, oakville:95, burlington:105, hamilton:120, ajax_whitby:40,  newmarket_aurora:85,  barrie:110, kitchener:140, guelph:120, milton:100, georgetown:95, orangeville:130, shelburne:150, mono:120, bolton:100, caledon:105, king_city:90, erin:115, scarborough:65,  pickering:55,  oshawa:45,  ajax:55,  whitby:50,  georgina:90,  scugog:25,  innisfil:110, collingwood:145, wasaga_beach:140, midland:150, st_catharines:155, niagara_falls:165, welland:170, fort_erie:180, acton:110, centre_wellington:140, cobourg:65,  peterborough:60,  belleville:105, kingston:150, ottawa:385},
};


// Map FSA prefix → work zone key
// Built from real Ontario postal geography
const FSA_TO_WORK_ZONE = {
  // Toronto Downtown / Core (M5, M4 central)
  'M5V':'toronto_downtown','M5H':'toronto_downtown','M5G':'toronto_downtown','M5C':'toronto_downtown',
  'M5B':'toronto_downtown','M5A':'toronto_downtown','M4Y':'toronto_downtown','M5E':'toronto_downtown',
  'M5J':'toronto_downtown','M5K':'toronto_downtown','M5L':'toronto_downtown','M5M':'toronto_north',
  // Toronto West / Etobicoke
  'M6K':'toronto_west','M6J':'toronto_west','M6P':'toronto_west','M6R':'toronto_west',
  'M6S':'toronto_west','M6G':'toronto_west','M6H':'toronto_west','M6N':'toronto_west',
  'M8V':'toronto_west','M8W':'toronto_west','M8X':'toronto_west','M8Y':'toronto_west',
  'M8Z':'toronto_west','M9A':'toronto_west','M9B':'toronto_west','M9C':'toronto_west',
  'M9P':'toronto_west','M9R':'toronto_west','M9V':'toronto_west','M9W':'toronto_west',
  'M6A':'toronto_west','M6B':'toronto_west',
  // Toronto North York
  'M2J':'toronto_north','M2K':'toronto_north','M2L':'toronto_north','M2M':'toronto_north',
  'M2N':'toronto_north','M2P':'toronto_north','M2R':'toronto_north','M3A':'toronto_north',
  'M3B':'toronto_north','M3C':'toronto_north','M3H':'toronto_north','M3J':'toronto_north',
  'M3K':'toronto_north','M3L':'toronto_north','M3M':'toronto_north','M3N':'toronto_north',
  'M4N':'toronto_north','M4P':'toronto_north','M4R':'toronto_north','M5N':'toronto_north',
  'M5P':'toronto_north','M5R':'toronto_north',
  // Toronto East / Scarborough
  'M1B':'toronto_east','M1C':'toronto_east','M1E':'toronto_east','M1G':'toronto_east',
  'M1H':'toronto_east','M1J':'toronto_east','M1K':'toronto_east','M1L':'toronto_east',
  'M1M':'toronto_east','M1N':'toronto_east','M1P':'toronto_east','M1R':'toronto_east',
  'M1S':'toronto_east','M1T':'toronto_east','M1V':'toronto_east','M1W':'toronto_east',
  'M1X':'toronto_east','M4M':'toronto_east','M4L':'toronto_east','M4K':'toronto_east',
  'M4J':'toronto_east','M4H':'toronto_east','M4G':'toronto_north','M4S':'toronto_north',
  'M4T':'toronto_north','M4W':'toronto_downtown',
  // Brampton — split into sub-zones by actual location, not treated as one point.
  // Brampton spans ~25km north-south; a Castlemore (L6P) commute and a Bram West
  // (L6Z) commute to Bolton/Caledon are NOT the same trip.
  'L6P':'brampton_ne','L6R':'brampton_ne',           // Castlemore/Sandalwood — NE, near Goreway/Hwy 50
  'L6S':'brampton_central','L6T':'brampton_central','L6X':'brampton_central', // Bramalea/Central-East
  'L6V':'brampton_central','L6W':'brampton_central','L6Y':'brampton_central', // Downtown/South-Central
  'L6Z':'brampton_nw','L7A':'brampton_nw',           // Bram West / NW — near Caledon/Mississauga border
  // Mississauga (L4, L5) — split into work sub-zones by area
  // East: Malton, Dixie, Matheson, Applewood, airport/NE industrial (401/410/427)
  'L4T':'mississauga_east','L4W':'mississauga_east','L4X':'mississauga_east','L4Y':'mississauga_east',
  'L5S':'mississauga_east','L5T':'mississauga_east',
  // Central: City Centre/Square One, Cooksville, Hurontario, Heartland, lakeshore (403)
  'L4Z':'mississauga_central','L5A':'mississauga_central','L5B':'mississauga_central','L5C':'mississauga_central',
  'L5E':'mississauga_central','L5G':'mississauga_central','L5P':'mississauga_central',
  'L5R':'mississauga_central','L5V':'mississauga_central',
  // West: Erin Mills, Meadowvale, Streetsville, Lisgar, Lorne Park, Clarkson (403/407)
  'L5H':'mississauga_west','L5J':'mississauga_west','L5K':'mississauga_west','L5L':'mississauga_west',
  'L5M':'mississauga_west','L5N':'mississauga_west','L5W':'mississauga_west',
  // Vaughan / Woodbridge
  'L4H':'vaughan','L4J':'vaughan','L4K':'vaughan','L4L':'vaughan','L6A':'vaughan',
  // Markham
  'L3P':'markham','L3R':'markham','L3S':'markham','L6C':'markham','L6E':'markham',
  'L4S':'markham',
  // Richmond Hill
  'L3T':'richmond_hill','L4B':'richmond_hill','L4C':'richmond_hill','L4E':'richmond_hill',
  // Oakville
  'L6H':'oakville','L6J':'oakville','L6K':'oakville','L6L':'oakville','L6M':'oakville',
  // Burlington / Halton
  'L7L':'burlington','L7M':'burlington','L7N':'burlington','L7P':'burlington',
  'L7R':'burlington','L7S':'burlington','L7T':'burlington',
  // Milton
  'L9T':'milton',
  // Hamilton
  'L8E':'hamilton','L8G':'hamilton','L8H':'hamilton','L8J':'hamilton','L8K':'hamilton',
  'L8L':'hamilton','L8M':'hamilton','L8N':'hamilton','L8P':'hamilton','L8R':'hamilton',
  'L8S':'hamilton','L8T':'hamilton','L8V':'hamilton','L8W':'hamilton',
  // Halton Hills / Georgetown / Acton
  'L7G':'georgetown','L7J':'georgetown',
  // Newmarket / Aurora
  'L3X':'newmarket_aurora','L3Y':'newmarket_aurora','L4G':'newmarket_aurora',
  // Bradford
  'L3Z':'newmarket_aurora',
  // Barrie
  'L4M':'barrie','L4N':'barrie',
  // Ajax / Whitby / Oshawa / Pickering
  'L1G':'ajax_whitby','L1H':'ajax_whitby','L1J':'ajax_whitby','L1K':'ajax_whitby',
  'L1L':'ajax_whitby','L1M':'ajax_whitby','L1N':'ajax_whitby','L1P':'ajax_whitby',
  'L1R':'ajax_whitby','L1S':'ajax_whitby','L1T':'ajax_whitby','L1V':'ajax_whitby',
  'L1W':'ajax_whitby','L1X':'ajax_whitby','L1Z':'ajax_whitby',
  // Kitchener / Waterloo / Cambridge
  'N2A':'kitchener','N2B':'kitchener','N2C':'kitchener','N2E':'kitchener',
  'N2G':'kitchener','N2H':'kitchener','N2J':'kitchener','N2K':'kitchener',
  'N2L':'kitchener','N2M':'kitchener','N2N':'kitchener','N2P':'kitchener',
  'N2R':'kitchener','N2T':'kitchener','N2V':'kitchener',
  // Guelph
  'N1E':'guelph','N1G':'guelph','N1H':'guelph','N1K':'guelph','N1L':'guelph',
};

// City name → work zone fallback (for when user types city name not postal)
const CITY_TO_WORK_ZONE = {
  // Toronto proper
  'toronto':'toronto_downtown','toronto - downtown':'toronto_downtown',
  'toronto - west end':'toronto_west','toronto - east end':'toronto_east',
  'toronto - north york':'toronto_north','toronto - etobicoke':'toronto_west',
  'toronto - scarborough':'scarborough',
  'scarborough':'scarborough','etobicoke':'toronto_west',
  'north york':'toronto_north','east york':'toronto_east','york':'toronto_west',
  // Peel
  'mississauga':'mississauga','brampton':'brampton',
  // York Region
  'vaughan':'vaughan','woodbridge':'vaughan','markham':'markham',
  'richmond hill':'richmond_hill','thornhill':'richmond_hill',
  'king city':'king_city','aurora':'newmarket_aurora','newmarket':'newmarket_aurora',
  'bradford':'newmarket_aurora','georgina':'georgina',
  // Halton
  'oakville':'oakville','burlington':'burlington','milton':'milton',
  'georgetown':'georgetown','halton hills':'georgetown','acton':'acton',
  // Dufferin / Orangeville
  'orangeville':'orangeville','shelburne':'shelburne','grand valley':'orangeville',
  'mono':'mono','bolton':'bolton','caledon':'caledon','erin':'erin',
  // Hamilton / Niagara
  'hamilton':'hamilton','ancaster':'hamilton','dundas':'hamilton','stoney creek':'hamilton',
  'st. catharines':'st_catharines','niagara falls':'niagara_falls',
  'welland':'welland','fort erie':'fort_erie',
  // Durham
  'ajax':'ajax','whitby':'whitby','pickering':'pickering',
  'oshawa':'oshawa','clarington':'ajax_whitby','scugog':'scugog',
  // Simcoe
  'barrie':'barrie','innisfil':'innisfil','collingwood':'collingwood',
  'wasaga beach':'wasaga_beach','midland':'midland',
  // Waterloo
  'kitchener':'kitchener','waterloo':'kitchener','cambridge':'kitchener',
  'guelph':'guelph','centre wellington':'centre_wellington','acton':'acton',
  // Eastern Ontario
  'cobourg':'cobourg','peterborough':'peterborough',
  'belleville':'belleville','kingston':'kingston','ottawa':'ottawa',
};

function getWorkZone() {
  // Try FSA first (most accurate)
  const postal = (document.getElementById('workPostal')?.value||'').trim().toUpperCase().replace(/\s/g,'');
  const fsa = postal.substring(0,3);
  if(fsa.length === 3 && FSA_TO_WORK_ZONE[fsa]) return FSA_TO_WORK_ZONE[fsa];
  // Fall back to city name
  const city = (document.getElementById('workCity')?.value||'').trim().toLowerCase();
  if(city && CITY_TO_WORK_ZONE[city]) return CITY_TO_WORK_ZONE[city];
  // Partial match on city
  for(const [k,v] of Object.entries(CITY_TO_WORK_ZONE)) {
    if(city.includes(k) || k.includes(city)) return v;
  }
  return null;
}

// Brampton sub-zone adjustments relative to the DRIVE_TABLE 'brampton' baseline,
// which represents central Brampton (downtown/Bramalea corridor).
// NE (Castlemore/Sandalwood, near Hwy 50/Goreway) sits closer to Bolton, Caledon,
// Vaughan, and the Dufferin corridor, and farther from Mississauga/Oakville/Hamilton.
// NW (Bram West, near Mississauga Rd/Steeles) sits closer to Mississauga/Oakville
// and farther from Vaughan/Markham/the eastern GTA.
// These are directional corrections in minutes, not independently measured times —
// applied on top of the central baseline since we don't have full per-zone data
// for every one of the 50+ destination cities.
// Work sub-zones: a base DRIVE_TABLE column + directional minute offsets per
// home city. Each sub-zone maps to a `base` column and an `adjust` table.
// The 'Brampton'/'Mississauga' self-entries fix the home-equals-work-city case
// so an intra-city commute reflects which corner you're in, not a flat baseline.
const SUBZONE_ADJUST = {
  // ── BRAMPTON (base column: 'brampton', central = downtown/Bramalea) ──
  brampton_ne: {
    base: 'brampton',
    adjust: {
      'Brampton': -2, // live in Brampton, work NE Brampton → short intra-city trip
      'Bolton': -15, 'Caledon': -12, 'King City': -10, 'Vaughan': -8, 'Mono': -10,
      'Orangeville': -8, 'Grand Valley': -8, 'Shelburne': -8, 'Erin': -5,
      'Markham': -5, 'Richmond Hill': -5, 'Newmarket': -5, 'Aurora': -5,
      'Mississauga': +8, 'Oakville': +10, 'Burlington': +12, 'Hamilton': +12,
      'Milton': +8, 'Toronto - West End': +5, 'Toronto - Etobicoke': +5,
    },
  },
  brampton_nw: {
    base: 'brampton',
    adjust: {
      'Brampton': -2, // live in Brampton, work NW Brampton → short intra-city trip
      'Mississauga': -8, 'Oakville': -8, 'Milton': -6, 'Burlington': -6,
      'Halton Hills': -8, 'Georgetown': -8, 'Caledon': -6, 'Erin': -5,
      'Bolton': +5, 'Vaughan': +8, 'Markham': +10, 'Richmond Hill': +10,
      'King City': +8, 'Newmarket': +10, 'Aurora': +10,
      'Toronto - East End': +8, 'Toronto - Scarborough': +10,
    },
  },
  brampton_central: { base: 'brampton', adjust: {} }, // baseline — no adjustment

  // ── MISSISSAUGA (base column: 'mississauga', central = City Centre/Cooksville/Hurontario) ──
  // East = Malton/Dixie/Matheson (near airport, 401/410/427 — closer to Brampton,
  //   Etobicoke, Toronto, farther from west-Halton). West = Erin Mills/Meadowvale/
  //   Streetsville (near 403/407 — closer to Oakville/Milton/Halton, farther from
  //   Toronto/east GTA).
  mississauga_east: {
    base: 'mississauga',
    adjust: {
      'Mississauga': +6, // intra-Mississauga, working east side
      'Brampton': -6, 'Toronto - West End': -5, 'Toronto - Etobicoke': -8,
      'Toronto - Downtown': -5, 'Vaughan': -5, 'Bolton': -5, 'Caledon': -4,
      'Oakville': +8, 'Milton': +8, 'Burlington': +10, 'Hamilton': +10,
      'Halton Hills': +6, 'Georgetown': +6, 'Guelph': +8,
    },
  },
  mississauga_central: { base: 'mississauga', adjust: {} }, // baseline — no adjustment
  mississauga_west: {
    base: 'mississauga',
    adjust: {
      'Mississauga': +6, // intra-Mississauga, working west side
      'Oakville': -8, 'Milton': -8, 'Burlington': -8, 'Halton Hills': -6,
      'Georgetown': -6, 'Hamilton': -6, 'Guelph': -8, 'Cambridge': -6, 'Kitchener': -6,
      'Toronto - West End': +6, 'Toronto - Downtown': +6, 'Toronto - East End': +10,
      'Toronto - Etobicoke': +5, 'Vaughan': +6, 'Markham': +10, 'Bolton': +4,
    },
  },
};

function calcCommuteMinutes(cityName) {
  const zone = workZone;
  if(!zone) return null;
  // Resolve work sub-zones against their base DRIVE_TABLE column + directional offset.
  const sub = SUBZONE_ADJUST[zone];
  const lookupZone = sub ? sub.base : zone;
  const row = DRIVE_TABLE[cityName];
  if(!row) return null;
  let baseMin = row[lookupZone] || null;
  if(baseMin === null) return null;
  if(sub){
    const adjust = sub.adjust[cityName] || 0;
    baseMin = Math.max(5, baseMin + adjust); // never let an adjustment push below 5 min
  }
  // DRIVE_TABLE stores off-peak times. A daily 5x/week commuter experiences
  // rush hour, not midday driving — showing the optimistic number is misleading
  // for the exact decision this buyer is making. Apply a realistic rush-hour
  // multiplier, scaled by trip length (short hops hit less compounding delay
  // than long cross-GTA drives through multiple highway chokepoints).
  if(workArrangement === 'remote') return baseMin;
  let multiplier;
  if(baseMin <= 20) multiplier = 1.25;       // short local drive, modest rush impact
  else if(baseMin <= 40) multiplier = 1.40;  // crosses at least one major corridor
  else if(baseMin <= 60) multiplier = 1.50;  // multi-highway, compounding delay
  else if(baseMin <= 120) multiplier = 1.55; // long haul, worst compounding
  else multiplier = 1.10;                     // 2hr+ drive — not a rush-hour trip, minimal multiplier
  return Math.round(baseMin * multiplier);
}

function getCommuteScore(commuteMin) {
  // Score 0-100: lower commute = higher score
  // null means no work location entered OR unresolvable
  // For remote workers, render() passes null and we return neutral 50 (handled at call site)
  // This function should NEVER receive null for a non-remote worker — that's caught upstream
  if(commuteMin === null) return 50; // neutral: remote worker, no commute relevant
  if(commuteMin <= 15) return 100;
  if(commuteMin <= 20) return 95;
  if(commuteMin <= 30) return 85;
  if(commuteMin <= 40) return 72;
  if(commuteMin <= 50) return 58;
  if(commuteMin <= 60) return 44;
  if(commuteMin <= 75) return 30;
  if(commuteMin <= 90) return 18;
  if(commuteMin <= 120) return 8;
  return 3;
}

// ─── WORK ACCESS TIER ───────────────────────────────────────────────────────
// Commute is a PRACTICALITY FILTER, not a precision prediction. The underlying
// minute figures (DRIVE_TABLE + sub-zone adjustments) are real-world-informed
// estimates, not measured data — they were never accurate enough to justify
// showing "49 min" as if it were a stopwatch reading. So nothing in the UI
// should display a raw minute count. Instead, every commute value gets
// bucketed into one of four coarse access tiers. This also makes the product
// far less brittle to small gaps in the underlying table (the Brampton
// same-city gap that caused the Bolton mis-rank is a good example) — a 10min
// error rarely moves a city to a different tier, where it would always have
// shown a visibly "wrong" number before.
const ACCESS_TIERS = [
  { max: 25,  label: 'Excellent Commute', cls: 'access-excellent' },
  { max: 45,  label: 'Good Commute',      cls: 'access-good' },
  { max: 70,  label: 'Moderate Commute',  cls: 'access-moderate' },
  { max: Infinity, label: 'Limited Commute', cls: 'access-limited' }
];
function getAccessTier(commuteMin){
  if(commuteMin===null||commuteMin===undefined) return null;
  return ACCESS_TIERS.find(t=>commuteMin<=t.max);
}
