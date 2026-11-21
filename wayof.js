/* Kayaos.space × WAYOF Health (thewayof.health)
   Adds "WAYOF Health" to the More menu:
   - WAYOF's daily health summary (steps, water, sleep, workouts) and the sleep plan WAYOF builds from your Work shifts
   - WAYOF reminders and appointments → one tap to add them as Kayaos cards (normal chime / voice alerts)
   - "Send my schedule to WAYOF": only needed when the two apps don't share an account.
     On the same Supabase project + same login, WAYOF reads Work shifts and Health/Appointments cards on its own.
   Data sources, in order: Supabase table health_summaries (same project, owner-only RLS) → the last
   #health-import= snapshot link saved on this device.
   Uses Kayaos globals from script.js / work.js: $, esc, toast, sb, currentUser, tasks, wShifts, wJobs, openAdd, openMore. */
(function () {
  'use strict';
  const WAYOF = 'https://thewayof.health/';
  const LS = 'kayaos-wayof-health';
  const g = name => { try { return window.eval(name); } catch (e) { return undefined; } }; // reads script-level let bindings (sb, currentUser, tasks…)
  const pad = n => String(n).padStart(2, '0'), ymdL = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = m => (typeof toast === 'function' ? toast(m) : alert(m));
  const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  const unb64 = s => JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(s)))));
  const fmtT = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const fmtD = s => { const d = new Date(s + 'T12:00'); return isNaN(d) ? s : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
  let summary = null, source = '';

  /* ---- snapshot link from WAYOF: https://kayaos.space/#health-import=<base64 JSON> ---- */
  function fromHash() {
    const m = location.hash.match(/health-import=([^&]+)/); if (!m) return;
    try {
      const s = unb64(m[1]); if (s.schema !== 'wayof.health.v1') throw new Error('not a WAYOF summary');
      localStorage.setItem(LS, JSON.stringify(s)); history.replaceState(null, '', location.pathname);
      setTimeout(() => { say('WAYOF health summary saved'); open(); }, 600);
    } catch (e) { say('Could not read the WAYOF link'); }
  }
  async function load() {
    const sbc = g('sb'), me = g('currentUser');
    if (sbc && me) {
      try {
        const { data, error } = await sbc.from('health_summaries').select('summary,updated_at').eq('user_id', me.id).maybeSingle();
        if (!error && data && data.summary) { summary = data.summary; source = 'live'; return; }
      } catch (e) { /* table not created yet: fall back */ }
    }
    try { summary = JSON.parse(localStorage.getItem(LS) || 'null'); source = summary ? 'link' : ''; } catch (e) { summary = null; }
  }

  /* ---- what Kayaos sends to WAYOF (used by the link; same-project accounts read it live) ---- */
  function schedulePayload() {
    const shifts = g('wShifts') || [], jobs = g('wJobs') || [], all = g('tasks') || [], today = ymdL(new Date());
    const until = ymdL(new Date(Date.now() + 21 * 864e5));
    return {
      schema: 'kayaos.wayof.v1', source: 'kayaos.space', generated_at: new Date().toISOString(),
      shifts: shifts.filter(s => s.date && s.date >= ymdL(new Date(Date.now() - 864e5)) && s.date <= until)
        .map(s => ({ date: s.date, start: s.start || '', end: s.end || '', brk: +s.brk || 0, job: (jobs.find(j => j.id === s.job) || {}).name || 'Work', note: (s.note || '').slice(0, 80) })).slice(0, 120),
      appointments: all.filter(t => !t.done && t.hasDue && t.date >= today && (t.category === 'Health' || t.category === 'Appointments'))
        .map(t => ({ id: t.id, title: t.title, cat: t.category, date: t.date, time: t.time || '', place: t.place || '', notes: (t.notes || '').slice(0, 200) })).slice(0, 40)
    };
  }
  function sendToWayof() {
    const p = schedulePayload();
    if (!p.shifts.length && !p.appointments.length) return say('No upcoming Work shifts or Health appointments to send');
    window.open(WAYOF + '#import=kayaos:' + encodeURIComponent(b64(p)), '_blank', 'noopener');
  }
  function addCard(title, date, time, notes) {
    if (typeof openAdd !== 'function') return;
    document.getElementById('wayofDialog').close();
    openAdd({ category: 'Health' });
    const f = document.getElementById('taskForm'); if (!f) return;
    f.title.value = title; if (date) f.date.value = date; if (time) f.time.value = time; if (notes && f.notes) f.notes.value = notes;
    if (f.category) { f.category.value = 'Health'; f.category.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  const exists = (title, date) => (g('tasks') || []).some(t => !t.done && t.title === title && (!date || t.date === date));

  /* ---- dialog ---- */
  function ensureDialog() {
    let d = document.getElementById('wayofDialog'); if (d) return d;
    d = document.createElement('dialog'); d.id = 'wayofDialog';
    d.innerHTML = `<div class="dialogIn"><div class="dialogHead"><h2>❤️ WAYOF Health</h2><button class="iconbtn" data-close aria-label="Close">×</button></div><div id="wayofBody"></div></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-wy]'); if (!b) return;
      const k = b.dataset.wy;
      if (k === 'send') sendToWayof();
      else if (k === 'open') window.open(WAYOF, '_blank', 'noopener');
      else if (k === 'refresh') { b.disabled = true; load().then(render); }
      else if (k === 'card') addCard(b.dataset.title, b.dataset.date, b.dataset.time, b.dataset.notes);
      else if (k === 'forget') { localStorage.removeItem(LS); summary = null; render(); }
    });
    return d;
  }
  function render() {
    const el = document.getElementById('wayofBody'), me = g('currentUser'), sch = schedulePayload();
    const css = `<style>#wayofDialog .wyGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0}
      #wayofDialog .wyStat{border:1px solid var(--line);border-radius:16px;padding:10px 12px;background:var(--panel2)}#wayofDialog .wyStat b{display:block;font-size:20px;letter-spacing:-.02em}
      #wayofDialog .wyRow{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)}#wayofDialog .wyRow>div{flex:1;min-width:0}
      #wayofDialog h3{margin:16px 0 4px;font-size:15px}#wayofDialog .wyBtns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}</style>`;
    if (!summary) {
      el.innerHTML = css + `<p>WAYOF is your health and fitness app: workouts, meals, water, sleep, and a sleep plan built from your Work shifts.</p>
        <p class="sub">${me ? 'No WAYOF data on this account yet. Sign in to <b>thewayof.health</b> with this same email; your summary then shows up here automatically.' : 'Sign in to Kayaos and WAYOF with the same email to share automatically, or use WAYOF → Apps → Kayaos → "Send snapshot".'}</p>
        <div class="wyBtns"><button class="primary" data-wy="open">Open WAYOF</button><button class="ghost" data-wy="send">Send my schedule to WAYOF</button>${me ? '<button class="ghost" data-wy="refresh">↻ Check again</button>' : ''}</div>
        <p class="sub" style="margin-top:12px">Ready to send: ${sch.shifts.length} upcoming shifts · ${sch.appointments.length} Health/Appointment cards.</p>`;
      return;
    }
    const s = summary, t = s.today || {}, G = s.goals || {}, plans = s.sleep_plan || [], rem = s.reminders || [];
    const age = s.generated_at ? Math.round((Date.now() - new Date(s.generated_at)) / 6e4) : null;
    const ago = age == null ? '' : age < 2 ? 'just now' : age < 90 ? age + ' min ago' : age < 2880 ? Math.round(age / 60) + ' h ago' : Math.round(age / 1440) + ' days ago';
    const stat = (l, v, goal) => `<div class="wyStat"><span class="sub">${l}</span><b>${v == null || v === '' ? '—' : escH(v)}</b>${goal ? `<span class="sub">goal ${escH(goal)}</span>` : ''}</div>`;
    el.innerHTML = css + `<p class="sub" style="margin:0">${source === 'live' ? 'Synced from your WAYOF account' : 'From a WAYOF snapshot link'} · updated ${ago}</p>
      <div class="wyGrid">${stat('Steps', t.steps != null ? (+t.steps).toLocaleString() : null, G.steps && (+G.steps).toLocaleString())}${stat('Water', t.water != null ? t.water + ' glasses' : null, G.water_glasses)}${stat('Sleep', t.sleep != null ? t.sleep + ' h' : null, G.sleep_h && G.sleep_h + ' h')}${t.kcal != null ? stat('Calories', t.kcal, G.kcal) : ''}</div>
      ${(t.workouts || []).length ? `<p style="margin:0">💪 Today: <b>${t.workouts.map(escH).join(', ')}</b></p>` : ''}
      ${plans.length ? `<h3>😴 Sleep plan from your shifts</h3>${plans.map(p => {
        const day = (p.bed || '').slice(0, 10), bt = fmtT(p.bed);
        const title = `Wind down for bed (${bt})`, wt = new Date(new Date(p.bed) - 30 * 6e4), when = isNaN(wt) ? '' : `${pad(wt.getHours())}:${pad(wt.getMinutes())}`;
        const d0 = isNaN(wt) ? day : ymdL(wt);
        return `<div class="wyRow"><div><strong>${escH(p.night || fmtD(day))}</strong><div class="sub">Bed ${bt} → wake ${fmtT(p.wake)}${p.note ? ' · ' + escH(p.note) : ''}</div></div>${exists(title, d0) ? '<span class="sub">✓ card</span>' : `<button class="ghost sm" data-wy="card" data-title="${escH(title)}" data-date="${d0}" data-time="${when}" data-notes="From WAYOF sleep plan">+ Card</button>`}</div>`;
      }).join('')}` : `<p class="sub">Add Work shifts in Kayaos and WAYOF will recommend bed and wake times around them.</p>`}
      ${rem.length ? `<h3>⏰ WAYOF reminders</h3>${rem.map(r => {
        const today = ymdL(new Date()), title = String(r.title || '').slice(0, 120);
        return `<div class="wyRow"><div><strong>${escH(title)}</strong><div class="sub">${escH(r.when || '')}${r.minutes ? ' · ' + r.minutes + ' min' : ''}</div></div>${exists(title, today) ? '<span class="sub">✓ card</span>' : `<button class="ghost sm" data-wy="card" data-title="${escH(title)}" data-date="${today}" data-time="" data-notes="From WAYOF">+ Card</button>`}</div>`;
      }).join('')}` : ''}
      <h3>📅 Shared with WAYOF</h3><p class="sub" style="margin:0">${sch.shifts.length} upcoming Work shifts and ${sch.appointments.length} Health/Appointments cards. ${source === 'live' ? 'WAYOF reads these from your account automatically.' : 'Tap "Send my schedule" to update WAYOF.'}</p>
      <div class="wyBtns"><button class="primary" data-wy="open">Open WAYOF</button><button class="ghost" data-wy="send">Send my schedule to WAYOF</button><button class="ghost" data-wy="refresh">↻ Refresh</button>${source === 'link' ? '<button class="ghost" data-wy="forget">Forget snapshot</button>' : ''}</div>
      <p class="sub" style="margin-top:12px">General wellness info from WAYOF, not medical advice.</p>`;
  }
  async function open() { const d = ensureDialog(); document.getElementById('wayofBody').innerHTML = '<p class="sub">Loading…</p>'; if (!d.open) d.showModal(); await load(); render(); }

  /* ---- hook into the More menu ---- */
  function hook() {
    if (typeof window.openMore !== 'function' || window.openMore.__wayof) return;
    const orig = window.openMore;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      const list = document.getElementById('moreList');
      if (list && !list.querySelector('[data-wayof]')) {
        const b = document.createElement('button'); b.className = 'toolItem'; b.type = 'button'; b.dataset.wayof = '1';
        b.innerHTML = '<span class="ti">❤️</span><strong>WAYOF Health</strong><span>Sleep plan, workouts, appointments</span>';
        const settings = list.querySelector('[data-more="settings"]'); settings ? list.insertBefore(b, settings) : list.appendChild(b);
      }
      return r;
    };
    wrapped.__wayof = true; window.openMore = wrapped;
    document.addEventListener('click', e => { if (e.target.closest('[data-wayof]')) { const md = document.getElementById('moreDialog'); if (md && md.open) md.close(); open(); } });
  }
  window.KayaosWayof = { open, schedulePayload, refresh: () => load().then(render) };
  fromHash(); hook();
  window.addEventListener('hashchange', fromHash);
})();
