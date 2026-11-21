/* Kayaos Fuel — gas, diesel, E85 and EV charging for each vehicle: fill-ups, price, MPG, cost per mile, photos.
   Page layout: Find fuel (top: stations near you, search, favorites) → My favorites → Vehicles (add, photo, edit).
   Tapping a vehicle opens its own sections: gas or charging totals, fuel type breakdown, where you pay least, fill-ups.
   A vehicle's fuel type is set when it is added and never changes; each fill-up uses it. Gas is measured in gallons (MPG); EV in kWh.
   Loaded after work.js and script.js and uses their helpers ($, load, store, money, ymd, esc, toast, uuid, wJobs, wJob, fmtShort,
   MediaDB, compressImage, showNote, findApp, openOutside, isApple). */
'use strict';
const FK = { vehicles: 'kayaos.v4.vehicles', fuel: 'kayaos.v4.fuel' };
let fVehicles = load(FK.vehicles, []), fLogs = load(FK.fuel, []);
let fLayers = load('kayaos.v4.around', ['fuel', 'grocery']);   /* Around me layers: fuel, grocery, food, lodging, place (place is off by default) */
let fNameFix = load('kayaos.v4.nameFix', {}), fLocAsked = false;
let fView = load('kayaos.v4.mapView', 'street'), fTiles = null;   /* map style: street or satellite */   /* names you gave unnamed stations; whether we asked for your location */
const LPRICE_KEY = 'kayaos.v4.localPrices';
const CUSTOM_KEY = 'kayaos.v4.customStations';   /* stations you added where the map data has none */   /* prices reported on this phone: station id -> fuel type -> { price, at } */
const fSave = () => { store(FK.vehicles, fVehicles); store(FK.fuel, fLogs); };
const fRound = n => Math.round(n * 100) / 100;
const FTYPES = ['Regular', 'Mid-grade', 'Premium', 'Diesel', 'E85', 'Electric'];
const GRADES = ['Regular', 'Mid-grade', 'Premium'];
const fTypeOf = l => l.ftype || fVehicles.find(v => v.id === l.vid)?.fuel || 'Regular';
const fUnitOf = type => type === 'Electric' ? 'kWh' : 'gal';
const fUnit = l => l.unit || fUnitOf(fTypeOf(l));
const fPer = (n, unit) => `$${(+n || 0).toFixed(3)}/${unit}`;
const fPhotoKey = id => `fuel-${id}`;
const vKey = id => `vehicle-${id}`;
let vPhotoTarget = null, vdId = null;

/* ---------- Find fuel state, favorites and nearby alerts ---------- */
let fFind = { type: 'gas', grade: 'Regular', q: '', place: '' };
let fResults = [], fSearching = false, fSearchErr = '';
const FIND_LABEL = { gas: 'gas', diesel: 'diesel', e85: 'E85', ev: 'charging', truck: 'truck stop', rest: 'rest area or service' };
let fCenter = null;   /* the point the last search was centred on (used when you have no location) */
const DIST_STEPS = [1, 2, 5, 10, 25];   /* miles the distance control can show */
let fRadiusMi = 5, fMapH = 280, fFilterCenter = null;   /* fFilterCenter: the area the distance filter measures from after Search this area */   /* map height in px; the drag bar between map and list sets it */
const STATIONS_KEY = 'kayaos.v4.stations', BRANDS_KEY = 'kayaos.v4.brands', ALERTS_KEY = 'kayaos.v4.stationAlerts', NEAR_M = 200;
let fStations = load(STATIONS_KEY, []);   /* favorite locations: {id, name, lat, lng, osm?} */
let fBrands = load(BRANDS_KEY, []);       /* favorite brand names */
let fPos = null, fWatch = null, fNearKey = '';
const fAlerted = {};
let fFavSynced = load('kayaos.v4.favSynced', []);
let fPrices = {};                      /* community prices: station id -> { fuel type -> { price, at } } */
let fMap = null, fMapLayer = null, fMapKey = '';
let fCover = [], fMapFit = false, fMapBusy = false, fMapPending = false, fPanTimer = null;   /* searched areas so far; map loading state */   /* favorite ids the account has, as of the last sync */
const fStationsSave = () => store(STATIONS_KEY, fStations);
const fBrandsSave = () => store(BRANDS_KEY, fBrands);
const hasFavs = () => fStations.length > 0 || fBrands.length > 0;
const brandKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/* Two names are the same station or brand if they match, or one contains the other (e.g. "Costco" and "Costco Gas") */
function sameName(a, b) { const x = brandKey(a), y = brandKey(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))); }
const isFavBrand = name => fBrands.some(b => brandKey(b) === brandKey(name));
const favPlace = s => fStations.find(x => x.osm === s.id);
const isFavorite = s => isFavBrand(s.name) || !!favPlace(s);

/* ---------- Fuel rewards: program, its own site, and the app to open on Android ---------- */
const REWARDS = [
  { re: /costco/i, name: 'Costco gas rewards', label: 'Costco', finder: 'https://www.costco.com/w/-/locations', url: 'https://www.costco.com/gas-rewards-calculator.html', app: 'Costco' },
  { re: /\bbj'?s\b/i, name: "BJ's gas savings", label: "BJ's", url: 'https://www.bjs.com/gas/', app: "BJ's Wholesale Club" },
  { re: /kroger|fred\s*meyer|king\s*soopers|ralphs|smith'?s/i, name: 'Kroger fuel points', label: 'Kroger', finder: 'https://www.kroger.com/stores/search', url: 'https://www.kroger.com/d/fuel-points-program', app: 'Kroger' },
  { re: /walmart/i, name: 'Walmart+ fuel savings', label: 'Walmart+', finder: 'https://www.walmart.com/plus/benefit-finder', url: 'https://www.walmart.com/plus/fuel-discounts', app: 'Walmart' },
  { re: /shell/i, name: 'Shell Fuel Rewards', label: 'Shell', finder: 'https://www.shell.us/shell-stations/station-locator.html', url: 'https://www.shell.us/fuel-rewards', app: 'Shell' },
  { re: /exxon|mobil/i, name: 'Exxon Mobil fuel rewards', label: 'Exxon Mobil', finder: 'https://www.exxonmobilfuels.com/en/exxon/exxongas/find-gas-station', url: 'https://www.exxonmobilfuels.com/en/exxon/exxongas/credit-cards', app: 'Exxon' },
  { re: /speedway/i, name: 'Speedy Rewards fuel savings', label: 'Speedway', finder: 'https://www.speedway.com/locations', url: 'https://www.speedway.com/speedy-rewards/fuel-savings', app: 'Speedway' },
  { re: /murphy/i, name: 'Murphy USA rewards', label: 'Murphy USA', finder: 'https://www.murphyusa.com/Find-a-Store/', url: 'https://www.murphyusa.com/driverewards/rewards', app: 'Murphy USA' },
  { re: /wawa/i, name: 'Wawa Rewards', label: 'Wawa', finder: 'https://www.wawa.com/locations/store-locator', url: 'https://www.wawa.com/rewards-how-it-works', app: 'Wawa' },
  { re: /sheetz/i, name: 'My Sheetz Rewardz', label: 'Sheetz', finder: 'https://orders.sheetz.com/findASheetz', url: 'https://www.sheetz.com/loyalty-program', app: 'Sheetz' },
  { re: /\bbp\b/i, name: 'BPme Rewards', label: 'BP', finder: 'https://www.bp.com/en_us/united-states/home/find-a-gas-station.html', url: 'https://www.bp.com/en_us/united-states/home/products-and-services/bpme-rewards.html', app: 'BPme' },
  { re: /chevron|texaco/i, name: 'Chevron Texaco Rewards', label: 'Chevron', finder: 'https://www.chevron.com/who-we-are/our-brands/fuel-stations', url: 'https://www.chevron.com/newsroom/national-ctrewards-subscribe', app: 'Chevron' },
  { re: /circle\s*k/i, name: 'Circle K Inner Circle', label: 'Circle K', finder: 'https://www.circlek.com/stations', url: 'https://www.circlek.com/inner-circle', app: 'Circle K' },
];const rewardFor = name => REWARDS.find(r => r.re.test(name || '')) || null;
function rewardChip(r) { return `<a class="pill rewardLink" href="${esc(r.url)}" target="_blank" rel="noopener" data-app="${esc(r.app)}">🎁 ${esc(r.label)}</a>`; }
function finderChip(r) { return `<a class="pill" href="${esc(r.finder)}" target="_blank" rel="noopener" data-out="1">📍 ${esc(r.label)}</a>`; }
/* Pill colours follow the station's brand; unknown stations use the app accent */
/* Unbranded stations get a colour for their kind (food, lodging and so on) */
const KIND_PILL = { food: ['#ff8a34', '#111111'], lodging: ['#4f46e5', '#ffffff'], grocery: ['#16a34a', '#ffffff'], ev: ['#0ea5e9', '#ffffff'], truck: ['#92400e', '#ffffff'], rest: ['#475569', '#ffffff'], place: ['#db2777', '#ffffff'] };
/* Gas stations on the map: a location pin with a fuel icon, in the brand colours (or the accent), with the price under it */
function fuelPinHTML(s, p, cheap, bd) {
  const [bg, fg] = pinColors(s);
  const head = `background:${bg};color:${fg}`;
  return `<div class="fpin${cheap ? ' cheap' : ''}"><div class="fpinLbl" style="${head};border:2px solid ${cheap ? '#16a34a' : bg}"><b>${esc(String(s.name).slice(0, 18))}</b> ${p ? '$' + p.price.toFixed(3) : '—'}</div><div class="fpinHead" style="${head}"><span>⛽</span></div></div>`;
}
/* The pills under a station take the same colour as its pin: brand, else kind, else the accent */
function pinColors(s) { const bd = brandOf(s.name); if (bd) return [bd.bg, bd.fg]; const k = KIND_PILL[s.kind]; return k ? k : ['var(--accent)', 'var(--accent-ink)']; }
function pillVars(s) { const [bg, fg] = pinColors(s); return `--pill-bg:${bg};--pill-fg:${fg}`; }
function kindStyle(s) { const [bg, fg] = pinColors(s); return `style="background:${bg};color:${fg}"`; }
function rewardLink(name) { const r = rewardFor(name); return r ? finderChip(r) + ' ' + rewardChip(r) : ''; }
/* Opens the rewards app if it is on this Android phone; otherwise the program's site */
function openReward(url, appName) {
  const N = window.KayaosNative;
  if (N && N.openApp && appName) { const app = findApp([appName]); if (app) { let ok = false; try { ok = N.openApp(app.pkg); } catch (e) {} if (ok) return; } }
  openOutside(url);
}
document.addEventListener('click', e => {
  const o = e.target.closest('a[data-out]'); if (o) { e.preventDefault(); openOutside(o.getAttribute('href')); return; }
  const a = e.target.closest('a.rewardLink[data-app]'); if (!a) return;
  e.preventDefault(); openReward(a.getAttribute('href'), a.dataset.app);
});
const dirHref = s => isApple() && !window.KayaosNative ? `https://maps.apple.com/?daddr=${s.lat},${s.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
/* Distance in metres between your position (coords) and a station */
/* Metres between two points. Accepts {latitude, longitude} or {lat, lng}. Named apart from script.js's distM, which it would otherwise overwrite. */
function fuelDist(a, b) {
  const P = p => ({ lat: p.latitude ?? p.lat, lng: p.longitude ?? p.lng }), A = P(a), B = P(b);
  const R = 6371000, r = x => x * Math.PI / 180, dLat = r(B.lat - A.lat), dLng = r(B.lng - A.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(A.lat)) * Math.cos(r(B.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = d => d < 160 ? 'you’re here' : d < 1609 ? `${Math.round(d * 3.281 / 10) * 10} ft away` : `${(d / 1609.34).toFixed(1)} mi away`;

/* ---------- Photo URLs: made once per photo and reused, so redrawing never flickers ---------- */
const fUrls = new Map();
async function fUrlFor(key) {
  if (fUrls.has(key)) return fUrls.get(key);
  const blob = await MediaDB.get(key).catch(() => null);
  if (!blob) return null;
  const url = URL.createObjectURL(blob); fUrls.set(key, url); return url;
}
function fForget(key) { if (fUrls.has(key)) { URL.revokeObjectURL(fUrls.get(key)); fUrls.delete(key); } }

/* Fill in whichever of amount / total / price-per-unit is missing (needs any two) */
function fComplete(l) {
  let amt = +l.gal || 0, total = +l.total || 0, ppu = +l.ppg || 0;
  if (amt && total) ppu = total / amt;
  else if (amt && ppu) total = amt * ppu;
  else if (total && ppu) amt = total / ppu;
  else return null;
  return { gal: fRound(amt), total: fRound(total), ppg: Math.round(ppu * 1000) / 1000 };
}
/* Totals, average price, and MPG / cost per mile (from odometer readings between fills of the same vehicle) */
function fStats(list) {
  const total = fRound(list.reduce((a, l) => a + l.total, 0)), gal = fRound(list.reduce((a, l) => a + l.gal, 0));
  let miles = 0, used = 0, spendUsed = 0;
  const byV = {};
  list.forEach(l => { (byV[l.vid] = byV[l.vid] || []).push(l); });
  Object.values(byV).forEach(arr => {
    arr.sort((a, b) => a.date.localeCompare(b.date) || (a.odo || 0) - (b.odo || 0));
    for (let i = 1; i < arr.length; i++) {
      const a = arr[i - 1], b = arr[i];
      if (a.odo && b.odo && b.odo > a.odo) { miles += b.odo - a.odo; used += b.gal; spendUsed += b.total; }
    }
  });
  return {
    total, gal, count: list.length, ppu: gal ? total / gal : 0,
    miles: fRound(miles), mpg: miles > 0 && used > 0 ? miles / used : null,
    perMile: miles > 0 ? spendUsed / miles : null
  };
}
/* Fuel you paid on a job that the owner hasn't reimbursed yet (see fuelDueForJob in work.js) */
function fuelForJob(id) { return fuelDueForJob(id); }
function fuelLine(job, earned, hours, r) {
  const due = fuelDueForJob(job.id, r);
  const owner = fRound(fLogs.filter(l => l.job === job.id && l.payer === 'owner' && (!r || wInR(l.date, r))).reduce((a, l) => a + l.total, 0));
  if (!due && !owner) return '';
  const net = hours > 0 ? (earned - due) / hours : 0;
  return `<div class="sub" style="margin-top:8px">Fuel to reimburse ${money(due)}${owner ? ` · owner-paid fuel ${money(owner)} (not counted)` : ''} · net ${money(net)}/hr after your fuel</div>`;
}

/* ---------- Find fuel: stations near you (OpenStreetMap directory), search, favorites ---------- */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter'];
const CACHE_KEY = 'kayaos.v4.stationCache';
/* What each Find type searches for. Diesel and E85 use all fuel stations: most do sell diesel, and the tag only adds a badge. */
const FIND_SEL = {
  gas: ['["amenity"="fuel"]'], diesel: ['["amenity"="fuel"]'], e85: ['["amenity"="fuel"]'],
  ev: ['["amenity"="charging_station"]'],
  truck: ['["amenity"="fuel"]["hgv"="yes"]', '["amenity"="fuel"]["brand"~"Pilot|Love|Flying J|Petro|Travel Cent|Speedco",i]', '["amenity"="fuel"]["name"~"Pilot|Love|Flying J|Petro|Travel Cent|Speedco",i]'],
  rest: ['["highway"="services"]', '["highway"="rest_area"]'],
  grocery: ['["shop"~"^(supermarket|grocery|greengrocer)$"]'],
  food: ['["amenity"~"^(restaurant|cafe|fast_food)$"]'],
  lodging: ['["tourism"~"^(hotel|motel|guest_house|hostel|apartment|chalet|resort)$"]']
};
const getHere = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error('Location is not available on this device.'));
  navigator.geolocation.getCurrentPosition(p => res(p.coords), () => rej(new Error('Allow location to find stations near you.')), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
});
function toStation(e, here, forced) {
  const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (lat == null || lng == null) return null;
  const kind = forced || (fFind.type === 'ev' ? 'ev' : fFind.type === 'truck' ? 'truck' : fFind.type === 'rest' ? 'rest' : 'fuel');
  const fallback = { ev: 'Unnamed charger', truck: 'Unnamed truck stop', rest: 'Unnamed rest area', fuel: 'Unnamed gas station', grocery: 'Unnamed grocery', food: 'Unnamed restaurant', lodging: 'Unnamed lodging' }[kind];
  const brand = (t.brand || t.name || t.operator || '').trim();
  const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || t['addr:full'] || '';
  return {
    id: `${e.type}/${e.id}`, kind, name: brand || fallback,
    place: t.name && t.brand ? t.name : '', addr, city: t['addr:city'] || '', lat, lng,
    diesel: t['fuel:diesel'] || '', e85: t['fuel:E85'] || '', dist: fuelDist(here, { lat, lng })
  };
}
/* Stations within radius metres of you, for the selected type. Asks all directories at once and uses the first answer. */
async function overpassOne(url, body) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); if (!Array.isArray(j.elements)) throw new Error('bad response');
    return j.elements;
  } finally { clearTimeout(timer); }
}
async function queryStations(here, radius, sel, forced) {
  const parts = sel.map(s => `nwr${s}(around:${radius},${here.latitude},${here.longitude});`).join('');
  const body = `[out:json][timeout:25];(${parts});out center 300;`;
  try { const els = await Promise.any(OVERPASS.map(u => overpassOne(u, body))); return els.map(e => toStation(e, here, forced)).filter(Boolean); }
  catch (e) { throw new Error('The station directory is busy right now. Try again in a minute.'); }
}
/* A city or ZIP typed in: looked up with OpenStreetMap's place search (US only) */
async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('Could not look up that place. Try again.');
  const j = await r.json(); if (!j.length) throw new Error(`Couldn't find "${q}". Try a city and state, or a ZIP code.`);
  return { latitude: +j[0].lat, longitude: +j[0].lon };
}
/* Saved stations for an area, reused for a week so repeat searches are instant */
function cacheGet(key) { const e = load(CACHE_KEY, {})[key]; return e && Date.now() - e.at < 7 * 864e5 ? e.items : null; }
function cachePut(key, items) {
  const c = load(CACHE_KEY, {}), keep = Object.keys(c).sort((a, b) => c[b].at - c[a].at).slice(0, 11), out = {};
  keep.forEach(k => { out[k] = c[k]; }); out[key] = { at: Date.now(), items };
  try { store(CACHE_KEY, out); } catch (e) {}
}
/* Stations for each station layer that is switched on (fuel, grocery). Each layer has its own cache. */
async function stationsAround(here, radius) {
  const out = [];
  for (const layer of ['fuel', 'grocery', 'food', 'lodging'].filter(l => fLayers.includes(l))) {
    const forced = layer === 'fuel' ? null : layer, sel = layer === 'fuel' ? FIND_SEL[fFind.type] : FIND_SEL[layer];
    const key = `${forced || fFind.type}|${radius}|${here.latitude.toFixed(2)},${here.longitude.toFixed(2)}`;
    let items = cacheGet(key);
    if (!(items && items.length)) { items = (await queryStations(here, radius, sel, forced)).map(({ dist, ...rest }) => rest); if (items.length) cachePut(key, items); }
    out.push(...items.map(applyFix), ...customFor(layer, here, radius));
  }
  return out;
}
/* Stations you added that are inside the search area, for one layer */
function customFor(layer, here, radius) {
  return load(CUSTOM_KEY, [])
    .filter(c => (layer === 'fuel' ? c.kind === 'fuel' : c.kind === layer))
    .filter(c => fuelDist(here, c) <= radius)
    .map(c => ({ id: c.id, kind: c.kind, name: c.name, place: '', addr: c.addr || '', city: '', lat: c.lat, lng: c.lng, diesel: '', e85: '' }));
}
/* Add a station the map is missing: placed at the map centre (or your location), kept on this phone */
function addStation() {
  const c = fMap ? fMap.getCenter() : (fPos ? { lat: fPos.latitude, lng: fPos.longitude } : null);
  if (!c) { toast('Turn on location, or move the map to where the station is'); return; }
  const name = prompt('Station name, as on the sign'); if (!name || !name.trim()) return;
  const addr = prompt('Street address (optional)', '') || '';
  const kind = (prompt('What is it? Type one: fuel, grocery, food or lodging', 'fuel') || '').trim().toLowerCase();
  if (!['fuel', 'grocery', 'food', 'lodging'].includes(kind)) { toast('Type fuel, grocery, food or lodging'); return; }
  const list = load(CUSTOM_KEY, []);
  list.push({ id: 'custom/' + uuid(), kind, name: name.trim().slice(0, 60), addr: addr.trim().slice(0, 120), lat: c.lat, lng: c.lng });
  store(CUSTOM_KEY, list);
  toast('Station added on this phone');
  findNear();
}
/* Names and addresses you add for stations the map data leaves unnamed (kept on this phone) */
function applyFix(s) { const f = fNameFix[s.id]; return f ? { ...s, name: f.name, addr: f.addr || s.addr, fixed: true } : s; }
function nameStation(id) {
  const s = fResults.find(x => x.id === id); if (!s) return;
  const name = prompt('Name on the sign', s.name.startsWith('Unnamed') ? '' : s.name); if (!name || !name.trim()) return;
  const addr = prompt('Street address (optional)', s.addr || '') || '';
  fNameFix = { ...fNameFix, [id]: { name: name.trim().slice(0, 60), addr: addr.trim().slice(0, 120) } }; store('kayaos.v4.nameFix', fNameFix);
  fResults = fResults.map(x => x.id === id ? applyFix(x) : x); renderResults(); updateMap(); toast('Name saved on this phone');
}
/* Your own cards that have a location, shown in the Places layer */
function placeList() { return fLayers.includes('place') ? tasks.filter(t => !isDone(t) && coordFromTask(t)).map(t => ({ t, c: coordFromTask(t) })) : []; }
/* Distance from your location; if you don't share it, from the searched area */
const dFrom = s => fPos ? fuelDist(fPos, s) : fCenter ? fuelDist(fCenter, s) : null;
const distTxt = s => { const d = dFrom(s); return d == null ? '' : fmtDist(d) + (fPos ? '' : ' from search area'); };
async function findNear() {
  fSearching = true; fSearchErr = ''; renderFuel();
  try {
    let gps = null, gpsErr = null;
    try { gps = await getHere(); fPos = gps; } catch (e) { gpsErr = e; }
    const place = fFind.place.trim();
    const here = place ? await geocode(place) : gps;
    if (!here) throw gpsErr || new Error('Allow location, or type a city or ZIP.');
    fCenter = here; fFilterCenter = null;
    let radius = 8047, items = await stationsAround(here, radius);
    if (items.length < 5) { radius = 16093; items = await stationsAround(here, radius); }
    fCover = [{ latitude: here.latitude, longitude: here.longitude, r: radius }];
    fMapFit = true;
    fResults = items.map(s => ({ ...s, dist: fuelDist(here, s) })).sort((a, b) => a.dist - b.dist).slice(0, 300);
    if (!fResults.length && fLayers.some(l => l !== 'place')) fSearchErr = `No stations are listed nearby for what you picked. Try a bigger area or another type.`;
    else loadPrices(fResults);
  } catch (e) { fResults = []; fSearchErr = e.message || 'Could not load stations.'; }
  fSearching = false; renderFuel();
}
/* Your own last price at this station, from your fill-ups (the directory has no prices) */
function lastPaid(name) {
  const want = fFind.type === 'ev' ? 'Electric' : fFind.type === 'diesel' ? 'Diesel' : fFind.type === 'e85' ? 'E85' : fFind.grade;
  const hit = fLogs.filter(l => sameName(l.station, name) && fTypeOf(l) === want).sort((a, b) => b.date.localeCompare(a.date))[0];
  return hit ? `Your last ${fPer(hit.ppg, fUnit(hit))} · ${fmtShort(hit.date)}` : '';
}
/* Every price reported for the station, newest first, plus when it was last updated */
function priceLine(s) {
  if (NOPRICE.includes(s.kind)) return '';
  const p = fPrices[s.id] || {}, keys = Object.keys(p).sort((a, b) => FTYPES.indexOf(a) - FTYPES.indexOf(b));
  if (!keys.length) return '<span class="sub">No prices reported yet</span>';
  const newest = Math.max(...keys.map(k => new Date(p[k].at).getTime()));
  return `<span class="priceGrid">${keys.map(k => `<span>${esc(k)} <b>${fPer(p[k].price, fUnitOf(k))}</b></span>`).join('')}</span><span class="sub">Updated ${ago(new Date(newest).toISOString())}</span>`;
}
function stationRow(s) {
  const fb = isFavBrand(s.name), fp = favPlace(s), last = lastPaid(s.name);
  const badges = [s.diesel === 'yes' ? 'Diesel' : s.diesel === 'no' ? 'No diesel' : '', s.e85 === 'yes' ? 'E85' : ''].filter(Boolean).map(t => `<span class="chip">${t}</span>`).join(' ');
  return `<div class="wkRow stRow">
      <div style="min-width:0">
        <strong>${kindIcon(s.kind)} ${esc(s.name)}</strong> ${badges}
        <span class="sub">${esc([s.place, s.addr, s.city].filter(Boolean).join(' · ') || 'Address not listed')}</span>
        <span class="sub">${esc(distTxt(s))}${last ? ' · ' + last : ''}</span>
        <div class="priceBlock">${priceLine(s)}</div>
        <div class="pills brandPills" style="${pillVars(s)}">${rewardLink(s.name)}<a class="pill" href="${dirHref(s)}" target="_blank" rel="noopener">🧭 Directions</a>${NOPRICE.includes(s.kind) ? '' : `<button class="pill" data-fu="report" data-id="${esc(s.id)}">💲 Report prices</button>${fPhotos[s.id] ? `<button class="pill" data-fu="pricePhoto" data-id="${esc(s.id)}">📷 Price photo</button>` : ''}${s.name.startsWith('Unnamed') ? `<button class="pill" data-fu="nameStation" data-id="${esc(s.id)}">✎ Name it</button>` : ''}${s.id.startsWith('custom/') ? `<button class="pill" data-fu="customDel" data-id="${esc(s.id)}">🗑 Remove</button>` : ''}`}</div>
      </div>
      <div class="favBtns">
        <button class="starBtn${fb ? ' on' : ''}" data-fu="brandFav" data-id="${esc(s.id)}" aria-pressed="${fb}" aria-label="${fb ? 'Remove' : 'Add'} ${esc(s.name)} brand favorite">${fb ? '★' : '☆'} Brand</button>
        <button class="starBtn${fp ? ' on' : ''}" data-fu="placeFav" data-id="${esc(s.id)}" aria-pressed="${!!fp}" aria-label="${fp ? 'Remove' : 'Save'} this station">${fp ? '★' : '☆'} Station</button>
      </div></div>`;
}
function resultsHTML() { return placesHTML() + stationResultsHTML(); }
function stationResultsHTML() {
  if (fSearching) return '<p class="sub" style="margin:8px 0">Searching stations near you…</p>';
  if (fSearchErr) return `<p class="sub" style="margin:8px 0">${esc(fSearchErr)}</p>`;
  if (!fResults.length) return '<p class="sub" style="margin:8px 0 0">Tap “Find near me” to list stations around you. Tap a station to report its prices.</p>';
  const byDist = (a, b) => (dFrom(a) ?? 0) - (dFrom(b) ?? 0);
  const list = visibleResults().sort(byDist);
  if (!list.length) return '<p class="sub" style="margin:8px 0">No stations match that search.</p>';
  const favs = list.filter(isFavorite), others = list.filter(s => !isFavorite(s));
  return `${favs.length ? `<div class="sectionHead" style="margin:10px 0 6px"><h2 style="font-size:15px">★ Favorites nearby</h2></div><div class="card wkList">${favs.map(stationRow).join('')}</div>` : ''}
    ${others.length ? `<div class="sectionHead" style="margin:10px 0 6px"><h2 style="font-size:15px">Nearby</h2><span class="sub">${others.length} station${others.length === 1 ? '' : 's'}</span></div><div class="card wkList">${others.slice(0, 60).map(stationRow).join('')}</div>` : ''}`;
}
function renderResults() { const el = document.getElementById('fuelResults'); if (el) el.innerHTML = resultsHTML(); updateMap(); }
function findHTML() {
  const types = [['gas', 'Gas'], ['diesel', 'Diesel'], ['e85', 'E85'], ['ev', 'EV charging'], ['truck', 'Truck stops'], ['rest', 'Rest areas & services']];
  const where = fPos ? 'Distances from your location' : fCenter ? 'Distances from the searched area' : 'Turn on location for distances';
  const lay = [['fuel', '⛽ Fuel'], ['grocery', '🛒 Groceries'], ['food', '🍽️ Food'], ['lodging', '🏨 Lodging'], ['place', '📍 Places']];
  return `<div class="sectionHead" style="margin-top:0"><h2>Around me</h2><span class="sub">${where}</span></div>
    <div class="catbar" id="aroundTabs">${lay.map(([k, l]) => `<button class="cat${fLayers.includes(k) ? ' active' : ''}" data-around="${k}" aria-pressed="${fLayers.includes(k)}">${l}</button>`).join('')}</div>
    ${fLayers.includes('lodging') ? `<p class="sub" style="margin:8px 0 0">Airbnb listings aren’t available to apps. <a class="pill" href="https://www.airbnb.com/s/homes" target="_blank" rel="noopener">🏠 Open Airbnb ↗</a></p>` : ''}
    <div class="card" style="padding:12px 14px">
      <div class="findRow">
        <label class="lbl">Type<select data-find="type">${types.map(([k, l]) => `<option value="${k}" ${fFind.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="lbl" style="${fFind.type === 'gas' ? '' : 'display:none'}">Grade<select data-find="grade">${GRADES.map(g => `<option ${fFind.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
      </div>
      <input id="fPlace" type="search" data-find="place" value="${esc(fFind.place)}" placeholder="City or ZIP (optional, otherwise your location)" autocomplete="off" style="width:100%;margin-top:8px">
      <input id="fSearch" type="search" data-find="q" value="${esc(fFind.q)}" placeholder="Search brand or place, e.g. Costco" autocomplete="off" style="width:100%;margin-top:8px">
      <label class="fuelDist"><span>Show stations within <b id="fDistVal">${fRadiusMi} mi</b></span><input type="range" id="fDist" min="0" max="${DIST_STEPS.length - 1}" step="1" value="${DIST_STEPS.indexOf(fRadiusMi)}"></label>
      <button class="primary" data-fu="find" style="width:100%;margin-top:8px" ${fSearching ? 'disabled' : ''}>📍 Find near me</button><button class="ghost" data-fu="addStation">＋ Add missing station</button>
      <div id="fuelResults" style="margin-top:4px">${resultsHTML()}</div>
      <p class="sub" style="margin:12px 0 0">Find a station: ${REWARDS.map(finderChip).join(' ')}</p>
      <p class="sub" style="margin:8px 0 0">Rewards and points: ${REWARDS.map(r => rewardChip(r)).join(' ')}</p>
    </div>`;
}

/* ---------- Vehicle sections (inside each vehicle) ---------- */
function gasTilesHTML(list) {
  const now = new Date(), monthStr = ymd(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 7);
  const monthSpend = fRound(list.filter(l => l.date.slice(0, 7) === monthStr).reduce((a, l) => a + l.total, 0));
  const st = fStats(list);
  return `<div class="wkTiles">
    <div class="wkTile"><span>This month</span><strong>${money(monthSpend)}</strong></div>
    <div class="wkTile"><span>Regular price / gal</span><strong>${regularPrice(list)}</strong></div>
    <div class="wkTile"><span>MPG</span><strong>${st.mpg ? st.mpg.toFixed(1) : '—'}</strong><span class="sub">${st.mpg ? `${st.miles.toLocaleString()} mi tracked` : 'enter odometer readings'}</span></div>
    <div class="wkTile"><span>Cost per mile</span><strong>${st.perMile ? `$${st.perMile.toFixed(3)}` : '—'}</strong><span class="sub">${money(st.total)} spent · ${st.count} fill-up${st.count === 1 ? '' : 's'}</span></div>
  </div>`;
}
/* Price per gallon is shown for Regular gas only: diesel and other grades show amounts, not prices */
function regularPrice(list) { const r = fStats(list.filter(l => fTypeOf(l) === 'Regular')); return r.gal ? fPer(r.ppu, 'gal') : '—'; }
function evTilesHTML(list) {
  const ch = fStats(list);
  return `<div class="wkTiles">
      <div class="wkTile"><span>Energy added</span><strong>${fRound(ch.gal)} kWh</strong></div>
      <div class="wkTile"><span>Avg price / kWh</span><strong>${ch.gal ? fPer(ch.ppu, 'kWh') : '—'}</strong></div>
      <div class="wkTile"><span>Charging cost</span><strong>${money(ch.total)}</strong></div>
      <div class="wkTile"><span>Cost per mile</span><strong>${ch.perMile ? `$${ch.perMile.toFixed(3)}` : '—'}</strong><span class="sub">${ch.perMile ? `${ch.miles.toLocaleString()} mi tracked` : 'enter odometer readings'}</span></div>
    </div>`;
}
function fuelTypeHTML(list) {
  if (!list.length) return '';
  const by = {};
  list.forEach(l => { const k = fTypeOf(l); const o = by[k] || (by[k] = { amt: 0, total: 0 }); o.amt += l.gal; o.total += l.total; });
  const rows = Object.entries(by).sort((a, b) => b[1].total - a[1].total).map(([k, o]) => `<div class="wkRow">
      <div><strong>${esc(k)}</strong><span class="sub">${fRound(o.amt)} ${fUnitOf(k)}${k === 'Regular' ? ` · ${fPer(o.total / o.amt, 'gal')} avg` : ''}</span></div>
      <div class="wkAmt"><b>${money(o.total)}</b></div></div>`).join('');
  const n = Object.keys(by).length;
  return `<div class="sectionHead"><h2>By fuel type</h2><span class="sub">${n} type${n === 1 ? '' : 's'}</span></div><div class="card wkList">${rows}</div>`;
}
/* Where this vehicle's fuel costs least, per station (only stations with a name) */
function stationsHTML(list) {
  const by = {};
  list.filter(l => (l.station || '').trim() && fTypeOf(l) === 'Regular').forEach(l => {
    const name = l.station.trim(), unit = fUnit(l), k = name.toLowerCase() + '|' + unit;
    const o = by[k] || (by[k] = { name, unit, amt: 0, total: 0, n: 0, last: '' });
    o.amt += l.gal; o.total += l.total; o.n++; if (l.date > o.last) o.last = l.date;
  });
  const rows = Object.values(by).filter(o => o.amt > 0).map(o => ({ ...o, ppu: o.total / o.amt })).sort((a, b) => a.ppu - b.ppu);
  if (!rows.length) return '<p class="sub" style="margin:8px 0">Add a station or charger name to a fill-up to see where you pay least.</p>';
  return `<div class="sectionHead"><h2>Where you pay least</h2><span class="sub">Regular gas</span></div><div class="card wkList">${rows.slice(0, 6).map((o, i) => `<div class="wkRow">
      <div><strong>${esc(o.name)}${i === 0 ? ' <span class="chip">cheapest</span>' : ''}</strong><span class="sub">${o.n} visit${o.n === 1 ? '' : 's'} · last ${fmtShort(o.last)}</span>${rewardLink(o.name) ? `<div>${rewardLink(o.name)}</div>` : ''}</div>
      <div class="wkAmt"><b>${fPer(o.ppu, o.unit)}</b></div></div>`).join('')}</div>`;
}
/* Gas prices show for Regular only; charging (kWh) always shows its price */
const priceShown = l => fUnit(l) === 'kWh' || fTypeOf(l) === 'Regular';
function fillUpsHTML(list, vid) {
  const rows = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.odo || 0) - (a.odo || 0)).slice(0, 60).map(l => `<div class="wkRow">
      ${l.photo ? `<img class="fuThumb" data-fu="zoom" data-key="${fPhotoKey(l.id)}" alt="Fill-up photo, tap to enlarge">` : ''}
      <div><strong>${money(l.total)} · ${l.gal} ${fUnit(l)}</strong><span class="sub">${fmtShort(l.date)}${priceShown(l) ? ' · ' + fPer(l.ppg, fUnit(l)) : ''}${l.odo ? ` · ${l.odo.toLocaleString()} mi` : ''}${l.station ? ` · ${esc(l.station)}` : ''}${l.job ? ` · ${esc(wJob(l.job)?.name || 'job')}` : ''}${l.payer === 'owner' ? ' · Owner paid' : (l.job ? (l.reimb ? ' · Reimbursed' : ' · Owed to you') : '')}${l.note ? ' · ' + esc(l.note) : ''}</span></div>
      <button class="iconbtn" data-fu="edit" data-id="${esc(l.id)}" aria-label="Edit fill-up">✎</button>
      <button class="iconbtn" data-fu="del" data-id="${esc(l.id)}" aria-label="Delete fill-up">🗑</button></div>`).join('')
    || '<div class="empty">No fill-ups yet.</div>';
  return `<div class="sectionHead"><h2>Fill-ups</h2><button class="primary" data-vd="fill" data-id="${esc(vid)}" style="padding:6px 12px">+ Fill-up</button></div>
    <div class="card wkList">${rows}</div>`;
}
/* Everything for one vehicle: totals for its type, fuel type breakdown, where it pays least, and its fill-ups */
function vehicleSectionsHTML(v) {
  const list = fLogs.filter(l => l.vid === v.id);
  const totals = v.fuel === 'Electric' ? evTilesHTML(list.filter(l => fUnit(l) === 'kWh')) : gasTilesHTML(list.filter(l => fUnit(l) === 'gal'));
  return totals + whoPaidHTML(list) + fuelTypeHTML(list) + stationsHTML(list) + fillUpsHTML(list, v.id);
}
/* Owner-paid fuel vs fuel you paid, and how much of yours is still owed back (job fuel only) */
function whoPaidHTML(list) {
  const owner = fRound(list.filter(l => l.payer === 'owner').reduce((a, l) => a + l.total, 0));
  const mine = list.filter(l => l.payer !== 'owner');
  const paid = fRound(mine.reduce((a, l) => a + l.total, 0));
  const reimbursed = fRound(mine.filter(l => l.reimb).reduce((a, l) => a + l.total, 0));
  const owed = fRound(mine.filter(l => l.job && !l.reimb).reduce((a, l) => a + l.total, 0));
  if (!owner && !paid) return '';
  return `<div class="wkTiles" style="margin-top:10px">
    <div class="wkTile"><span>Owner paid</span><strong>${money(owner)}</strong><span class="sub">not reimbursed</span></div>
    <div class="wkTile"><span>You paid</span><strong>${money(paid)}</strong><span class="sub">${money(reimbursed)} reimbursed</span></div>
    <div class="wkTile"><span>Owed to you</span><strong>${money(owed)}</strong><span class="sub">work fuel</span></div></div>`;
}

/* ---------- Vehicles section (top level) ---------- */
function vehiclesHTML() {
  const many = fVehicles.length > 1;
  const cards = fVehicles.map(v => `<div class="card vehCard">
      ${v.photo ? `<img class="fuThumb vehThumb" data-fu="vopen" data-id="${esc(v.id)}" data-key="${vKey(v.id)}" alt="${esc(v.name)}, tap for details">` : `<span class="fuThumb fuPh vehThumb" data-fu="vopen" data-id="${esc(v.id)}" aria-label="${esc(v.name)}, tap for details">🚗</span>`}
      <div class="vehBody">
        <div style="flex:1;min-width:0;display:grid;gap:2px"><strong>${esc(v.name)}</strong><span class="sub">${esc(v.fuel || 'Regular')}${v.photo ? '' : ' · no photo yet'}</span></div>
        <div class="row" style="gap:4px;flex:0 0 auto">
          <button class="ghost" data-fu="addfill" data-id="${esc(v.id)}" style="padding:6px 10px">+ Fill-up</button>
          <button class="iconbtn" data-fu="vphoto" data-mode="take" data-id="${esc(v.id)}" aria-label="Take vehicle photo" title="Take photo">📷</button>
          <button class="iconbtn" data-fu="vphoto" data-mode="up" data-id="${esc(v.id)}" aria-label="Upload vehicle photo" title="Upload photo">🖼</button>
          <button class="iconbtn" data-fu="vedit" data-id="${esc(v.id)}" aria-label="Edit vehicle" title="Edit">✎</button>
        </div>
      </div></div>`).join('') || '<div class="empty">No vehicles yet. Add one below.</div>';
  const dots = many ? `<div class="vehDots" aria-hidden="true">${fVehicles.map((v, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : '';
  return `<div class="sectionHead"><h2>Vehicles</h2><button class="ghost" data-fu="csv" style="padding:6px 12px">Export CSV</button></div>
    <div class="card" style="padding:12px 14px">
      <form class="row" id="fuelVehForm" style="gap:8px"><input id="fVehName" maxlength="40" placeholder="Name, e.g. My car" autocomplete="off" style="flex:1;min-width:150px"><select id="fVehType" aria-label="Fuel type (set once, when the vehicle is added)">${FTYPES.map(t => `<option>${t}</option>`).join('')}</select><button class="ghost" type="submit">+ Add vehicle</button></form>
      <p class="sub" style="margin:8px 0 0">Pick the fuel type when you add a vehicle. It can’t be changed later.</p>
    </div>
    <div class="vehRail${many ? ' many' : ''}" id="vehRail" style="margin-top:8px">${cards}</div>${dots}`;
}
/* Dots follow the card in view while swiping */
function railDots() {
  const rail = document.getElementById('vehRail'); if (!rail || !rail.firstElementChild) return;
  const step = rail.firstElementChild.offsetWidth + 12, i = Math.min(fVehicles.length - 1, Math.max(0, Math.round(rail.scrollLeft / step)));
  document.querySelectorAll('.vehDots i').forEach((d, k) => d.classList.toggle('on', k === i));
}
/* Thumbnails load from this device's photo store (cached, so redrawing never flashes) */
async function hydrateFuelPhotos() {
  for (const img of document.querySelectorAll('#fuelBody img[data-key], #vdBody img[data-key]')) {
    const url = await fUrlFor(img.dataset.key); if (url && img.getAttribute('src') !== url) img.src = url;
  }
}

/* ---------- My favorites: brands and saved places, with alerts ---------- */
function favoritesCardHTML() {
  const on = localStorage.getItem(ALERTS_KEY) === '1';
  const brands = fBrands.map(b => `<button class="chip" data-fu="brandDel" data-name="${esc(b)}" aria-label="Remove ${esc(b)} from favorites">★ ${esc(b)} ×</button>`).join('');
  const places = fStations.map(s => {
    const d = fPos ? fuelDist(fPos, s) : null;
    return `<div class="wkRow">
      <div style="min-width:0"><strong>${esc(s.name)}</strong><span class="sub">${d !== null ? fmtDist(d) : 'Saved location'}</span>${rewardLink(s.name) ? `<div>${rewardLink(s.name)}</div>` : ''}</div>
      <button class="iconbtn" data-fu="stDel" data-id="${esc(s.id)}" aria-label="Remove station">🗑</button></div>`;
  }).join('');
  const none = !brands && !places;
  return `<div class="sectionHead"><h2>My favorites</h2><span class="sub">${fBrands.length} brand${fBrands.length === 1 ? '' : 's'} · ${fStations.length} station${fStations.length === 1 ? '' : 's'}</span></div>
    <div class="card" style="padding:12px 14px">
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="ghost" data-fu="stAdd">📍 Save this spot</button><button class="ghost" data-fu="stAlerts">${on ? '🔔 Alerts on' : '🔕 Alerts off'}</button></div>
      ${brands ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${brands}</div>` : ''}
      ${places ? `<div class="wkList" style="margin-top:8px">${places}</div>` : ''}
      ${none ? '<p class="sub" style="margin:8px 0 0">In Find fuel, tap ☆ Brand to favorite a brand, or ☆ Station to favorite one location.</p>' : ''}
      <p class="sub" style="margin:10px 0 0">With alerts on and the app open, Kayaos tells you when you’re within about 200 m of a favorite station, or of a favorite brand from your last search.</p>
    </div>`;
}

/* Reported prices near you: a card, cheapest first, for the fuel type picked */
function relAge(at) { const m = Math.round((Date.now() - Date.parse(at)) / 6e4); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
function reportedCardHTML() {
  if (!fResults.length) return '';
  const cur = curType();
  const rows = fResults.filter(s => fPrices[s.id]?.[cur]).map(s => ({ s, p: fPrices[s.id][cur] })).sort((a, b) => a.p.price - b.p.price).slice(0, 6);
  const body = rows.length ? rows.map(({ s, p }) => `<div class="wkRow"><div style="min-width:0"><strong>${esc(s.name)}</strong><span class="sub">${esc(distTxt(s))} · ${relAge(p.at)}</span></div><div class="wkAmt"><b>${fPer(p.price, fUnitOf(cur))}</b></div></div>`).join('')
    : '<p class="sub" style="margin:6px 0 0">No reported prices yet. Tap a station on the map, then Report prices.</p>';
  return `<div class="card" style="padding:12px 14px;margin-bottom:12px"><div class="sectionHead" style="margin:0 0 6px"><h2 style="font-size:17px">Reported prices</h2><span class="sub">${esc(cur)} · cheapest first</span></div>${body}</div>`;
}
/* Street or satellite, switched by the button on the map; the choice is remembered */
function viewLabel() { const b = document.getElementById('fuelViewBtn'); if (b) b.textContent = fView === 'street' ? '🛰️ Satellite' : '🗺️ Street'; }
function toggleMapView() {
  if (!fMap || !fTiles) return;
  const next = fView === 'street' ? 'sat' : 'street';
  fMap.removeLayer(fTiles[fView]); fTiles[next].addTo(fMap); fView = next; store('kayaos.v4.mapView', fView); viewLabel();
}
function renderFuel() {
  const body = $('#fuelBody'); if (!body) return;
  if (document.activeElement && document.activeElement.id === 'fSearch') { renderResults(); return; }   /* don't redraw under the search box while typing */
  const prev = document.getElementById('vehRail')?.scrollLeft || 0;   /* keep the swipe position when the page redraws */
  body.innerHTML = `${fAccountHTML()}${findHTML()}${reportedCardHTML()}${favoritesCardHTML()}${vehiclesHTML()}`;
  const rail = document.getElementById('vehRail');
  if (rail) { rail.scrollLeft = prev; rail.addEventListener('scroll', railDots, { passive: true }); }
  railDots();
  hydrateFuelPhotos();
  updateMap();
  if ($('#vehicleDialog').open && vdId) renderVehicleDialog(vdId);
}

/* ---------- Vehicle details (opened from the thumbnail) ---------- */
async function renderVehicleDialog(id) {
  const v = fVehicles.find(x => x.id === id); if (!v) { $('#vehicleDialog').close(); return; }
  vdId = id;
  const idx = fVehicles.findIndex(x => x.id === id);
  const navHTML = fVehicles.length > 1 ? `<div class="vdNav"><button class="ghost" data-vd="prev" aria-label="Previous vehicle">‹</button><span class="sub">${idx + 1} of ${fVehicles.length} · swipe to change</span><button class="ghost" data-vd="next" aria-label="Next vehicle">›</button></div>` : '';
  const url = v.photo ? await fUrlFor(vKey(v.id)) : null;
  const photo = url ? `<img data-vd="zoom" src="${url}" alt="${esc(v.name)}, tap to enlarge" style="display:block;width:100%;max-height:44vh;object-fit:cover;border-radius:14px;cursor:zoom-in">`
    : '<div style="height:120px;display:flex;align-items:center;justify-content:center;font-size:52px;border-radius:14px;border:1px dashed var(--line)">🚗</div>';
  $('#vdBody').innerHTML = `
    <div class="dialogHead"><h2>${esc(v.name)}</h2><button type="button" class="iconbtn" data-close aria-label="Close">×</button></div>
    ${navHTML}${photo}
    <p class="sub" style="margin:10px 0 0">Fuel type: <strong>${esc(v.fuel || 'Regular')}</strong> · set when the vehicle was added</p>
    ${vehicleSectionsHTML(v)}`;
  if (!$('#vehicleDialog').open) $('#vehicleDialog').showModal();
  hydrateFuelPhotos();
}
function openVehicle(id) { renderVehicleDialog(id); }
function refreshVehicleDialog() { if ($('#vehicleDialog').open && vdId) renderVehicleDialog(vdId); }

/* ---------- Vehicle edit (name, remove photo, delete) ---------- */
function openVehEdit(id) {
  const v = fVehicles.find(x => x.id === id); if (!v) return;
  const f = $('#vehEditForm');
  f.id.value = v.id; f.name.value = v.name;
  $('#vehRmPhoto').hidden = !v.photo;
  $('#vehEditDialog').showModal();
}
function deleteVehicle(id) {
  if (!confirm('Delete this vehicle and all its fill-ups? This cannot be undone.')) return;
  fLogs.filter(l => l.vid === id).forEach(l => { if (l.photo) { MediaDB.del(fPhotoKey(l.id)).catch(() => {}); fForget(fPhotoKey(l.id)); fPhotoGone(l); } });
  fLogs = fLogs.filter(l => l.vid !== id); fRemoteDel(FX.veh, id);
  const v = fVehicles.find(x => x.id === id);
  if (v && v.photo) { MediaDB.del(vKey(id)).catch(() => {}); fForget(vKey(id)); fPhotoGone(v); }
  fVehicles = fVehicles.filter(x => x.id !== id);
  fSave(); $('#vehEditDialog').close(); $('#vehicleDialog').close(); vdId = null; renderFuel(); toast('Vehicle deleted');
}
function removeVehPhoto(id) {
  const v = fVehicles.find(x => x.id === id); if (!v) return;
  MediaDB.del(vKey(id)).catch(() => {}); fForget(vKey(id)); fPhotoGone(v); v.photo = false; fDirty(v); fSave(); renderFuel(); refreshVehicleDialog(); toast('Vehicle photo removed');
}

/* ---------- Fill-up form (fuel type comes from the vehicle) ---------- */
function fuelLabels(type) {
  const u = fUnitOf(type), f = $('#fuelForm');
  $('#fuelUnitLbl').textContent = u === 'kWh' ? 'kWh added' : 'Gallons';
  $('#fuelPpgLbl').textContent = u === 'kWh' ? 'Price per kWh' : 'Price per gallon';
  f.gal.placeholder = u === 'kWh' ? 'e.g. 28' : 'e.g. 8.5';
  updateFuelHint();
}
/* Sets the form's fuel type from its vehicle (or the saved fill-up when editing) and shows it */
function setFormType(type) {
  const f = $('#fuelForm'); f.ftype.value = type; fuelLabels(type);
  $('#fuelTypeLine').textContent = `Fuel: ${type} (from the vehicle)`;
}
/* Shows the current photo (edit mode) and the remove option */
async function setPhotoPreview(l) {
  const img = $('#fuelPhotoPrev'), wrap = $('#fuelRmWrap'), rm = document.querySelector('#fuelForm [name=rmPhoto]');
  rm.checked = false;
  if (l && l.photo) {
    const url = await fUrlFor(fPhotoKey(l.id));
    if (url) { img.src = url; img.style.display = 'block'; wrap.style.display = 'flex'; return; }
  }
  img.removeAttribute('src'); img.style.display = 'none'; wrap.style.display = 'none';
}
/* Opens the fill-up form for a vehicle (new), or an existing entry to edit */
function openFill(editId, vid) {
  const existing = editId ? fLogs.find(x => x.id === editId) : null;
  if (!existing && !fVehicles.length) { toast('Add a vehicle first'); return; }
  const f = $('#fuelForm');
  f.vid.innerHTML = fVehicles.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
  f.job.innerHTML = '<option value="">No job</option>' + wJobs.map(j => `<option value="${esc(j.id)}">${esc(j.name)}</option>`).join('');
  $('#stationList').innerHTML = [...new Set(fLogs.map(l => (l.station || '').trim()).filter(Boolean))].sort().map(s => `<option value="${esc(s)}">`).join('');
  f.photo.value = '';
  if (existing) {
    $('#fuelDlgTitle').textContent = 'Edit fill-up';
    $('#fuelSaveBtn').textContent = '✓ Save changes';
    f.editId.value = existing.id;
    f.vid.value = existing.vid;
    f.date.value = existing.date; f.gal.value = existing.gal; f.total.value = existing.total; f.ppg.value = existing.ppg;
    f.payer.value = existing.payer === 'owner' ? 'owner' : 'me'; f.reimb.checked = !!existing.reimb;
    f.odo.value = existing.odo || ''; f.note.value = existing.note || ''; f.job.value = existing.job || ''; f.station.value = existing.station || '';
    setFormType(fTypeOf(existing));
    setPhotoPreview(existing);
  } else {
    const target = vid || fVehicles[0].id, v = fVehicles.find(x => x.id === target) || fVehicles[0];
    $('#fuelDlgTitle').textContent = `Fill-up · ${v.name}`;
    $('#fuelSaveBtn').textContent = '✓ Save fill-up';
    f.editId.value = '';
    f.vid.value = v.id;
    f.date.value = ymd(new Date()); f.gal.value = ''; f.total.value = ''; f.ppg.value = ''; f.odo.value = ''; f.note.value = ''; f.job.value = ''; f.station.value = '';
    f.payer.value = 'me'; f.reimb.checked = false;
    setFormType(v.fuel || 'Regular');
    setPhotoPreview(null);
  }
  $('#fuelDialog').showModal();
}
function updateFuelHint() {
  const f = $('#fuelForm'), u = fUnitOf(f.ftype.value), c = fComplete({ gal: f.gal.value, total: f.total.value, ppg: f.ppg.value });
  $('#fuelHint').textContent = c ? `${c.gal} ${u} · ${money(c.total)} · ${fPer(c.ppg, u)}` : `Enter two of: ${u === 'kWh' ? 'kWh added' : 'gallons'}, total paid, price per ${u === 'kWh' ? 'kWh' : 'gallon'}.`;
}

/* ---------- Export ---------- */
function exportFuelCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const vname = id => fVehicles.find(v => v.id === id)?.name || '';
  const lines = ['Date,Vehicle,Fuel type,Amount,Unit,Total paid,Price per unit,Odometer,Station,Job,Note,Paid by,Reimbursed'];
  [...fLogs].sort((a, b) => a.date.localeCompare(b.date)).forEach(l => lines.push([l.date, vname(l.vid), fTypeOf(l), l.gal, fUnit(l), l.total, l.ppg, l.odo || '', l.station || '', wJob(l.job)?.name || '', l.note || '', l.payer === 'owner' ? 'Owner' : 'Me', l.reimb ? 'yes' : 'no'].map(q).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kayaos-fuel-${ymd(new Date())}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Fuel exported as CSV');
}

/* ---------- Dialogs (vehicle details, vehicle edit, photo viewer) — created once ---------- */
function pickFrom(input, mode) {
  if (mode === 'take') input.setAttribute('capture', 'environment'); else input.removeAttribute('capture');
  input.click();
}
function ensureFuelDialogs() {
  if ($('#vehicleDialog')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="vehicleDialog"><div class="dialogIn" id="vdBody"></div></dialog>
    <dialog id="vehEditDialog"><form class="dialogIn form" id="vehEditForm" method="dialog">
      <input type="hidden" name="id">
      <div class="dialogHead"><h2>Edit vehicle</h2><button type="button" class="iconbtn" data-close aria-label="Close">×</button></div>
      <label class="lbl">Name<input name="name" maxlength="40" required autocomplete="off"></label>
      <button class="ghost" type="button" id="vehRmPhoto" style="width:100%">Remove vehicle photo</button>
      <div class="clearList"><button class="primary" type="submit">✓ Save vehicle</button></div>
      <button class="ghost dangerText" type="button" id="vehDelete" style="width:100%;margin-top:8px">Delete vehicle</button>
    </form></dialog>`);
  $('#vehicleDialog').addEventListener('click', e => {
    const fu = e.target.closest('[data-fu]'); if (fu) { handleFu(fu); return; }
    const b = e.target.closest('[data-vd]'); if (!b || !vdId) return;
    const k = b.dataset.vd;
    if (k === 'zoom') { const src = b.getAttribute('src'); if (src) { $('#fuelPhotoFull').src = src; $('#fuelPhotoDialog').showModal(); } }
    else if (k === 'fill') { const id = vdId; $('#vehicleDialog').close(); setTimeout(() => openFill(null, id), 0); }
    else if (k === 'prev' || k === 'next') stepVehicle(k === 'next' ? 1 : -1);
  });
  $('#vehEditForm').addEventListener('submit', e => {
    e.preventDefault(); const f = e.target, v = fVehicles.find(x => x.id === f.id.value); if (!v) return;
    const name = f.name.value.trim(); if (!name) { toast('Enter a vehicle name'); return; }
    v.name = name; fDirty(v); fSave(); $('#vehEditDialog').close(); renderFuel(); refreshVehicleDialog(); toast('Vehicle updated');
  });
  $('#vehRmPhoto').addEventListener('click', () => { if (confirm('Remove this vehicle photo?')) { const id = $('#vehEditForm').id.value; $('#vehEditDialog').close(); removeVehPhoto(id); } });
  $('#vehDelete').addEventListener('click', () => deleteVehicle($('#vehEditForm').id.value));
  /* Swipe left / right in the opened vehicle to move to the next / previous vehicle */
  let sx = null, sy = null;
  $('#vdBody').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('#vdBody').addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepVehicle(dx < 0 ? 1 : -1);
  }, { passive: true });
}
ensureFuelDialogs();

/* ---------- Wiring ---------- */
/* One handler for the fuel actions, used by the page and by the vehicle details */
function handleFu(b) {
  const k = b.dataset.fu;
  if (k === 'find') findNear();
  else if (k === 'brandFav') { const s = fResults.find(x => x.id === b.dataset.id); if (s) brandToggle(s.name); }
  else if (k === 'placeFav') { const s = fResults.find(x => x.id === b.dataset.id); if (s) placeToggle(s); }
  else if (k === 'brandDel') brandToggle(b.dataset.name);
  else if (k === 'signin') $('#settingsBtn').click();
  else if (k === 'report') reportPrice(b.dataset.id);
  else if (k === 'pricePhoto') showPricePhoto(b.dataset.id);
  else if (k === 'nameStation') nameStation(b.dataset.id);
  else if (k === 'addStation') addStation();
  else if (k === 'mapView') toggleMapView();
  else if (k === 'customDel') { if (confirm('Remove this station you added?')) { store(CUSTOM_KEY, load(CUSTOM_KEY, []).filter(c => c.id !== b.dataset.id)); findNear(); } }
  else if (k === 'csv') exportFuelCSV();
  else if (k === 'stAdd') saveStationHere();
  else if (k === 'stAlerts') toggleAlerts();
  else if (k === 'stDel') { fStations = fStations.filter(s => s.id !== b.dataset.id); fStationsSave(); fRemoteDel(FX.fav, b.dataset.id); fSyncSoon(); if (!hasFavs()) stopWatch(); renderFuel(); }
  else if (k === 'edit') openFill(b.dataset.id);
  else if (k === 'addfill') openFill(null, b.dataset.id);
  else if (k === 'zoom') {
    const src = b.getAttribute('src'); if (!src) { toast('Photo is not on this device'); return; }
    $('#fuelPhotoFull').src = src; $('#fuelPhotoDialog').showModal();
  }
  else if (k === 'vopen') openVehicle(b.dataset.id);
  else if (k === 'vedit') openVehEdit(b.dataset.id);
  else if (k === 'vphoto') { vPhotoTarget = b.dataset.id; pickFrom($('#vehPhotoInput'), b.dataset.mode); }
  else if (k === 'del' && confirm('Delete this fill-up?')) {
    const l = fLogs.find(x => x.id === b.dataset.id);
    if (l && l.photo) { MediaDB.del(fPhotoKey(l.id)).catch(() => {}); fForget(fPhotoKey(l.id)); }
    if (l) { fPhotoGone(l); fRemoteDel(FX.log, l.id); }
    fLogs = fLogs.filter(x => x.id !== b.dataset.id); fSave(); fSyncSoon(); renderFuel(); refreshVehicleDialog();
  }
}
$('[data-view="fuel"]').addEventListener('click', e => { const b = e.target.closest('[data-fu]'); if (b) handleFu(b); }, true);
$('[data-view="fuel"]').addEventListener('input', e => {
  if (e.target.dataset.find === 'q') { fFind.q = e.target.value; renderResults(); }
  if (e.target.dataset.find === 'place') fFind.place = e.target.value;
});
$('[data-view="fuel"]').addEventListener('change', e => {
  if (e.target.dataset.find === 'type') { fFind.type = e.target.value; fResults = []; fSearchErr = ''; renderFuel(); }
  if (e.target.dataset.find === 'grade') { fFind.grade = e.target.value; fResults = []; fSearchErr = ''; renderFuel(); }
});
$('[data-view="fuel"]').addEventListener('submit', e => {
  if (e.target.id !== 'fuelVehForm') return;
  e.preventDefault(); const name = $('#fVehName').value.trim(); if (!name) { toast('Enter a vehicle name'); return; }
  const v = { id: uuid(), name, fuel: $('#fVehType').value }; fVehicles.push(v); fSave(); fSyncSoon(); renderFuel(); toast(`Added ${name}`);
});
$('#vehPhotoInput').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0], v = fVehicles.find(x => x.id === vPhotoTarget);
  e.target.value = '';
  if (!file || !v) return;
  try { await MediaDB.put(vKey(v.id), await compressImage(file, 1200, 0.8)); fForget(vKey(v.id)); v.photo = true; v.photoPath = null; fDirty(v); fSave(); renderFuel(); refreshVehicleDialog(); toast(`${v.name} photo saved`); }
  catch (err) { toast('Could not save the vehicle photo'); }
});
$('#fuelForm').addEventListener('click', e => {
  const b = e.target.closest('[data-ph]'); if (!b) return;
  pickFrom($('#fuelForm').photo, b.dataset.ph);
});
$('#fuelForm').addEventListener('input', updateFuelHint);
$('#fuelForm').addEventListener('change', e => {
  if (e.target.name === 'vid') { if (!$('#fuelForm').editId.value) { const v = fVehicles.find(x => x.id === e.target.value); setFormType(v?.fuel || 'Regular'); } }
  if (e.target.name === 'photo') {
    const file = e.target.files && e.target.files[0];
    if (file) { const img = $('#fuelPhotoPrev'); img.src = URL.createObjectURL(file); img.style.display = 'block'; $('#fuelRmWrap').style.display = 'flex'; document.querySelector('#fuelForm [name=rmPhoto]').checked = false; fillFromReceipt(file); }
  }
  if (e.target.name === 'rmPhoto' && e.target.checked) { $('#fuelForm').photo.value = ''; $('#fuelPhotoPrev').style.display = 'none'; }
});
$('#fuelForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, type = f.ftype.value || 'Regular', unit = fUnitOf(type);
  const c = fComplete({ gal: f.gal.value, total: f.total.value, ppg: f.ppg.value });
  if (!c) { toast(`Enter two of: ${unit === 'kWh' ? 'kWh added' : 'gallons'}, total paid, price per ${unit === 'kWh' ? 'kWh' : 'gallon'}`); return; }
  if (!f.date.value) { toast('Enter the date'); return; }
  const editing = f.editId.value, existing = editing ? fLogs.find(x => x.id === editing) : null;
  const id = existing ? existing.id : uuid(), file = f.photo.files && f.photo.files[0], remove = f.rmPhoto.checked;
  let photo = existing ? !!existing.photo : false;
  if (remove && existing) { MediaDB.del(fPhotoKey(id)).catch(() => {}); fForget(fPhotoKey(id)); photo = false; }
  const odo = parseFloat(String(f.odo.value).replace(/,/g, '')) || 0;
  const entry = { id, vid: f.vid.value, ftype: type, unit, date: f.date.value, gal: c.gal, total: c.total, ppg: c.ppg, odo, job: f.job.value || '', station: f.station.value.trim(), note: f.note.value.trim(), photo, payer: f.payer.value === 'owner' ? 'owner' : 'me', reimb: f.payer.value !== 'owner' && f.reimb.checked };
  if (existing) { if (file) existing.photoPath = null; if (!photo) fPhotoGone(existing); Object.assign(existing, entry); existing.synced = false; } else fLogs.push(entry);
  /* Save the fill-up right away; a new photo is stored in the background so a slow or failed photo never blocks Save */
  fSyncSoon();
  fSave(); $('#fuelDialog').close(); renderFuel(); refreshVehicleDialog();
  toast(existing ? 'Fill-up updated' : `Saved · ${money(c.total)}`);
  if (file) storeFuelPhoto(id, file);
});
/* Compress and store a fill-up photo; gives up after 15 s and says so, leaving the fill-up saved */
async function storeFuelPhoto(id, file) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000));
  try {
    await Promise.race([compressImage(file).then(blob => MediaDB.put(fPhotoKey(id), blob)), timeout]);
    fForget(fPhotoKey(id));
    const l = fLogs.find(x => x.id === id);
    if (l) { l.photo = true; l.photoPath = null; l.synced = false; fSave(); fSyncSoon(); }
    renderFuel(); refreshVehicleDialog();
  } catch (err) { toast('Saved, but the photo could not be stored'); }
}

/* ---------- Favorites: brands, places, and nearby alerts ---------- */
function stepVehicle(dir) {
  if (fVehicles.length < 2 || !vdId) return;
  const i = fVehicles.findIndex(x => x.id === vdId);
  renderVehicleDialog(fVehicles[(i + dir + fVehicles.length) % fVehicles.length].id);
}
function brandToggle(name) {
  const k = brandKey(name), i = fBrands.findIndex(b => brandKey(b) === k);
  if (i >= 0) { fBrands.splice(i, 1); fRemoteDel(FX.fav, 'brand:' + k); toast(`${name} removed from favorites`); }
  else { fBrands.push(name); toast(`★ ${name} is a favorite brand`); }
  fBrandsSave(); fSyncSoon(); if (!hasFavs()) stopWatch(); else if (localStorage.getItem(ALERTS_KEY) === '1') startWatch();
  renderFuel();
}
function placeToggle(s) {
  const i = fStations.findIndex(x => x.osm === s.id);
  if (i >= 0) { fRemoteDel(FX.fav, fStations[i].id); fStations.splice(i, 1); toast(`${s.name} removed from favorites`); }
  else { fStations.push({ id: uuid(), name: s.addr ? `${s.name} · ${s.addr}` : s.name, lat: s.lat, lng: s.lng, osm: s.id }); toast(`★ Saved ${s.name}`); }
  fStationsSave(); fSyncSoon(); if (!hasFavs()) stopWatch(); else if (localStorage.getItem(ALERTS_KEY) === '1') startWatch();
  renderFuel();
}
function saveStationHere() {
  if (!navigator.geolocation) { toast('Location is not available on this device'); return; }
  navigator.geolocation.getCurrentPosition(p => {
    fPos = p.coords;
    const name = (prompt('Name this spot (for example Costco or Shell on Pines)', '') || '').trim();
    if (!name) return;
    fStations.push({ id: uuid(), name, lat: p.coords.latitude, lng: p.coords.longitude }); fStationsSave(); fSyncSoon();
    if (localStorage.getItem(ALERTS_KEY) === '1') startWatch();
    renderFuel(); const r = rewardFor(name); toast(`Saved ${name}${r ? ' · ' + r.name : ''}`);
  }, () => toast('Allow location to save this spot'), { enableHighAccuracy: true, timeout: 15000 });
}
async function toggleAlerts() {
  if (localStorage.getItem(ALERTS_KEY) === '1') { localStorage.setItem(ALERTS_KEY, '0'); stopWatch(); renderFuel(); toast('Station alerts off'); return; }
  if (!hasFavs()) { toast('Favorite a brand or station first'); return; }
  if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) {} }
  localStorage.setItem(ALERTS_KEY, '1'); startWatch(); renderFuel(); toast('Station alerts on');
}
function startWatch() {
  if (fWatch != null || !navigator.geolocation || !hasFavs()) return;
  fWatch = navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 });
}
function stopWatch() { if (fWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(fWatch); fWatch = null; }
/* Runs on each location update: alerts once per favorite every 3 hours; redraws only when you arrive at or leave one */
function onPos(p) {
  fPos = p.coords;
  const targets = [
    ...fStations.map(s => ({ key: 'place-' + s.id, name: s.name, lat: s.lat, lng: s.lng })),
    ...fResults.filter(s => isFavBrand(s.name) && !favPlace(s)).map(s => ({ key: 'brand-' + s.id, name: s.name, lat: s.lat, lng: s.lng }))
  ];
  const near = targets.filter(t => fuelDist(fPos, t) <= NEAR_M);
  near.forEach(t => {
    if (fAlerted[t.key] && Date.now() - fAlerted[t.key] < 3 * 36e5) return;
    fAlerted[t.key] = Date.now();
    const r = rewardFor(t.name);
    showNote(`You're near ${t.name}`, r ? `${r.name} · tap to see your rewards` : 'Good place to fill up', 'fav-' + t.key);
    toast(`You're at ${t.name}${r ? ' · ' + r.name : ''}`);
  });
  const key = near.map(t => t.key).join(',');
  if (key !== fNearKey) { fNearKey = key; if (view === 'fuel') renderFuel(); }
}
if (localStorage.getItem(ALERTS_KEY) === '1') startWatch();

/* ---------- Account sync (optional): vehicles, fill-ups and favorites follow your account across devices ----------
   A row marked synced is the account's copy. An unsynced row is this device's newer edit, sent on the next sync.
   A synced row the account no longer has was removed on another device, so it is removed here too. */
const FX = { veh: 'fuel_vehicles', log: 'fuel_logs', fav: 'fuel_favorites' };
const OWNER_KEY = 'kayaos.v4.fuelOwner';
let fSyncing = false, fSyncTimer = null;
const fSignedIn = () => !!(sb && currentUser);
const fMedia = () => sb.storage.from('kayaos-media');
/* Marks items as edited on this device and schedules a sync */
function fDirty(...items) { items.forEach(x => { x.synced = false; }); fSyncSoon(); }
function fSyncSoon() { if (!fSignedIn()) return; clearTimeout(fSyncTimer); fSyncTimer = setTimeout(fuelSync, 600); }
function fRemoteDel(table, id) {
  if (!fSignedIn()) return;
  sb.from(table).delete().eq('id', id).then(({ error }) => { if (error) toast('Could not remove from your account: ' + error.message); });
}
/* Removes a photo's file from the account; the local copy is removed by the caller */
function fPhotoGone(item) {
  if (item.photoPath && fSignedIn()) fMedia().remove([item.photoPath]).catch(() => {});
  item.photoPath = null;
}
const vehRow = (v, uid) => ({ id: v.id, user_id: uid, name: v.name, fuel: v.fuel || 'Regular', photo_path: v.photoPath || null });
const vehFrom = r => ({ id: r.id, name: r.name, fuel: r.fuel || 'Regular', photo: !!r.photo_path, photoPath: r.photo_path || null, synced: true });
const logRow = (l, uid) => ({ id: l.id, user_id: uid, vehicle_id: l.vid, fill_date: l.date, fuel_type: fTypeOf(l), unit: fUnit(l), amount: l.gal, total: l.total, price: l.ppg, odometer: l.odo || null, station: l.station || null, job_id: l.job || null, note: l.note || null, photo_path: l.photoPath || null , payer: l.payer === 'owner' ? 'owner' : 'me', reimb: !!l.reimb });
const logFrom = r => ({ id: r.id, vid: r.vehicle_id, date: r.fill_date, ftype: r.fuel_type || 'Regular', unit: r.unit || fUnitOf(r.fuel_type), gal: +r.amount, total: +r.total, ppg: +r.price, odo: +r.odometer || 0, station: r.station || '', job: r.job_id || '', note: r.note || '', photo: !!r.photo_path, photoPath: r.photo_path || null, synced: true , payer: r.payer === 'owner' ? 'owner' : 'me', reimb: !!r.reimb });
/* Account rows win, except rows this device has edited and not yet sent; new local rows are kept */
function fMerge(local, rows, from) {
  const ids = new Set(rows.map(r => r.id)), byId = new Map(local.map(x => [x.id, x])), out = [];
  rows.forEach(r => { const cur = byId.get(r.id); out.push(cur && !cur.synced ? cur : from(r)); });
  local.forEach(x => { if (!ids.has(x.id) && !x.synced) out.push(x); });
  return out;
}
async function fPhotoUp(key, item, uid) {
  if (item.photoPath) return;
  const blob = await MediaDB.get(key).catch(() => null); if (!blob) { item.photo = false; return; }
  const path = `${uid}/fuel/${key}.jpg`;
  const { error } = await fMedia().upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  item.photoPath = path;
}
async function fPhotoDown(key, path) {
  if (await MediaDB.get(key).catch(() => null)) return;
  const { data, error } = await fMedia().download(path); if (error || !data) return;
  await MediaDB.put(key, data); fForget(key);
}
/* A new account on this device: keep only what was never sent to the previous account */
function fOwnerCheck(uid) {
  const prev = localStorage.getItem(OWNER_KEY);
  if (prev && prev !== uid) {
    const syncedVeh = fVehicles.filter(v => v.synced).map(v => v.id);
    fVehicles = fVehicles.filter(v => !v.synced);
    fLogs = fLogs.filter(l => !l.synced && !syncedVeh.includes(l.vid));
    fBrands = fBrands.filter(b => !fFavSynced.includes('brand:' + brandKey(b)));
    fStations = fStations.filter(s => !fFavSynced.includes(s.id));
    fFavSynced = []; store(FAVSYNC_KEY, fFavSynced);
    fSave(); fStationsSave(); fBrandsSave();
  }
  localStorage.setItem(OWNER_KEY, uid);
}
const FAVSYNC_KEY = 'kayaos.v4.favSynced';
async function fuelSync() {
  if (!fSignedIn() || fSyncing) return;
  fSyncing = true; renderAccountLine();
  try {
    const uid = currentUser.id;
    if (localStorage.getItem(OWNER_KEY) !== uid) fOwnerCheck(uid);
    /* 1. Pull what the account has */
    const [rv, rl, rf] = await Promise.all([sb.from(FX.veh).select('*'), sb.from(FX.log).select('*'), sb.from(FX.fav).select('*')]);
    const bad = rv.error || rl.error || rf.error; if (bad) throw bad;
    fVehicles = fMerge(fVehicles, rv.data || [], vehFrom);
    fLogs = fMerge(fLogs, rl.data || [], logFrom);
    const R = new Set((rf.data || []).map(r => r.id));
    const gone = fFavSynced.filter(id => !R.has(id));
    fBrands = fBrands.filter(b => !gone.includes('brand:' + brandKey(b)));
    fStations = fStations.filter(s => !gone.includes(s.id));
    (rf.data || []).forEach(r => {
      if (r.kind === 'brand') { if (!isFavBrand(r.name)) fBrands.push(r.name); }
      else if (!fStations.some(s => s.id === r.id)) fStations.push({ id: r.id, name: r.name, lat: +r.lat, lng: +r.lng, osm: r.osm_id || undefined });
    });
    /* 2. Send this device's new and changed rows (photos first, so their paths are saved with the rows) */
    for (const v of fVehicles) if (v.photo && !v.photoPath) await fPhotoUp(vKey(v.id), v, uid);
    for (const l of fLogs) if (l.photo && !l.photoPath) await fPhotoUp(fPhotoKey(l.id), l, uid);
    const pv = fVehicles.filter(v => !v.synced), pl = fLogs.filter(l => !l.synced);
    if (pv.length) { const { error } = await sb.from(FX.veh).upsert(pv.map(v => vehRow(v, uid))); if (error) throw error; pv.forEach(v => { v.synced = true; }); }
    if (pl.length) {
      let { error } = await sb.from(FX.log).upsert(pl.map(l => logRow(l, uid)));
      let waitForColumns = false;
      /* Database not yet updated with the payer/reimb columns: save everything else now, and keep owner-paid and reimbursed rows unsent until it is */
      if (error && /payer|reimb/i.test(error.message || '')) {
        waitForColumns = true;
        ({ error } = await sb.from(FX.log).upsert(pl.map(l => { const { payer, reimb, ...rest } = logRow(l, uid); return rest; })));
      }
      if (error) throw error;
      pl.forEach(l => { l.synced = !(waitForColumns && (l.payer === 'owner' || l.reimb)); });
    }
    const favs = [
      ...fBrands.map(b => ({ id: 'brand:' + brandKey(b), user_id: uid, kind: 'brand', name: b, lat: null, lng: null, osm_id: null })),
      ...fStations.map(s => ({ id: s.id, user_id: uid, kind: 'place', name: s.name, lat: s.lat, lng: s.lng, osm_id: s.osm || null }))
    ];
    const newFavs = favs.filter(x => !R.has(x.id));
    if (newFavs.length) { const { error } = await sb.from(FX.fav).upsert(newFavs); if (error) throw error; }
    fFavSynced = favs.map(x => x.id); store(FAVSYNC_KEY, fFavSynced);
    /* 3. Photos this device doesn't have yet */
    for (const v of fVehicles) if (v.photoPath) await fPhotoDown(vKey(v.id), v.photoPath);
    for (const l of fLogs) if (l.photoPath) await fPhotoDown(fPhotoKey(l.id), l.photoPath);
    fSave(); fStationsSave(); fBrandsSave();
    if (localStorage.getItem(ALERTS_KEY) === '1') startWatch();
  } catch (e) {
    toast('Fuel sync: ' + (e.message || 'could not reach your account'));
  }
  fSyncing = false;
  renderFuel();
}
function renderAccountLine() { const el = document.getElementById('fuelAccount'); if (el) el.outerHTML = fAccountHTML(); }
/* Sign-in card when signed out; sync status when signed in. Hidden when cloud accounts are off. */
function fAccountHTML() {
  if (!sb) return '';
  if (currentUser) return `<p id="fuelAccount" class="sub" style="margin:0 0 10px">☁️ Fuel syncs to ${esc(currentUser.email)}${fSyncing ? ' · syncing…' : ''}</p>`;
  return ''; /* signed out: the header's Sign in button covers the whole app */
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) fuelSync(); });

/* ---------- Community prices (shared with Roadesy and Bloop through the price hub; signed-in reports also keep a sign photo) and the map ---------- */
const curType = () => fFind.type === 'ev' ? 'Electric' : fFind.type === 'diesel' ? 'Diesel' : fFind.type === 'e85' ? 'E85' : fFind.grade;
const ago = iso => { const m = (Date.now() - new Date(iso)) / 6e4; return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const filterFrom = s => fFilterCenter ? fuelDist(fFilterCenter, s) : dFrom(s);
const visibleResults = () => { const q = brandKey(fFind.q), max = fRadiusMi * 1609.34; return fResults.filter(s => (!q || brandKey([s.name, s.place, s.addr, s.city].join(' ')).includes(q)) && (filterFrom(s) == null || filterFrom(s) <= max)); };
/* Latest report per station and fuel type, from the last 7 days, inside the searched area */
function localPrices() {
  const raw = load(LPRICE_KEY, {}), cutoff = Date.now() - 7 * 864e5, out = {};
  for (const [sid, types] of Object.entries(raw)) for (const [t, r] of Object.entries(types)) if (Date.parse(r.at) >= cutoff) (out[sid] ||= {})[t] = r;
  return out;
}
/* ---------- Shared price hub (Roadesy) ----------
   Gas, diesel, E85 and EV prices are shared with Roadesy and Bloop through roadesy.com/api/prices.php, so a price reported
   in any of the apps shows in all of them. Stations are matched by their OpenStreetMap id (node/123 here, n123 at the hub).
   Override the address in config.user.js with window.KAYAOS_PRICE_HUB = '...'; set it to '' to turn sharing off. */
const PRICE_HUB = window.KAYAOS_PRICE_HUB ?? 'https://roadesy.com/api/prices.php';
const HUB_K = { Regular: 'reg', 'Mid-grade': 'mid', Premium: 'prem', Diesel: 'dsl', E85: 'e85', Electric: 'ev' };
const HUB_T = Object.fromEntries(Object.entries(HUB_K).map(([t, k]) => [k, t]));
const hubId = id => { const m = /^(node|way|relation)\/(\d+)$/.exec(String(id)); return m ? m[1][0] + m[2] : null; };
async function hubPost(a, body, ms = 9000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${PRICE_HUB}?a=${a}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Price hub error ${r.status}`);
    return j;
  } finally { clearTimeout(t); }
}
/* Prices from the hub for these stations: station id -> fuel type -> { price, at } (hub reports are kept 3 days) */
async function hubGet(list) {
  if (!PRICE_HUB || !navigator.onLine) return null;
  const items = list.map(s => ({ id: hubId(s.id), lat: s.lat, lon: s.lng, sid: s.id })).filter(x => x.id).slice(0, 400);
  if (!items.length) return null;
  try {
    const j = await hubPost('get', { items: items.map(({ id, lat, lon }) => ({ id, lat, lon })) });
    const out = {}, prices = j.prices || {};
    for (const it of items) {
      const p = prices[it.id]; if (!p) continue;
      const grades = { ...(p.g || {}) }; if (p.ev) grades.ev = p.ev;
      for (const [k, e] of Object.entries(grades)) if (HUB_T[k] && e && e.price) (out[it.sid] ||= {})[HUB_T[k]] = { price: +e.price, at: new Date(e.at * 1000).toISOString() };
    }
    return out;
  } catch { return null; }
}
/* Newest price wins, whichever app it came from */
function mergePrices(extra) {
  for (const [sid, types] of Object.entries(extra || {})) for (const [t, r] of Object.entries(types)) {
    const cur = fPrices[sid]?.[t]; if (!cur || Date.parse(r.at) > Date.parse(cur.at)) (fPrices[sid] ||= {})[t] = r;
  }
}
async function loadPrices(list) {
  if (!list.length) return;
  const hubP = hubGet(list);
  await loadOwnPrices(list);
  const hub = await hubP;
  if (hub && Object.keys(hub).length) { mergePrices(hub); renderResults(); }
}
async function loadOwnPrices(list) {
  const local = localPrices();
  if (!sb) { fPrices = local; renderResults(); return; }
  const lats = list.map(s => s.lat), lngs = list.map(s => s.lng), since = new Date(Date.now() - 7 * 864e5).toISOString();
  let { data, error } = await sb.from('fuel_prices').select('station_key,fuel_type,price,reported_at,photo_path')
    .gte('lat', Math.min(...lats)).lte('lat', Math.max(...lats)).gte('lng', Math.min(...lngs)).lte('lng', Math.max(...lngs))
    .gte('reported_at', since).order('reported_at', { ascending: false }).limit(2000);
  if (error) { // photo_path column not added yet: load the prices without photos
    ({ data, error } = await sb.from('fuel_prices').select('station_key,fuel_type,price,reported_at')
      .gte('lat', Math.min(...lats)).lte('lat', Math.max(...lats)).gte('lng', Math.min(...lngs)).lte('lng', Math.max(...lngs))
      .gte('reported_at', since).order('reported_at', { ascending: false }).limit(2000));
  }
  if (error) { fPrices = local; renderResults(); return; }
  fPrices = {}; fPhotos = {};
  (data || []).forEach(r => { const o = fPrices[r.station_key] || (fPrices[r.station_key] = {}); if (!o[r.fuel_type]) o[r.fuel_type] = { price: +r.price, at: r.reported_at }; if (r.photo_path && !fPhotos[r.station_key]) fPhotos[r.station_key] = r.photo_path; });
  for (const [sid, types] of Object.entries(local)) for (const [t, r] of Object.entries(types)) { const cur = fPrices[sid]?.[t]; if (!cur || Date.parse(r.at) > Date.parse(cur.at)) (fPrices[sid] ||= {})[t] = r; }
  renderResults();
}
/* Prices refresh every two minutes while the Fuel page is open */
setInterval(() => { if (view === 'fuel' && !document.hidden && fResults.length) loadPrices(fResults); }, 120000);

/* Report dialog: every fuel the station sells, one box each. Signing in happens here, not in Settings. */
const PRICE_TYPES = ['Regular', 'Mid-grade', 'Premium', 'Diesel', 'E85'];
let pendingPricePhoto = null; // photo taken in the price form, sent with the next report
let fPhotos = {}; // station id -> path of the newest shared price-sign photo
function ensurePriceDialog() {
  if ($('#priceDialog')) return;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="priceDialog"><form class="dialogIn form" id="priceForm" method="dialog">
    <div class="dialogHead"><h2 id="priceTitle">Report prices</h2><button type="button" class="iconbtn" data-close aria-label="Close">×</button></div>
    <p class="sub">Type the prices you see. Leave any fuel you don't know blank.</p>
    <div id="priceFields"></div>
    <div class="pricePhoto"><div class="pricePhotoBtns"><button type="button" class="pill" id="pricePhotoBtn">📷 Take photo</button><button type="button" class="pill" id="pricePhotoPick">🖼 Choose photo</button><button type="button" class="pill" id="priceRecBtn">🧾 Read a receipt</button></div>
      <input type="file" id="pricePhotoIn" accept="image/*" hidden><input type="file" id="priceRecIn" accept="image/*" hidden><img id="pricePhotoPrev" alt="" hidden></div>
    <div id="priceAuth"></div>
    <div class="clearList"><button class="primary" type="submit">✓ Send prices</button></div>
  </form></dialog>`);
  $('#priceForm').addEventListener('submit', submitPrices);
  /* Receipt: the price paid per gallon for the fuel on it replaces the value shown here (a receipt is a confirmed price) */
  $('#priceRecBtn').addEventListener('click', () => $('#priceRecIn').click());
  $('#priceRecIn').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const btn = $('#priceRecBtn'); btn.disabled = true; btn.textContent = '🧾 Reading receipt…';
    try { await readReceiptPrice(file); }
    catch (err) { toast('Could not read the receipt. Type the price in.'); }
    finally { btn.disabled = false; btn.textContent = '🧾 Read a receipt'; }
  });
  /* Two buttons: one opens the camera, the other opens the photo library, so both always work */
  $('#pricePhotoBtn').addEventListener('click', () => { const i = $('#pricePhotoIn'); i.setAttribute('capture', 'environment'); i.click(); });
  $('#pricePhotoPick').addEventListener('click', () => { const i = $('#pricePhotoIn'); i.removeAttribute('capture'); i.click(); });
  $('#pricePhotoIn').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      pendingPricePhoto = await compressImage(file, 1200, 0.8);
      const prev = $('#pricePhotoPrev'); prev.src = URL.createObjectURL(pendingPricePhoto); prev.hidden = false;
      const btn = $('#pricePhotoBtn'); btn.textContent = '📷 Reading prices…'; btn.disabled = true;
      try {
        const found = await readPricesFromPhoto(pendingPricePhoto);
        let n = 0;
        if (found) for (const [k, t] of Object.entries(GRADE_FIELD)) { const inp = $(`#priceFields input[name="${t}"]`); if (inp && found[k] && !inp.value) { inp.value = found[k].toFixed(3); n++; } }
        toast(n ? `Read ${n} price${n === 1 ? '' : 's'} from the photo. Check them, then send.` : 'Could not read prices from this photo. Type them in.');
      } catch (err) { toast('Could not read the photo. Type the prices in.'); }
      finally { btn.disabled = false; btn.textContent = '📷 Photo added · tap to retake'; }
    } catch (err) { toast('That photo could not be read'); }
  });
  $('#priceDialog').addEventListener('click', e => { if (e.target.id === 'priceIn') priceAuth('in'); if (e.target.id === 'priceUp') priceAuth('up'); });
}
function reportPrice(id) {
  const s = fResults.find(x => x.id === id); if (!s) return;
  ensurePriceDialog();
  const types = s.kind === 'ev' ? ['Electric'] : PRICE_TYPES, cur = fPrices[s.id] || {};
  $('#priceTitle').textContent = s.name;
  $('#priceFields').innerHTML = types.map(t => `<label class="lbl">${esc(t === 'Electric' ? 'Price per kWh' : `${t} per gallon`)}${cur[t] ? ` <span class="sub">· now ${fPer(cur[t].price, fUnitOf(t))}</span>` : ''}
      <input name="${esc(t)}" type="number" inputmode="decimal" step="0.001" min="0.5" max="49.999" placeholder="e.g. 3.459"></label>`).join('');
  $('#priceAuth').innerHTML = '';
  pendingPricePhoto = null; $('#pricePhotoBtn').textContent = '📷 Take photo';
  $('#pricePhotoPrev').hidden = true; $('#pricePhotoIn').value = '';
  $('#priceDialog').dataset.id = id;
  if (!$('#priceDialog').open) $('#priceDialog').showModal();
}
/* Opens the newest shared price-sign photo for a station (private bucket, so it is downloaded with the signed-in account) */
/* Sends the sign photo to the price reader (Supabase edge function, signed-in users only) and returns { regular, midGrade, ... } */
async function readPricesFromPhoto(blob) {
  if (!sb || !fSignedIn()) return null;
  const { data } = await sb.auth.getSession(); const token = data && data.session && data.session.access_token;
  if (!token) return null;
  const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  const r = await fetch(`${SUPABASE_URL}/functions/v1/read-price-sign`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image: b64 }) });
  if (!r.ok) throw new Error('price reader');
  return r.json();
}
/* Reads a receipt and sets that fuel type's price in the Report prices form */
async function readReceiptPrice(file) {
  if (!sb || !fSignedIn()) { toast('Sign in first (Settings → Account)'); return; }
  const { data } = await sb.auth.getSession(); const token = data && data.session && data.session.access_token;
  if (!token) { toast('Sign in first (Settings → Account)'); return; }
  const blob = await compressImage(file, 1600, 0.85);
  const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  const r = await fetch(`${SUPABASE_URL}/functions/v1/read-receipt`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image: b64 }) });
  if (!r.ok) throw new Error('receipt');
  const j = await r.json();
  const grade = j.fuelTypeMatched, t = GRADE_FIELD[grade];
  const ppg = +j.pricePerGallon || (+j.totalPaid > 0 && +j.gallons > 0 ? +j.totalPaid / +j.gallons : 0);
  if (!t || !(ppg > 0)) { toast('Could not tell the fuel type or price. Type it in.'); return; }
  const inp = $(`#priceFields input[name="${t}"]`);
  if (!inp) { toast(`This station's form has no ${t} field. Check the fuel type.`); return; }
  inp.value = ppg.toFixed(3);
  toast(`Set ${t} to $${ppg.toFixed(3)} from the receipt. Check it, then send.`);
}
/* Reads a fuel receipt with the receipt reader and fills only the empty fill-up boxes */
async function fillFromReceipt(file) {
  if (!sb || !fSignedIn()) return;
  const f = $('#fuelForm'); const note = $('#fuelReceiptNote');
  if (note) note.textContent = 'Reading the receipt…';
  try {
    const { data } = await sb.auth.getSession(); const token = data && data.session && data.session.access_token;
    if (!token) return;
    const blob = await compressImage(file, 1600, 0.85);
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    const r = await fetch(`${SUPABASE_URL}/functions/v1/read-receipt`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image: b64 }) });
    if (!r.ok) throw new Error(await r.text().catch(() => 'receipt'));
    const got = await r.json();
    let n = 0;
    if (got.date && !f.date.value) { f.date.value = got.date; n++; }
    if (got.gallons != null && !f.gal.value) { f.gal.value = got.gallons; n++; }
    if (got.totalPaid != null && !f.total.value) { f.total.value = got.totalPaid.toFixed(2); n++; }
    if (got.pricePerGallon != null && !f.ppg.value) { f.ppg.value = got.pricePerGallon.toFixed(3); n++; }
    updateFuelHint && updateFuelHint();
    if (note) note.textContent = n ? `Filled ${n} field${n === 1 ? '' : 's'} from the receipt. Check them before saving.` : 'Could not read the receipt. Type the numbers in.';
  } catch (err) {
    if (note) note.textContent = 'Could not read the receipt. Type the numbers in.';
  }
}
const GRADE_FIELD = { regular: 'Regular', midGrade: 'Mid-grade', premium: 'Premium', diesel: 'Diesel', e85: 'E85' };
async function showPricePhoto(id) {
  const path = fPhotos[id]; if (!path || !sb) return;
  const { data, error } = await fMedia().download(path);
  if (error || !data) { toast('Photo could not be opened'); return; }
  const url = URL.createObjectURL(data); window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function priceAuth(mode) {
  const email = $('#priceEmail').value.trim(), password = $('#pricePass').value;
  if (!email || !password) { toast('Email and password required'); return; }
  const res = mode === 'up' ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  if (res.error) { toast(res.error.message); return; }
  if (mode === 'up' && !res.data.session) { toast('Check your email to confirm, then sign in'); return; }
  currentUser = res.data.user || res.data.session?.user || currentUser;
  $('#priceAuth').innerHTML = ''; toast('Signed in — now send your prices');
}
async function submitPrices(e) {
  e.preventDefault();
  const s = fResults.find(x => x.id === $('#priceDialog').dataset.id); if (!s) return;
  const rows = [];
  for (const inp of $$('#priceFields input')) {
    if (!inp.value.trim()) continue;
    const v = parseFloat(inp.value.replace(/[$,\s]/g, ''));
    if (!(v > 0 && v < 50)) { toast(`Check the ${inp.name} price`); return; }
    rows.push({ station_key: s.id, station_name: s.name, lat: s.lat, lng: s.lng, fuel_type: inp.name, price: Math.round(v * 1000) / 1000 });
  }
  if (!rows.length) { toast('Enter at least one price'); return; }
  const now = new Date().toISOString();
  /* The photo is uploaded to the private bucket (in the user's own folder, under "prices") and shared with the price row.
     If it can't be uploaded, the prices still go through and the photo stays on this phone. */
  let photoPath = null;
  if (pendingPricePhoto) {
    if (sb && fSignedIn()) {
      const path = `${currentUser.id}/prices/${Date.now()}-${String(s.id).replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.jpg`;
      const { error } = await fMedia().upload(path, pendingPricePhoto, { contentType: 'image/jpeg', upsert: false });
      if (!error) photoPath = path; else toast('Photo not uploaded (' + error.message + '). Prices still sent');
    }
    if (!photoPath) MediaDB.put(`price-photo:${s.id}:${Date.now()}`, pendingPricePhoto).catch(() => {});
    pendingPricePhoto = null;
  }
  const local = load(LPRICE_KEY, {}), lo = local[s.id] || (local[s.id] = {});
  rows.forEach(r => { lo[r.fuel_type] = { price: r.price, at: now }; });
  store(LPRICE_KEY, local);
  const o = fPrices[s.id] || (fPrices[s.id] = {});
  rows.forEach(r => { o[r.fuel_type] = { price: r.price, at: now }; });
  /* Shared hub (Roadesy, Bloop): no sign-in needed. It checks each price against others nearby and may refuse a likely typo. */
  let hubOk = 0, hubErr = '';
  const hid = hubId(s.id);
  if (PRICE_HUB && hid && navigator.onLine) {
    const res = await Promise.allSettled(rows.filter(r => HUB_K[r.fuel_type]).map(r =>
      hubPost('report', { id: hid, lat: s.lat, lon: s.lng, name: s.name, k: HUB_K[r.fuel_type], price: r.price, app: 'kayaos' })));
    res.forEach(x => { if (x.status === 'fulfilled') hubOk++; else if (!hubErr) hubErr = x.reason?.message || 'network error'; });
  }
  let note = '';
  if (sb && fSignedIn()) {
    let { error } = await sb.from('fuel_prices').insert(rows.map(r => ({ ...r, user_id: currentUser.id, photo_path: photoPath })));
    if (error && photoPath) { // the photo column may not exist yet: share the prices without the photo
      ({ error } = await sb.from('fuel_prices').insert(rows.map(r => ({ ...r, user_id: currentUser.id }))));
      if (!error) note = ' The photo was not saved: the fuel_prices photo_path column is missing.';
    }
    if (error && !hubOk) { toast('Saved on this phone. Could not share it: ' + (hubErr || error.message)); $('#priceDialog').close(); renderResults(); return; }
    if (!error) hubOk = Math.max(hubOk, rows.length);
  }
  if (hubOk) toast(`Thanks, ${hubOk} price${hubOk === 1 ? '' : 's'} shared with everyone` + (hubErr && hubOk < rows.length ? `. Not shared: ${hubErr}` : '') + note);
  else toast('Saved on this phone. ' + (hubErr ? 'Could not share it: ' + hubErr : 'Sign in from the header to share it.'));
  $('#priceDialog').close(); renderResults();
}
/* Brand pins: the brand's name on its colours, our own approximation of each brand's colours (not logo artwork).
   Stations we don't know get the plain pin. */
const BRANDS = [
  ['shell', 'Shell', '#fbce07', '#dd1d21'], ['bp', 'BP', '#00a651', '#ffffff'], ['chevron', 'Chevron', '#0054a6', '#ffffff'],
  ['exxon', 'Exxon', '#ed1c24', '#ffffff'], ['mobil', 'Mobil', '#ed1c24', '#ffffff'], ['costco', 'Costco', '#e31837', '#ffffff'],
  ['wawa', 'Wawa', '#c8102e', '#ffffff'], ['sheetz', 'Sheetz', '#c8102e', '#ffffff'], ['speedway', 'Speedway', '#e4002b', '#ffffff'],
  ['circlek', 'Circle K', '#e2231a', '#ffffff'], ['murphy', 'Murphy', '#0c3e7c', '#ffffff'], ['kroger', 'Kroger', '#0060a9', '#ffffff'],
  ['walmart', 'Walmart', '#0071ce', '#ffffff'], ['sams', 'Sam’s', '#0060a9', '#ffffff'], ['marathon', 'Marathon', '#e3282a', '#ffffff'],
  ['publix', 'Publix', '#3a7d44', '#ffffff'], ['aldi', 'Aldi', '#00005f', '#ffffff'], ['winndixie', 'Winn-Dixie', '#e31837', '#ffffff'], ['wholefoods', 'Whole Foods', '#00674b', '#ffffff'], ['traderjoe', 'Trader Joe’s', '#c8102e', '#ffffff']
];
function brandOf(name) {
  const k = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  const hit = BRANDS.find(([key]) => k.includes(key));
  return hit ? { label: hit[1], bg: hit[2], fg: hit[3] } : null;
}
/* One icon per kind: ⛽ fuel, ⚡ charging, 🚛 truck stop, 🅿️ rest area or service */
const kindIcon = k => ({ ev: '⚡', truck: '🚛', rest: '🅿️', grocery: '🛒', food: '🍽️', lodging: '🏨', place: '📍' })[k] || '⛽';
/* Kinds that have no fuel price */
const NOPRICE = ['grocery', 'food', 'lodging'];
/* Moving the map loads the stations in the new area (one request per area, cached like a search) */
/* The circle the map is showing: centre and radius in metres (capped) */
function viewArea() {
  const c = fMap.getCenter(), b = fMap.getBounds(), here = { latitude: c.lat, longitude: c.lng };
  return { here, r: Math.min(25000, Math.max(1000, Math.round(fuelDist(here, { lat: b.getNorth(), lng: b.getEast() })))) };
}
const areaCovered = (here, r) => fCover.some(v => fuelDist(here, v) + r <= v.r);
/* Shows "Search this area" only when the map shows stations we have not loaded yet */
function updateSearchBtn() {
  const btn = document.getElementById('fuelSearchArea'); if (!btn) return;
  let show = false;
  if (fMap && fCover.length && !fMapBusy) { const { here, r } = viewArea(); show = !areaCovered(here, r); }
  btn.hidden = !show;
}
async function loadMapArea(force) {
  if (!fMap || !fCover.length) return;
  if (fMapBusy) { fMapPending = true; return; }
  const { here, r } = viewArea();
  if (!force && areaCovered(here, r)) { updateSearchBtn(); return; }
  if (force) fFilterCenter = here;
  const note = document.getElementById('fuelMapNote'); fMapBusy = true;
  if (note) note.textContent = 'Loading stations in this area…';
  try {
    const items = await stationsAround(here, r);
    fCover.push({ latitude: here.latitude, longitude: here.longitude, r });
    const have = new Set(fResults.map(s => s.id));
    items.forEach(s => { if (!have.has(s.id)) { have.add(s.id); fResults.push({ ...s, dist: fuelDist(here, s) }); } });
    renderResults();
    await loadPrices(fResults);
    if (note) note.textContent = `${visibleResults().length} stations on the map · move the map to load more`;
  } catch (e) { if (note) note.textContent = e.message || 'Could not load this area.'; }
  fMapBusy = false; updateSearchBtn();
  if (fMapPending) { fMapPending = false; loadMapArea(); }
}
/* Map: a pin per station with its price for the selected fuel (⛽ fuel, ⚡ charging). Cheapest in green. */
function updateMap() {
  const list = visibleResults(); syncMapUI(list.concat(placeList()));
  const wrap = document.getElementById('fuelMapWrap'); if (!wrap || typeof L === 'undefined') return;
  if (!fMap) {
    /* The map always appears on Around me: on your location, or the US until a location or result is known */
    const first = list[0] || placeList()[0]?.c || (fPos ? { lat: fPos.latitude, lng: fPos.longitude } : { lat: 39.5, lng: -98.35 });
    const zoom = (list.length || placeList().length || fPos) ? 13 : 4;
    fMap = L.map('fuelMap', { scrollWheelZoom: false }).setView([first.lat, first.lng], zoom);
    fTiles = { street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }), sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }) };
    fTiles[fView].addTo(fMap); viewLabel();
    fMapLayer = L.layerGroup().addTo(fMap);
    wrap.insertAdjacentHTML('beforeend', '<p class="sub" id="fuelMapNote" style="margin:6px 0 0"></p>');
    fMap.on('moveend', () => { clearTimeout(fPanTimer); fPanTimer = setTimeout(() => loadMapArea(), 700); });
    if (!fPos && !fLocAsked) { fLocAsked = true; getHere().then(g => { fPos = g; fFilterCenter = null; if (fMap) fMap.setView([g.latitude, g.longitude], 13); renderResults(); }).catch(() => {}); }
  }
  const cur = curType();
  const prices = list.map(s => fPrices[s.id]?.[cur]?.price).filter(Boolean), min = prices.length ? Math.min(...prices) : null;
  fMapLayer.clearLayers();
  if (fPos && typeof L.circleMarker === 'function') L.circleMarker([fPos.latitude, fPos.longitude], { radius: 7, color: '#1a73e8', weight: 3, fillColor: '#4da3ff', fillOpacity: 1 }).addTo(fMapLayer);
  const pts = [];
  list.forEach(s => {
    const p = fPrices[s.id]?.[cur], cheap = !!p && p.price === min, fav = favPlace(s);
    const bd = (s.kind === 'fuel' || NOPRICE.includes(s.kind)) /*BRAND*/ ? brandOf(s.name) : null, bdStyle = bd ? `style="background:${bd.bg};color:${bd.fg};border-color:${bd.bg}"` : '';
    const icon = s.kind === 'fuel' ? L.divIcon({ className: 'pinWrap', html: fuelPinHTML(s, p, cheap, bd), iconSize: null }) : L.divIcon({ className: 'pinWrap', html: `<div class="pricePin${cheap ? ' cheap' : ''}${p || NOPRICE.includes(s.kind) ? '' : ' none'}${bd ? ' brand' : ''}" ${bd ? bdStyle : kindStyle(s)}>${bd ? `<b>${esc(bd.label)}</b>` : kindIcon(s.kind)}${NOPRICE.includes(s.kind) && !bd ? ' ' + esc(String(s.name).slice(0, 14)) : ''}${NOPRICE.includes(s.kind) ? '' : ' ' + (p ? '$' + p.price.toFixed(3) : '—')}</div>`, iconSize: null });
    const html = `<div style="min-width:180px"><strong>${kindIcon(s.kind)} ${esc(s.name)}</strong><br><span class="sub">${esc([s.addr, s.city].filter(Boolean).join(', ') || 'Address not listed')}</span><br>
      <span class="sub">${esc(distTxt(s))}</span><div class="priceBlock">${priceLine(s)}</div>
      <div class="pills brandPills" style="margin-top:6px;${pillVars(s)}">${rewardLink(s.name)}<a class="pill" href="${dirHref(s)}" target="_blank" rel="noopener">🧭 Directions</a><button class="pill" data-fu="report" data-id="${esc(s.id)}">💲 Report prices</button>${fPhotos[s.id] ? `<button class="pill" data-fu="pricePhoto" data-id="${esc(s.id)}">📷 Price photo</button>` : ''}${s.name.startsWith('Unnamed') ? `<button class="pill" data-fu="nameStation" data-id="${esc(s.id)}">✎ Name it</button>` : ''}${s.id.startsWith('custom/') ? `<button class="pill" data-fu="customDel" data-id="${esc(s.id)}">🗑 Remove</button>` : ''}<button class="pill" data-fu="placeFav" data-id="${esc(s.id)}">${fav ? '★' : '☆'} Station</button></div></div>`;
    L.marker([s.lat, s.lng], { icon }).bindPopup(html).addTo(fMapLayer);
    pts.push([s.lat, s.lng]);
  });
  placeList().forEach(({ t, c }) => { L.marker([c.lat, c.lng], { icon: L.divIcon({ className: 'pinWrap', html: `<div class="pricePin placePin">📍 ${esc(t.title)}</div>`, iconSize: null }) }).bindPopup(`<b>${esc(t.title)}</b><br><span class="sub">${esc(t.place || '')}</span>`).addTo(fMapLayer); pts.push([c.lat, c.lng]); });
  if (fMapFit && pts.length) { fMapFit = false; if (fPos) fMap.setView([fPos.latitude, fPos.longitude], 14); else if (pts.length > 1) fMap.fitBounds(pts, { padding: [28, 28], maxZoom: 14 }); else fMap.setView(pts[0], 14); }
  else if (fMapFit && fPos) { fMapFit = false; fMap.setView([fPos.latitude, fPos.longitude], 13); }
  setTimeout(() => fMap && fMap.invalidateSize(), 0);
}

/* ---------- Distance control, and swipe between full map and list ---------- */
document.addEventListener('input', e => {
  if (e.target.id !== 'fDist') return;
  fRadiusMi = DIST_STEPS[+e.target.value] || 5;
  const v = document.getElementById('fDistVal'); if (v) v.textContent = fRadiusMi + ' mi';
  renderResults();
});
/* Map and list share one drag: the bar between them follows your finger. Down makes the map bigger, up makes the list bigger. */
function fullMapH() { return Math.max(200, innerHeight - 120); }
function syncMapUI(list) {
  const wrap = document.getElementById('fuelMapWrap'), grip = document.getElementById('fuelGrip'), map = document.getElementById('fuelMap');
  if (!wrap || !grip || !map) return;
  updateSearchBtn();
  wrap.hidden = fMapH <= 0;
  map.style.height = fMapH + 'px';
  grip.hidden = !fResults.length;
  grip.textContent = 'Drag to resize · map ↓ · list ↑';
  if (fMap) setTimeout(() => fMap.invalidateSize(), 220);
}
(function initMapGrip() {
  const grip = document.getElementById('fuelGrip'), map = document.getElementById('fuelMap'), wrap = document.getElementById('fuelMapWrap');
  if (!grip || !map || !wrap) return;
  let y0 = null, h0 = 0;
  const move = y => {
    if (y0 == null) return;
    fMapH = Math.max(120, Math.min(fullMapH(), h0 + (y - y0)));
    wrap.hidden = false; map.style.height = fMapH + 'px';
  };
  const end = () => {
    if (y0 == null) return; y0 = null;
    const snaps = [120, 280, fullMapH()];
    fMapH = snaps.reduce((a, c) => Math.abs(c - fMapH) < Math.abs(a - fMapH) ? c : a);
    map.classList.add('snap'); syncMapUI(visibleResults());
    setTimeout(() => map.classList.remove('snap'), 250);
  };
  grip.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; h0 = fMapH; map.classList.remove('snap'); }, { passive: true });
  grip.addEventListener('touchmove', e => move(e.touches[0].clientY), { passive: true });
  grip.addEventListener('touchend', end);
  grip.addEventListener('touchcancel', end);
})();

/* "My location": pans the map to where you are, and makes the distances match */
async function locateMe() {
  try {
    const gps = await getHere();
    fPos = gps; fFilterCenter = null;
    if (!fMap) { toast('Tap Find near me first'); return; }
    fMap.setView([gps.latitude, gps.longitude], 14);
    renderResults();
  } catch (e) { toast(e.message || 'Could not get your location'); }
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#fuelLocate')) locateMe(); });
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#fuelSearchArea')) loadMapArea(true); });

/* Around me layers: tap to switch Fuel, Groceries and Places on or off (any mix) */
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-around]'); if (!b) return;
  const k = b.dataset.around;
  fLayers = fLayers.includes(k) ? fLayers.filter(x => x !== k) : [...fLayers, k];
  if (!fLayers.length) fLayers = [k];
  store('kayaos.v4.around', fLayers);
  if (fCenter || fPos) findNear(); else renderFuel();
});
/* The Places cards list, above the station list */
function placesHTML() {
  const list = placeList(); if (!list.length) return '';
  const rows = list.map(({ t, c }) => { const d = dFrom({ lat: c.lat, lng: c.lng }); return `<div class="wkRow stRow"><div style="min-width:0"><strong>📍 ${esc(t.title)}</strong>
      <span class="sub">${esc(t.place || 'Pinned location')}${d == null ? '' : ' · ' + esc(fmtDist(d))}</span>
      <div class="pills"><a class="pill" href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener">🧭 Directions</a></div></div></div>`; }).join('');
  return `<div class="sectionHead" style="margin:10px 0 6px"><h2 style="font-size:15px">Your places</h2><span class="sub">${list.length}</span></div><div class="card wkList">${rows}</div>`;
}
