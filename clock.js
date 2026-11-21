/* Time and weather strip in the sticky header, on every screen: here, plus saved cities.
   Weather and city search come from Open-Meteo (free, no account or key). Only city coordinates are saved. */
(function () {
  'use strict';
  const K = { places: 'kayaos.v4.places', sel: 'kayaos.v4.clockSel', here: 'kayaos.v4.hereSpot' };
  const $c = s => document.querySelector(s);
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: keep working in memory */ } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WX = [[[0], '☀️', 'Clear'], [[1, 2], '⛅', 'Partly cloudy'], [[3], '☁️', 'Overcast'], [[45, 48], '🌫️', 'Fog'],
    [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Rain'], [[71, 73, 75, 77, 85, 86], '❄️', 'Snow'], [[95, 96, 99], '⛈️', 'Thunderstorm']];
  const wxOf = code => WX.find(w => w[0].includes(code)) || ['', '🌡️', 'Unknown'];

  let places = read(K.places, []);          /* saved cities: { id, name, region, lat, lon, tz } */
  let sel = read(K.sel, 'here');
  let here = read(K.here, null);            /* { lat, lon } rounded to about 100 m */
  let adding = false, searched = false, results = [], query = '', denied = false;
  const cache = {};                         /* place id -> { t, data } */
  let fcOpen = null;                        /* place id whose 7-day forecast is open */
  let fcDay = null;                         /* index of the day whose hours are open (0-13) */
  let fcWeek = 0;                           /* 0 = this week, 1 = next week */
  const fcCache = {};

  const fmtTime = tz => new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, hour: 'numeric', minute: '2-digit' }).format(new Date());
  const all = () => [{ id: 'here', name: 'Here', region: '', lat: here ? here.lat : null, lon: here ? here.lon : null, tz: null }, ...places];

  async function weatherFor(p) {
    const c = cache[p.id]; if (c && Date.now() - c.t < 15 * 60e3) return c.data;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`;
    const r = await fetch(url); if (!r.ok) throw new Error('weather');
    const j = await r.json();
    const data = { t: j.current.temperature_2m, code: j.current.weather_code };
    cache[p.id] = { t: Date.now(), data };
    return data;
  }
  async function forecastFor(p) {
    const c = fcCache[p.id]; if (c && Date.now() - c.t < 60 * 60e3) return c.data;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&hourly=temperature_2m,weather_code,precipitation_probability&temperature_unit=fahrenheit&forecast_days=14&timezone=auto`;
    const r = await fetch(url); if (!r.ok) throw new Error('forecast');
    const j = await r.json();
    const days = j.daily.time.map((d, i) => ({ date: d, code: j.daily.weather_code[i], hi: j.daily.temperature_2m_max[i], lo: j.daily.temperature_2m_min[i] }));
    const hours = j.hourly.time.map((t, i) => ({ t, temp: j.hourly.temperature_2m[i], code: j.hourly.weather_code[i], pp: j.hourly.precipitation_probability[i] }));
    const data = { days, hours };
    fcCache[p.id] = { t: Date.now(), data };
    return data;
  }
  const hourLabel = t => { const h = +t.slice(11, 13); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
  const fmtShortDay = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  function renderForecast() {
    const el = $c('#clockForecast'); if (!el) return;
    const p = fcOpen && all().find(x => x.id === fcOpen);
    if (!p) { el.innerHTML = ''; fcDay = null; fcWeek = 0; return; }
    el.innerHTML = `<div class="clkFc card"><div class="clkFcHead"><strong>${esc(p.name)} · forecast</strong><button class="iconbtn" data-clk="fcClose" aria-label="Close forecast">×</button></div>
      <div class="clkWeekNav"><button class="iconbtn" data-clk="week" data-v="-1" aria-label="Previous week" ${fcWeek === 0 ? 'disabled' : ''}>‹</button><span class="sub" id="clkWeekLbl">Loading…</span><button class="iconbtn" data-clk="week" data-v="1" aria-label="Next week" ${fcWeek >= 1 ? 'disabled' : ''}>›</button></div>
      <div class="clkFcGrid" id="clkFcGrid"><span class="sub">Loading…</span></div></div>`;
    if (p.lat == null || p.lon == null) { $c('#clkFcGrid').innerHTML = '<span class="sub">Allow location to see the forecast here.</span>'; return; }
    forecastFor(p).then(({ days, hours }) => {
      const g = $c('#clkFcGrid'); if (!g) return;
      const start = fcWeek * 7, slice = days.slice(start, start + 7);
      if (!slice.length) { fcWeek = 0; renderForecast(); return; }
      const lbl = $c('#clkWeekLbl'); if (lbl) lbl.textContent = `${fmtShortDay(slice[0].date)} – ${fmtShortDay(slice[slice.length - 1].date)}`;
      g.innerHTML = slice.map((d, j) => {
        const i = start + j, w = wxOf(d.code);
        const name = i === 0 ? 'Today' : new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
        return `<button class="clkFcDay${i === fcDay ? ' on' : ''}" data-clk="day" data-v="${i}" aria-expanded="${i === fcDay}"><span>${esc(name)}</span><span class="clkFcIco" title="${esc(w[2])}">${w[1]}</span><b>${Math.round(d.hi)}°</b><span class="sub">${Math.round(d.lo)}°</span></button>`;
      }).join('');
      if (fcDay != null && fcDay >= start && fcDay < start + 7) {
        const open = days[fcDay];
        const hrs = hours.filter(h => h.t.startsWith(open.date));
        const box = document.createElement('div'); box.className = 'clkHrs';
        box.innerHTML = hrs.map(h => { const w = wxOf(h.code); return `<div class="clkHr"><span>${hourLabel(h.t)}</span><span class="clkFcIco" title="${esc(w[2])}">${w[1]}</span><b>${Math.round(h.temp)}°</b><span class="sub">${Math.round(h.pp || 0)}%</span></div>`; }).join('') || '<span class="sub">No hourly data for this day</span>';
        g.after(box);
      }
    }).catch(() => { const g = $c('#clkFcGrid'); if (g) g.innerHTML = '<span class="sub">Forecast unavailable right now</span>'; });
  }
  async function searchCities(q) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
    if (!r.ok) throw new Error('search');
    const j = await r.json();
    return (j.results || []).map(x => ({ id: 'c' + x.id, name: x.name, region: [x.admin1, x.country_code].filter(Boolean).join(', '), lat: +x.latitude, lon: +x.longitude, tz: x.timezone || null }));
  }
  function locateHere() {
    if (!navigator.geolocation) { denied = !here; render(); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      here = { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) };
      write(K.here, here); denied = false; delete cache.here; render();
    }, () => { denied = !here; render(); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60e3 });
  }
  /* Only the clock times change every 30 s; the rest is redrawn on actions so typing isn't interrupted */
  function updateTimes() { document.querySelectorAll('[data-clk-time]').forEach(el => { el.textContent = fmtTime(el.dataset.tz); }); }
  function loadWeather() {
    all().forEach(p => {
      if (p.lat == null || p.lon == null) return;
      weatherFor(p).then(d => {
        const w = wxOf(d.code);
        document.querySelectorAll(`[data-wx="${CSS.escape(p.id)}"]`).forEach(el => { el.textContent = `${w[1]} ${Math.round(d.t)}°F`; el.title = w[2]; });
      }).catch(() => document.querySelectorAll(`[data-wx="${CSS.escape(p.id)}"]`).forEach(el => { el.textContent = '—'; }));
    });
  }
  function addHTML() {
    return `<div class="clkAdd">
      <div class="clkSearch"><input id="clkQ" type="search" placeholder="Type a city, e.g. Chicago" autocomplete="off" value="${esc(query)}"><button class="pill" data-clk="search">Search</button></div>
      ${searched && !results.length ? '<span class="sub">No matches. Try the city name only.</span>' : ''}
      <div class="clkRes">${results.map(r => `<button data-clk="choose" data-id="${esc(r.id)}"><strong>${esc(r.name)}</strong> <span class="sub">${esc(r.region)}</span></button>`).join('')}</div>
    </div>`;
  }
  function render() {
    const el = $c('#clockCard'); if (!el) return;
    const list = all(), cur = list.find(p => p.id === sel) || list[0];
    el.innerHTML = `<div class="clkStrip">
      <div class="clkRow">${list.map(p => {
        const isHere = p.id === 'here';
        const wx = isHere && denied && !here ? '<button class="clkLoc" data-clk="locate">📍 Allow location</button>' : `<span class="clkWx" data-wx="${esc(p.id)}">…</span>`;
        return `<button class="clkPlace${p.id === cur.id ? ' on' : ''}" data-clk="pick" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong>${isHere ? '' : ` <span class="clkT" data-clk-time data-tz="${esc(p.tz || '')}"></span>`} ${wx}</button>`;
      }).join('')}
        ${cur.id !== 'here' ? `<button class="clkPlace clkRm" data-clk="remove" data-id="${esc(cur.id)}">Remove ${esc(cur.name)}</button>` : ''}
        <button class="clkPlace clkAddBtn" data-clk="add">${adding ? 'Close' : '＋ City'}</button>
      </div>
      ${adding ? addHTML() : ''}
    </div>`;
    updateTimes(); loadWeather(); renderForecast();
    const q = $c('#clkQ'); if (q) q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  }
  async function doSearch() {
    const q = ($c('#clkQ') ? $c('#clkQ').value : query).trim(); query = q; if (!q) return;
    try { results = await searchCities(q); } catch (e) { results = []; }
    searched = true; render();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-clk]'); if (!b) return;
    if (!(($c('#clockCard') && $c('#clockCard').contains(b)) || ($c('#clockForecast') && $c('#clockForecast').contains(b)))) return;
    const k = b.dataset.clk;
    if (k === 'pick') { const id = b.dataset.id; sel = id; write(K.sel, sel); fcOpen = fcOpen === id ? null : id; fcDay = null; fcWeek = 0; render(); }
    else if (k === 'fcClose') { fcOpen = null; fcDay = null; renderForecast(); }
    else if (k === 'day') { const i = +b.dataset.v; fcDay = fcDay === i ? null : i; renderForecast(); }
    else if (k === 'week') { fcWeek = Math.max(0, Math.min(1, fcWeek + (+b.dataset.v))); fcDay = null; renderForecast(); }
    else if (k === 'add') { adding = !adding; if (!adding) { results = []; searched = false; query = ''; } render(); }
    else if (k === 'search') doSearch();
    else if (k === 'choose') {
      const r = results.find(x => x.id === b.dataset.id); if (!r) return;
      if (!places.some(p => p.id === r.id)) places.push(r);
      write(K.places, places); sel = r.id; write(K.sel, sel);
      adding = false; results = []; searched = false; query = ''; render();
    }
    else if (k === 'remove') { places = places.filter(p => p.id !== b.dataset.id); write(K.places, places); sel = 'here'; write(K.sel, sel); render(); }
    else if (k === 'locate') locateHere();
  });

  let touchX = null;
  function onTouchStart(e) { touchX = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchX == null || !fcOpen) { touchX = null; return; }
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) < 50) return;
    const next = dx < 0 ? 1 : -1;
    const want = Math.max(0, Math.min(1, fcWeek + next));
    if (want !== fcWeek) { fcWeek = want; fcDay = null; renderForecast(); }
  }
  function start() {
    render(); locateHere(); setInterval(updateTimes, 30 * 1000);
    const fe = $c('#clockForecast');
    if (fe) { fe.addEventListener('touchstart', onTouchStart, { passive: true }); fe.addEventListener('touchend', onTouchEnd, { passive: true }); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
