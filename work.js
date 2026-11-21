/* Kayaos Work and Bills.
   Work: each shift is a card in the Work category (enter it once, on the card). Jobs hold the hourly rate.
   Bills: each bill is a card in a bill category. The Bills view reads those cards, so nothing is entered twice.
   Loaded after script.js and uses its helpers ($, load, store, money, ymd, esc, toast, uuid, render, openAdd, openEdit, removeTasks, toggleDone, ...). */
'use strict';
const WK = { jobs: 'kayaos.v4.jobs', shifts: 'kayaos.v4.shifts', pays: 'kayaos.v4.jobpays', stamp: 'kayaos.v4.workStamp' };
let wJobs = load(WK.jobs, []), wShifts = load(WK.shifts, []), wPays = load(WK.pays, []);
let wPayFixed = false;
wPays.forEach(p => { if (!p.id) { p.id = uuid(); wPayFixed = true; } });
if (wPayFixed) store(WK.pays, wPays);
/* Every change stamps the time it was made and queues a sync, so the newest copy wins on every device */
const wTouch = (key, val) => { store(key, val); store(WK.stamp, Date.now()); workSyncSoon(); };
const wSaveJobs = () => wTouch(WK.jobs, wJobs), wSaveShifts = () => wTouch(WK.shifts, wShifts), wSavePays = () => wTouch(WK.pays, wPays);

/* ---------- Work sync: jobs, shifts and payments are one record per account (table work_data) ---------- */
let wSyncTimer = null, wSyncing = false, wSyncWarned = false;
function workSyncSoon() { if (!sb || !currentUser) return; clearTimeout(wSyncTimer); wSyncTimer = setTimeout(workSync, 800); }
async function workSync(manual) {
  if (!sb || !currentUser) { if (manual) toast('Sign in first (Settings → Account) to sync'); return; }
  if (wSyncing) return;
  wSyncing = true;
  try {
    const { data, error } = await sb.from('work_data').select('data,updated_at').eq('user_id', currentUser.id).maybeSingle();
    if (error) throw error;
    const hasLocal = wJobs.length || wShifts.length || wPays.length;
    /* Data entered before syncing existed has no timestamp: count it as changed now, so it uploads */
    let localAt = load(WK.stamp, 0);
    if (!localAt && hasLocal) { localAt = Date.now(); store(WK.stamp, localAt); }
    const remoteAt = data ? Date.parse(data.updated_at) : 0;
    if (data && remoteAt > localAt) { // another device changed it last: take that copy
      const d = data.data || {};
      wJobs = d.jobs || []; wShifts = d.shifts || []; wPays = d.pays || [];
      store(WK.jobs, wJobs); store(WK.shifts, wShifts); store(WK.pays, wPays); store(WK.stamp, remoteAt);
      wSel = new Set(); if (typeof renderWork === 'function' && view === 'work') renderWork();
      if (typeof render === 'function') render();
    } else if (localAt > remoteAt && (hasLocal || data)) { // this device changed it last: send it
      const { error: upErr } = await sb.from('work_data').upsert({ user_id: currentUser.id, data: { jobs: wJobs, shifts: wShifts, pays: wPays }, updated_at: new Date(localAt).toISOString() });
      if (upErr) throw upErr;
    }
    if (manual) toast(`Work synced · ${wJobs.length} job${wJobs.length === 1 ? '' : 's'}, ${wPays.length} payment${wPays.length === 1 ? '' : 's'}`);
  } catch (err) {
    if (manual) toast('Sync failed: ' + (err.message || 'check the Work sync setup'));
    if (!wSyncWarned) { wSyncWarned = true; toast('Work sync is not set up yet: run the work_data part of schema.sql'); }
  } finally { wSyncing = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) workSync(); });
setInterval(() => { if (!document.hidden) workSync(); }, 60000);
let wSel = new Set(), wSelMode = false, wPayOrig = null;   /* selected payment ids; whether selection mode is on; the saved payment being edited */
const wRound = n => Math.round(n * 100) / 100;
const wHrs = n => (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
const wJob = id => wJobs.find(j => j.id === id);

/* Hours for one shift: a typed total, or end minus start (crosses midnight) minus any unpaid break */
function shiftHours(s) {
  if (s.hours !== undefined && s.hours !== null && s.hours !== '') return wRound(Math.max(0, +s.hours || 0));
  const [sh, sm] = String(s.start || '0:0').split(':').map(Number), [eh, em] = String(s.end || '0:0').split(':').map(Number);
  let m = (eh * 60 + em) - (sh * 60 + sm); if (m < 0) m += 1440;
  m -= (+s.brk || 0); return wRound(Math.max(0, m) / 60);
}
/* Each shift keeps the rate it was logged at, so changing a rate later doesn't rewrite past pay */
const shiftRate = s => { const j = wJob(s.job); return s.rate != null ? +s.rate : (j ? +j.rate || 0 : 0); };
const hasFlat = s => s.flat !== undefined && s.flat !== null && s.flat !== '';
/* Overtime: per job, hours past the weekly limit are paid at the overtime multiplier.
   Shifts count in date order within each Monday–Sunday week. Flat-pay shifts don't count toward overtime. */
function wWeekStart(d) { const x = new Date(d + 'T12:00'), back = (x.getDay() + 6) % 7; x.setDate(x.getDate() - back); return ymd(x); }
function wPayMap() {
  const m = new Map();
  wJobs.forEach(j => {
    const mult = +j.otMult || 1.5, lim = +j.otAfter > 0 ? +j.otAfter : Infinity;
    const list = wShifts.filter(s => s.job === j.id).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    const cum = {};
    list.forEach(s => {
      const h = shiftHours(s);
      if (hasFlat(s)) { m.set(s.id, { hours: h, ot: 0, pay: wRound(+s.flat || 0) }); return; }
      const wk = wWeekStart(s.date), before = cum[wk] || 0; cum[wk] = before + h;
      const reg = Math.max(0, Math.min(h, lim - before)), ot = h - reg, r = shiftRate(s);
      m.set(s.id, { hours: h, ot: wRound(ot), pay: wRound(reg * r + ot * r * mult) });
    });
  });
  return m;
}
const shiftPay = s => { const e = wPayMap().get(s.id); if (e) return e.pay; return hasFlat(s) ? wRound(+s.flat || 0) : wRound(shiftHours(s) * shiftRate(s)); };
const shiftOT = s => wPayMap().get(s.id)?.ot || 0;
const cardOf = s => s.card ? tasks.find(t => t.id === s.card) : null;

function wStats(j) {
  const mine = wShifts.filter(s => s.job === j.id);
  const hours = wRound(mine.reduce((a, s) => a + shiftHours(s), 0));
  const earned = wRound(mine.reduce((a, s) => a + shiftPay(s), 0));
  const paid = wRound(wPays.filter(p => p.job === j.id).reduce((a, p) => a + (+p.amount || 0), 0));
  return { hours, earned, paid, owed: wRound(earned - paid), reimb: fuelDueForJob(j.id) };
}
function wWeekRange() {
  const d = new Date(), back = (d.getDay() + 6) % 7;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back), sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return [ymd(mon), ymd(sun)];
}
const fmtShort = s => s ? new Date(s + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtRange = s => !s.start || !s.end ? 'Hours entered' : `${fmtTime(s.start)} – ${fmtTime(s.end)}${s.brk ? ` · ${s.brk} min break` : ''}`;

/* ---------- Earnings by period: day, week, month, year to date ---------- */
let wPer = 'week', wOff = 0;   /* wOff: 0 = current period, -1 = previous, … */
function wRange(per, off, at) {
  const now = at || new Date(), today = startOfDay(now);
  if (per === 'day') { const d = addDays(today, off); return { from: ymd(d), to: ymd(d), label: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) }; }
  if (per === 'week') { const mon = addDays(today, -((now.getDay() + 6) % 7) + off * 7), sun = addDays(mon, 6); return { from: ymd(mon), to: ymd(sun), label: `${fmtShort(ymd(mon))} – ${fmtShort(ymd(sun))}` }; }
  if (per === 'month') { const first = new Date(now.getFullYear(), now.getMonth() + off, 1), last = new Date(first.getFullYear(), first.getMonth() + 1, 0); return { from: ymd(first), to: ymd(last), label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }; }
  const y = now.getFullYear() + off, cur = y === new Date().getFullYear();
  return { from: `${y}-01-01`, to: cur ? ymd(new Date()) : `${y}-12-31`, label: cur ? `${y} year to date` : `${y}` };
}
/* Hours, earnings, payments received and average $/hour (earned ÷ hours) for a date range, optionally one job */
function wRangeStats(r, jobId) {
  const sh = wShifts.filter(s => (!jobId || s.job === jobId) && s.date >= r.from && s.date <= r.to);
  const hours = wRound(sh.reduce((a, s) => a + shiftHours(s), 0)), earned = wRound(sh.reduce((a, s) => a + shiftPay(s), 0));
  const ot = wRound(sh.reduce((a, s) => a + shiftOT(s), 0));
  const received = wRound(wPays.filter(p => (!jobId || p.job === jobId) && (p.on || '') >= r.from && (p.on || '') <= r.to).reduce((a, p) => a + (+p.amount || 0), 0));
  return { hours, earned, received, ot, shifts: sh.length, rate: hours > 0 ? wRound(earned / hours) : 0 };
}
function periodHTML() {
  if (!wJobs.length) return '';
  /* At a glance: the day, week, month and year that hold the selected period (today when you're on the current one) */
  const sel = wRange(wPer, wOff), cur = wOff === 0, at = new Date(Math.min(Date.now(), new Date(sel.to + 'T12:00').getTime()));
  const glance = [['day', cur ? 'Today' : fmtShort(ymd(at))], ['week', cur ? 'This week' : 'Week of ' + fmtShort(wRange('week', 0, at).from)], ['month', cur ? 'This month' : at.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })], ['year', wRange('year', 0, at).label.replace(/^(\d{4}) year to date$/, 'Year to date')]].map(([k, l]) => {
    const st = wRangeStats(wRange(k, 0, at));
    return `<div class="wkTile"><span>${l}</span><strong>${money(st.earned)}</strong><span class="sub">${wHrs(st.hours)} h · ${money(st.rate)}/hr avg</span></div>`;
  }).join('');
  const r = wRange(wPer, wOff), tot = wRangeStats(r);
  const segs = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => `<button class="${wPer === k ? 'primary' : 'ghost'}" data-wkp="per" data-v="${k}">${l}</button>`).join('');
  const jobs = wJobs.map(j => ({ j, st: wRangeStats(r, j.id) })).filter(x => x.st.shifts || x.st.received);
  const jobRows = jobs.length ? jobs.map(({ j, st }) => `<div class="wkRow">
      <div><strong>${esc(j.name)}</strong><span class="sub">${st.shifts} shift${st.shifts === 1 ? '' : 's'} · ${wHrs(st.hours)} h${st.ot ? ` (${wHrs(st.ot)} OT)` : ''} · avg ${money(st.rate)}/hr</span></div>
      <div class="wkAmt"><b>${money(st.earned)}</b><span class="sub">${money(st.received)} received</span></div></div>`).join('')
    : '<div class="empty">No work in this period.</div>';
  return `<div class="sectionHead"><h2>Earnings</h2><span class="sub">Earned on shift dates · received on payment dates</span></div>
    <div class="wkTiles wkGlance">${glance}</div>
    <div class="card wkPeriod">
      <div class="wkNav"><button class="iconbtn" data-wkp="nav" data-d="-1" aria-label="Previous">‹</button><strong>${esc(r.label)}</strong><button class="iconbtn" data-wkp="nav" data-d="1" aria-label="Next" ${wOff >= 0 ? 'disabled' : ''}>›</button></div>
      <div class="wkSegs">${segs}</div>
      <div class="wkTiles">
        <div class="wkTile"><span>Earned</span><strong>${money(tot.earned)}</strong></div>
        <div class="wkTile"><span>Hours</span><strong>${wHrs(tot.hours)}</strong><span class="sub">${tot.ot ? `${wHrs(tot.ot)} OT` : 'no overtime'}</span></div>
        <div class="wkTile"><span>Average $/hr</span><strong>${money(tot.rate)}</strong><span class="sub">earned ÷ hours</span></div>
        <div class="wkTile"><span>Received</span><strong>${money(tot.received)}</strong><span class="sub">${tot.shifts} shift${tot.shifts === 1 ? '' : 's'}</span></div>
      </div>
      <div class="wkList">${jobRows}</div>
    </div>`;
}

/* ---------- Work view: Earnings above, then one Work card (balance, jobs, searchable entries) ---------- */
let wQ = '', wFilter = 'all';   /* search text; entry filter: all, pay, shift */
/* Fuel you paid on a job that the owner hasn't reimbursed yet (owner-paid fuel is not yours to claim) */
const fuelDueForJob = (id, r) => fRound(fLogs.filter(l => l.job === id && l.payer !== 'owner' && !l.reimb && (!r || wInR(l.date, r))).reduce((a, l) => a + l.total, 0));
/* One row's title, subtitle and searchable text, for a shift or a payment */
function wEntry(e) {
  if (e.kind === 'shift') {
    const s = e.s, j = wJob(s.job)?.name || 'Deleted job';
    return { title: j, sub: `Shift · ${fmtShort(s.date)} · ${fmtRange(s)}${s.note ? ' · ' + esc(s.note) : ''}`,
      text: [j, s.date, fmtShort(s.date), fmtRange(s), s.note, cardOf(s)?.title, shiftPay(s), shiftHours(s)].join(' ') };
  }
  const p = e.p, j = wJob(p.job)?.name || 'Deleted job';
  return { title: j, sub: `Payment · ${fmtShort(p.on)}${p.ref ? ' · Ref ' + esc(p.ref) : ''}${p.note ? ' · ' + esc(p.note) : ''}`,
    text: [j, p.on, fmtShort(p.on), p.ref, p.note, p.amount].join(' ') };
}
let wOpenSec = { jobs: true, entries: true }, wOpenJobs = new Set();
/* Everything in the Work card follows the period picked in Earnings (day, week, month, year) */
const wInR = (d, r) => (d || '') >= r.from && (d || '') <= r.to;
const wPeriodPays = () => { const r = wRange(wPer, wOff); return wPays.filter(p => wInR(p.on, r)); };
/* Jobs with their money: earned, paid, owed, and (when opened) every payment and shift for that job. Search matches job names too. */
function buildJobRows() {
  const q = wQ.trim().toLowerCase(), per = wRange(wPer, wOff);
  const pShifts = j => wShifts.filter(s => s.job === j.id && wInR(s.date, per)), pPays = j => wPays.filter(p => p.job === j.id && wInR(p.on, per));
  const matches = j => {
    if (!pShifts(j).length && !pPays(j).length) return false;   /* no work in the selected period */
    if (!q || j.name.toLowerCase().includes(q)) return true;
    return [...pShifts(j).map(s => ({ kind: 'shift', s })), ...pPays(j).map(p => ({ kind: 'pay', p }))]
      .some(e => wEntry(e).text.toLowerCase().includes(q));
  };
  const rows = wJobs.filter(matches).map(j => { const st = wRangeStats(per, j.id); return { j, hours: st.hours, earned: st.earned, paid: st.received, owed: wRound(st.earned - st.received) }; });
  if (!rows.length) return `<div class="empty">${!wJobs.length ? 'No jobs yet. Tap “Jobs &amp; rates” to add one with its hourly rate.' : q ? 'No jobs match your search.' : 'No work in this period.'}</div>`;
  return rows.map(r => {
    const pct = r.earned > 0 ? Math.min(100, Math.round(r.paid / r.earned * 100)) : 0;
    const owedTxt = r.owed < -0.005 ? `Overpaid ${money(-r.owed)}` : `${money(r.owed)} owed`;
    const open = wOpenJobs.has(r.j.id);
    const pays = pPays(r.j).sort((a, b) => (b.on || '').localeCompare(a.on || ''));
    const shifts = pShifts(r.j).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return `<div class="wkJob">
      <button class="wkJobHead" data-wk="toggleJob" data-id="${esc(r.j.id)}" aria-expanded="${open}">
        <span class="wkJobTxt"><strong>${esc(r.j.name)}</strong><span class="sub">${money(r.j.rate)}/hr · ${wHrs(r.hours)} h · ${owedTxt}</span></span>
        <span class="wkAmt"><b>${money(r.earned)}</b><span class="sub">paid ${money(r.paid)}</span></span>
        <span class="wkChev">${open ? '▴' : '▾'}</span>
      </button>
      ${open ? `<div class="wkJobBody">
        <div class="wkJobBtns"><button class="ghost" data-wk="card" data-job="${esc(r.j.id)}">+ Card</button><button class="ghost" data-wk="pay" data-job="${esc(r.j.id)}">+ Payment</button></div>
        ${fuelLine(r.j, r.earned, r.hours, per)}
        <div class="billBar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
        <strong class="wkSub">Payments</strong>
        ${pays.map(p => `<div class="wkRow"><div data-wk="editPay" data-id="${esc(p.id)}" style="cursor:pointer;min-width:0" title="Tap to edit"><strong>${money(p.amount)}</strong><span class="sub">${fmtShort(p.on)}${p.ref ? ' · Ref ' + esc(p.ref) : ''}${p.note ? ' · ' + esc(p.note) : ''}</span></div></div>`).join('') || '<div class="sub">No payments in this period.</div>'}
        <strong class="wkSub">Shifts</strong>
        ${shifts.map(s => `<div class="wkRow"><div style="min-width:0"><strong>${fmtShort(s.date)}</strong><span class="sub">${fmtRange(s)}</span></div><div class="wkAmt"><b>${wHrs(shiftHours(s))} h</b><span class="sub">${money(shiftPay(s))}</span></div></div>`).join('') || '<div class="sub">No shifts in this period.</div>'}
      </div>` : ''}
    </div>`;
  }).join('');
}
function renderJobsList() { const el = $('#wkJobs'); if (el) el.innerHTML = buildJobRows(); }
function renderWork() {
  const body = $('#workBody'); if (!body) return;
  const per = wRange(wPer, wOff), pst = wRangeStats(per);
  const owedWages = wRound(pst.earned - pst.received);
  const reimbDue = wRound(wJobs.reduce((a, j) => a + fuelDueForJob(j.id, per), 0));
  const perName = wOff === 0 ? { day: 'today', week: 'this week', month: 'this month', year: 'this year' }[wPer] : per.label;
  $('#workSub').textContent = wJobs.length ? `${wJobs.length} job${wJobs.length > 1 ? 's' : ''} · ${wHrs(pst.hours)} h ${perName}` : '';

  const jobRows = buildJobRows();
  const filters = [['all', 'All'], ['pay', 'Payments'], ['shift', 'Shifts']].map(([k, l]) => `<button class="${wFilter === k ? 'primary' : 'ghost'}" data-wk="filter" data-v="${k}">${l}</button>`).join('');
  body.innerHTML = periodHTML()
    + `<div class="sectionHead"><h2>Work</h2><span class="sub" id="wkCount"></span></div>
    <div class="card wkList">
      <div class="wkTiles">
        <div class="wkTile"><span>Wages owed</span><strong>${money(owedWages)}</strong><span class="sub">earned − paid</span></div>
        <div class="wkTile"><span>Fuel to reimburse</span><strong>${money(reimbDue)}</strong><span class="sub">you paid, not yet back</span></div>
        <div class="wkTile"><span>Balance owed to you</span><strong>${money(wRound(owedWages + reimbDue))}</strong></div>
      </div>
      <button class="wkSecHead" data-wk="toggleSec" data-v="jobs">Jobs <span class="sub">${wOpenSec.jobs ? 'hide' : 'show'}</span></button>
      ${wOpenSec.jobs ? `<div id="wkJobs">${jobRows}</div>` : ''}
      <div class="wkSearch"><input type="search" data-wk="q" value="${esc(wQ)}" placeholder="Search by job name, payment, shift or note" aria-label="Search work"></div>
      <div class="wkSegs">${filters}</div>
      <button class="wkSecHead" data-wk="toggleSec" data-v="entries">Payments and shifts <span class="sub">${wOpenSec.entries ? 'hide' : 'show'}</span></button>
      ${wOpenSec.entries ? `<div class="sub" style="margin:4px 0 8px">Showing ${esc(wRange(wPer, wOff).label)}</div><div id="wkBulk"></div><div id="wkEntries"></div>` : ''}
    </div>`;
  renderWorkList();
}
/* Shifts and payments as one list: filtered by the chips and the search box, newest first */
function renderWorkList() {
  const listEl = $('#wkEntries'), bulkEl = $('#wkBulk'), count = $('#wkCount'); if (!listEl) return;
  const vis = wPeriodPays();
  wSel = new Set([...wSel].filter(id => vis.some(p => p.id === id)));
  const q = wQ.trim().toLowerCase(), per = wRange(wPer, wOff);
  let all = [...wShifts.map(s => ({ kind: 'shift', key: (s.date || '') + (s.start || ''), s })), ...wPays.map(p => ({ kind: 'pay', key: (p.on || '') + '99', p }))]
    .sort((a, b) => b.key.localeCompare(a.key));
  if (wFilter !== 'all') all = all.filter(e => e.kind === wFilter);
  all = all.filter(e => wInR(e.kind === 'shift' ? e.s.date : e.p.on, per));
  if (q) all = all.filter(e => wEntry(e).text.toLowerCase().includes(q));
  const shown = all.slice(0, 200);
  count.textContent = `${all.length} ${all.length === 1 ? 'entry' : 'entries'}${all.length > shown.length ? ` · showing ${shown.length}` : ''}`;

  /* Payments: every payment can be selected; the bar acts on the selection and updates in place */
  const allSel = vis.length > 0 && wSel.size === vis.length;
  if (!vis.length || wFilter === 'shift') wSelMode = false;
  bulkEl.innerHTML = !vis.length || wFilter === 'shift' ? '' : !wSelMode
    ? `<div class="wkBulk"><button class="ghost" data-wk="selMode">☑ Select payments</button><span class="sub">Reset or delete several at once</span></div>`
    : `<div class="wkBulk wkBulkOn">
        <button class="ghost" data-wk="selAllToggle">${allSel ? 'Clear all' : 'Select all'}</button>
        <span class="sub"><b>${wSel.size}</b> selected</span>
        <div class="wkBulkBtns">
          <button class="ghost" data-wk="resetSel" ${wSel.size ? '' : 'disabled'}>Reset $0</button>
          <button class="ghost" data-wk="delSel" ${wSel.size ? '' : 'disabled'}>Delete</button>
          <button class="primary" data-wk="selMode">Done</button>
        </div></div>`;

  listEl.innerHTML = shown.length ? shown.map(e => {
    const v = wEntry(e);
    if (e.kind === 'shift') {
      const s = e.s;
      return `<div class="wkRow">
      <div style="min-width:0"><strong>${esc(v.title)}</strong><span class="sub">${v.sub}</span></div>
      <div class="wkAmt"><b>${wHrs(shiftHours(s))} h${shiftOT(s) > 0 ? ` · ${wHrs(shiftOT(s))} OT` : ''}</b><span class="sub">${money(shiftPay(s))}</span></div>
      ${s.card ? `<button class="iconbtn" data-wk="editShift" data-card="${esc(s.card)}" aria-label="Edit card">✎</button>` : ''}
      <button class="iconbtn" data-wk="delShift" data-id="${esc(s.id)}" aria-label="Delete shift">🗑</button></div>`;
    }
    const p = e.p;
    /* In selection mode a whole row is one big tap target; otherwise tapping a payment edits it */
    if (wSelMode) return `<div class="wkRow wkPick${wSel.has(p.id) ? ' on' : ''}" data-wk="pick" data-id="${esc(p.id)}" role="checkbox" aria-checked="${wSel.has(p.id)}">
      <span class="wkBox" aria-hidden="true">${wSel.has(p.id) ? '✓' : ''}</span>
      <div style="min-width:0"><strong>${esc(v.title)}</strong><span class="sub">${v.sub}</span></div>
      <div class="wkAmt"><b>${money(p.amount)}</b></div></div>`;
    return `<div class="wkRow">
      <div data-wk="editPay" data-id="${esc(p.id)}" style="cursor:pointer;min-width:0" title="Tap to edit"><strong>${esc(v.title)}</strong><span class="sub">${v.sub}</span></div>
      <div class="wkAmt"><b>${money(p.amount)}</b></div>
      <button class="iconbtn" data-wk="editPay" data-id="${esc(p.id)}" aria-label="Edit payment">✎</button>
      <button class="iconbtn" data-wk="delPay" data-id="${esc(p.id)}" aria-label="Delete payment">🗑</button></div>`;
  }).join('') : `<div class="empty">${q || wFilter !== 'all' ? 'Nothing matches.' : (wShifts.length || wPays.length ? 'No shifts or payments in this period.' : 'No shifts or payments yet. Tap “+ Work card” to log one.')}</div>`;
}
$('[data-view="work"]').addEventListener('input', e => { if (e.target.dataset.wk === 'q') { wQ = e.target.value; renderWorkList(); renderJobsList(); } });

/* Payment selection and bulk actions */
function resetSelected() {
  const n = wSel.size; if (!n) return;
  if (!confirm(`Set ${n} payment${n === 1 ? '' : 's'} to $0.00? The records stay, with amount 0.`)) return;
  wPays.forEach(p => { if (wSel.has(p.id)) p.amount = 0; });
  wSavePays(); wSel = new Set(); renderWork(); toast(`${n} payment${n === 1 ? '' : 's'} reset to $0.00`);
}
function deleteSelected() {
  const n = wSel.size; if (!n) return;
  if (!confirm(`Delete ${n} payment${n === 1 ? '' : 's'}? This can't be undone.`)) return;
  wPays = wPays.filter(p => !wSel.has(p.id)); wSavePays(); wSel = new Set(); renderWork(); toast(`${n} payment${n === 1 ? '' : 's'} deleted`);
}

function needJob() { if (wJobs.length) return true; toast('Add a job first'); openJobs(); return false; }
function jobOptions(sel) { return wJobs.map(j => `<option value="${esc(j.id)}" ${j.id === sel ? 'selected' : ''}>${esc(j.name)}</option>`).join(''); }

/* A Work card is the only way to log hours: opens the normal card form with the Work fields */
function openWorkCard(jobId) {
  if (!needJob()) return;
  openAdd({ category: 'Work' });
  const f = $('#taskForm'); fillWorkRow();
  if (jobId) f.wJob.value = jobId;
  const j = wJob(f.wJob.value); if (j && !f.title.value) f.title.value = j.name;
}
/* New payment (jobId given) or edit an existing one (payId given) */
function openPay(jobId, payId) {
  if (!needJob()) return;
  const f = $('#wPayForm'), p = payId ? wPays.find(x => x.id === payId) : null;
  f.pid.value = p ? p.id : '';
  $('#wPayTitle').textContent = p ? 'Edit payment' : 'Payment received';
  const pick = p ? p.job : (jobId || wJobs[0].id);
  f.job.innerHTML = jobOptions(pick) + (p && !wJob(p.job) ? `<option value="${esc(p.job)}" selected>Deleted job</option>` : '');
  f.on.value = p ? (p.on || ymd(new Date())) : ymd(new Date());
  f.amount.value = p ? String(p.amount) : '';
  f.ref.value = p ? (p.ref || '') : ''; f.note.value = p ? (p.note || '') : '';
  if (!p) { const j = wJob(f.job.value); if (j) { const s = wStats(j); f.amount.value = s.owed > 0.005 ? s.owed.toFixed(2) : ''; } }
  wPayOrig = p ? { ...p } : null;
  $('#wPayDialog').showModal();
}
function openJobs(editId) {
  const list = wJobs.map(j => `<div class="wkRow">
      <div><strong>${esc(j.name)}</strong><span class="sub">${money(j.rate)}/hr${+j.otAfter > 0 ? ` · ${+j.otMult || 1.5}× over ${+j.otAfter} h/wk` : ''}</span></div>
      <button class="ghost" data-wk="editJob" data-id="${esc(j.id)}">Edit</button></div>`).join('') || '<div class="empty">No jobs yet.</div>';
  $('#wJobList').innerHTML = `<div class="wkList">${list}</div>`;
  resetJobForm(); if (editId) fillJobForm(wJob(editId));
  $('#wJobDialog').showModal();
}
function resetJobForm() { const f = $('#wJobForm'); f.reset(); f.jid.value = ''; f.otMult.value = '1.5'; $('#wJobSave').textContent = 'Add job'; jobDelBtn().hidden = true; }
function fillJobForm(j) { const f = $('#wJobForm'); f.jid.value = j.id; f.jname.value = j.name; f.rate.value = j.rate; f.otAfter.value = +j.otAfter > 0 ? j.otAfter : ''; f.otMult.value = j.otMult || 1.5; $('#wJobSave').textContent = 'Save job'; jobDelBtn().hidden = false; }
/* Delete job: removes the job with its shifts (and their Work cards) and payments, after a count-based confirmation */
function jobDelBtn() {
  let d = document.getElementById('wJobDelete');
  if (!d) { $('#wJobSave').insertAdjacentHTML('afterend', '<button type="button" class="ghost" id="wJobDelete" hidden>Delete job</button>'); d = document.getElementById('wJobDelete'); d.addEventListener('click', deleteJob); }
  return d;
}
function deleteJob() {
  const id = $('#wJobForm').jid.value, j = wJob(id); if (!j) return;
  const ns = wShifts.filter(s => s.job === id).length, np = wPays.filter(p => p.job === id).length;
  if (!confirm(`Delete "${j.name}"? This also removes its ${ns} shift${ns === 1 ? '' : 's'} and ${np} payment${np === 1 ? '' : 's'}. This can't be undone.`)) return;
  const cards = wShifts.filter(s => s.job === id && s.card).map(s => s.card);
  if (cards.length) removeTasks(cards);
  wShifts = wShifts.filter(s => s.job !== id); wSaveShifts();
  wPays = wPays.filter(p => p.job !== id); wSavePays();
  wJobs = wJobs.filter(x => x.id !== id); wSaveJobs();
  resetJobForm(); openJobs(); renderWork(); toast(`Deleted ${j.name}`);
}

/* ---------- Export ---------- */
function exportWorkCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Job,Rate,Hours,Earned,Paid,Balance'];
  wJobs.forEach(j => { const s = wStats(j); lines.push([j.name, j.rate, s.hours, s.earned, s.paid, s.owed].map(q).join(',')); });
  lines.push('', 'Date,Job,Start,End,Unpaid break (min),Hours,OT hours,Rate,Pay,Note,Card');
  [...wShifts].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).forEach(s => lines.push([s.date, wJob(s.job)?.name || '', s.start, s.end, s.brk || 0, shiftHours(s), shiftOT(s), shiftRate(s), shiftPay(s), s.note || '', s.card ? 'yes' : 'no'].map(q).join(',')));
  lines.push('', 'Date,Job,Amount paid,Reference,Note');
  [...wPays].sort((a, b) => (a.on || '').localeCompare(b.on || '')).forEach(p => lines.push([p.on, wJob(p.job)?.name || '', p.amount, p.ref || '', p.note || ''].map(q).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kayaos-work-${ymd(new Date())}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Work exported as CSV');
}

/* ---------- Bills view: reads the bill cards ---------- */
const blCards = () => tasks.filter(t => isBill(t.category));
function blTotals(list) {
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth(); let total = 0, paid = 0;
  for (const t of list) {
    if (!(t.amount > 0)) continue;
    if (!t.hasDue) { total += t.amount; if (t.done) paid += t.amount; continue; }
    for (let d = new Date(y, mo, 1); d.getMonth() === mo; d.setDate(d.getDate() + 1)) {
      if (!occursOn(t, d)) continue; total += t.amount;
      paid += isDoneOn(t, d) ? t.amount : Math.min(t.amount, paidFor(t, payKey(t, d)));
    }
  }
  let soon = 0; const end = addDays(now, 30);
  for (const t of list) {
    if (!t.hasDue || !(t.amount > 0)) continue;
    for (let d = startOfDay(now); d <= end; d = addDays(d, 1)) if (occursOn(t, d) && !isDoneOn(t, d)) soon += t.amount - Math.min(t.amount, paidFor(t, payKey(t, d)));
  }
  return { total: wRound(total), paid: wRound(paid), left: wRound(total - paid), soon: wRound(soon), month: now.toLocaleDateString(undefined, { month: 'long' }) };
}
function blDueLine(t) {
  if (!t.hasDue) return 'No due date';
  const o = relevantOcc(t);
  return o ? `${t.repeat !== 'none' ? 'Next: ' : 'Due '}${fmtDate(o)} • ${fmtTime(t.time)}` : 'All installments paid';
}
function renderBills() {
  const body = $('#billsBody'); if (!body) return;
  const list = blCards().sort(byUrgency);
  const tot = blTotals(list);
  $('#billsSub').textContent = list.length ? `${list.length} bill${list.length > 1 ? 's' : ''} · ${money(tot.left)} left in ${tot.month}` : '';
  const tiles = `<div class="wkTiles">
    <div class="wkTile"><span>${esc(tot.month)} bills</span><strong>${money(tot.total)}</strong></div>
    <div class="wkTile"><span>Paid</span><strong>${money(tot.paid)}</strong></div>
    <div class="wkTile"><span>Still owed</span><strong>${money(tot.left)}</strong></div>
    <div class="wkTile"><span>Next 30 days</span><strong>${money(tot.soon)}</strong></div>
  </div>`;
  const cards = list.length ? list.map(t => `<div class="card wkJob">
      <div class="wkJobHead"><strong>${esc(t.title)}</strong><span class="sub">${esc(blDueLine(t))}</span></div>
      ${billProgressHTML(t) || `<div class="sub">${t.amount > 0 ? '' : 'No amount set'}</div>`}
      <div class="row" style="margin-top:10px">${!isDone(t) && billDue(t) > 0 ? `<button class="primary" data-bl="pay" data-id="${esc(t.id)}">💵 Pay</button>` : ''}<button class="ghost" data-bl="edit" data-id="${esc(t.id)}">Edit</button></div>
    </div>`).join('') : `<div class="empty">No bills yet. Tap “+ Bill” to add one with its amount and due date.</div>`;
  const ledger = [];
  list.forEach(t => (t.payments || []).forEach((p, i) => ledger.push({ t, i, p })));
  ledger.sort((a, b) => (b.p.on || '').localeCompare(a.p.on || ''));
  const rows = ledger.length ? ledger.slice(0, 60).map(({ t, i, p }) => `<div class="wkRow">
      <div><strong>${esc(t.title)}</strong><span class="sub">${fmtShort(p.on)}${p.ref ? ' · Ref ' + esc(p.ref) : ''}</span></div>
      <div class="wkAmt"><b>${money(p.amount)}</b></div>
      <button class="iconbtn" data-bl="delPay" data-id="${esc(t.id)}" data-idx="${i}" aria-label="Delete payment">🗑</button></div>`).join('')
    : '<div class="empty">No payments recorded yet.</div>';
  const paidTotal = wRound(ledger.reduce((a, x) => a + (+x.p.amount || 0), 0));
  body.innerHTML = tiles
    + `<div class="sectionHead"><h2>Bills</h2><span class="sub">${list.length} total</span></div><div class="wkJobs">${cards}</div>`
    + `<div class="sectionHead"><h2>Payments</h2><span class="sub">${ledger.length} total · ${money(paidTotal)}</span></div><div class="card wkList">${rows}</div>`;
}
function blDeletePay(id, idx) {
  const t = tasks.find(x => x.id === id), p = t && t.payments[idx]; if (!p) return;
  if (!confirm('Delete this payment?')) return;
  t.payments.splice(idx, 1);
  setPaidState(t, p.for, paidFor(t, p.for) >= billDue(t) - 0.005);
  t.completedBy = isDone(t) ? myId() : null; t.doneAt = isDone(t) ? Date.now() : null;
  saveTasks(); pushTask(t); render();
}

/* ---------- Wiring ---------- */
$('[data-view="work"]').addEventListener('click', e => {
  const p = e.target.closest('[data-wkp]');
  if (p) { if (p.dataset.wkp === 'per') { wPer = p.dataset.v; wOff = 0; } else if (!p.disabled) wOff = Math.min(0, wOff + (+p.dataset.d)); renderWork(); return; }
  const b = e.target.closest('[data-wk]'); if (!b) return; const k = b.dataset.wk;
  if (k === 'card') openWorkCard(b.dataset.job);
  else if (k === 'pay') openPay(b.dataset.job);
  else if (k === 'editPay') openPay(null, b.dataset.id);
  else if (k === 'jobs') openJobs();
  else if (k === 'filter') { wFilter = b.dataset.v; renderWork(); }
  else if (k === 'workSync') workSync(true);
  else if (k === 'import') openImport();
  else if (k === 'impAdd') addImported();
  else if (k === 'toggleJob') { const id = b.dataset.id; if (wOpenJobs.has(id)) wOpenJobs.delete(id); else wOpenJobs.add(id); renderWork(); }
  else if (k === 'toggleSec') { const v = b.dataset.v; wOpenSec[v] = !wOpenSec[v]; renderWork(); }
  else if (k === 'selMode') { wSelMode = !wSelMode; wSel = new Set(); renderWork(); }
  else if (k === 'pick') { const id = b.dataset.id; if (wSel.has(id)) wSel.delete(id); else wSel.add(id); renderWork(); }
  else if (k === 'selAllToggle') { const vis = wPeriodPays(), all = vis.length > 0 && wSel.size === vis.length; wSel = all ? new Set() : new Set(vis.map(p => p.id)); renderWork(); }
  else if (k === 'resetSel') resetSelected();
  else if (k === 'delSel') deleteSelected();
  else if (k === 'csv') exportWorkCSV();
  else if (k === 'editShift') { const t = tasks.find(x => x.id === b.dataset.card); if (t) openEdit(t.id); }
  else if (k === 'delShift') {
    const s = wShifts.find(x => x.id === b.dataset.id); if (!s || !confirm('Delete this shift?')) return;
    if (s.card && cardOf(s)) removeTasks([s.card]);
    else { wShifts = wShifts.filter(x => x.id !== s.id); wSaveShifts(); renderWork(); }
  }
  else if (k === 'delPay' && confirm('Delete this payment?')) { wPays = wPays.filter(p => p.id !== b.dataset.id); wSavePays(); renderWork(); }
});
$('[data-view="bills"]').addEventListener('click', e => {
  const b = e.target.closest('[data-bl]'); if (!b) return; const k = b.dataset.bl;
  if (k === 'add') openAdd({ category: 'Bills' });
  else if (k === 'edit') openEdit(b.dataset.id);
  else if (k === 'pay') { const t = tasks.find(x => x.id === b.dataset.id); if (t) toggleDone(t); }
  else if (k === 'delPay') blDeletePay(b.dataset.id, +b.dataset.idx);
});
$('#wJobList').addEventListener('click', e => {
  const b = e.target.closest('[data-wk="editJob"]'); if (!b) return;
  fillJobForm(wJob(b.dataset.id));
  const f = $('#wJobForm'); f.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f.jname.focus({ preventScroll: true }), 250);
});
/* Reset in the dialog: back to the saved values (or blank for a new payment). It does not save. */
$('#wPayReset').addEventListener('click', () => { const f = $('#wPayForm'), o = wPayOrig; f.amount.value = o ? String(o.amount) : ''; f.on.value = o ? (o.on || '') : ymd(new Date()); f.ref.value = o ? (o.ref || '') : ''; f.note.value = o ? (o.note || '') : ''; });
$('#wJobReset').addEventListener('click', resetJobForm);
$('#wJobForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target;
  const name = f.jname.value.trim(), rate = parseFloat(f.rate.value);
  if (!name) { toast('Enter a job name'); return; }
  if (!(rate >= 0)) { toast('Enter an hourly rate'); return; }
  const otAfter = parseFloat(f.otAfter.value) || 0, otMult = parseFloat(f.otMult.value) || 1.5;
  if (f.jid.value) { const j = wJob(f.jid.value); if (j) { j.name = name; j.rate = rate; j.otAfter = otAfter; j.otMult = otMult; } }
  else wJobs.push({ id: uuid(), name, rate, otAfter, otMult });
  wSaveJobs(); resetJobForm(); openJobs(); renderWork(); toast('Job saved');
});
$('#wPayForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, amt = parseFloat(f.amount.value) || 0;
  /* An edit keeps the job it already had, even if that job was since deleted */
  const was = f.pid.value ? wPays.find(p => p.id === f.pid.value) : null;
  const j = wJob(f.job.value) || (was && was.job === f.job.value ? { id: was.job, name: 'Deleted job' } : null);
  if (!j) { toast('Pick a job'); return; }
  if (f.amount.value.trim() === '' || !(amt >= 0)) { toast('Enter the amount received (0.00 is allowed)'); f.amount.focus(); return; }
  const rec = { job: j.id, on: f.on.value || ymd(new Date()), amount: wRound(amt), ref: f.ref.value.trim().toUpperCase(), note: f.note.value.trim() };
  const editing = f.pid.value ? wPays.find(p => p.id === f.pid.value) : null;
  if (editing) Object.assign(editing, rec); else wPays.push({ id: uuid(), ...rec });
  wSavePays(); $('#wPayDialog').close(); renderWork();
  toast(editing ? `Payment updated to ${money(amt)} for ${j.name}` : `Payment of ${money(amt)} recorded for ${j.name}`);
});

/* ---------- Work cards: the card holds hours and pay, and its shift is kept in step with it ---------- */
function fillWorkRow(cardId) {
  const f = $('#taskForm'), sel = f.wJob, keep = sel.value;
  sel.innerHTML = wJobs.map(j => `<option value="${esc(j.id)}">${esc(j.name)} · ${money(j.rate)}/hr</option>`).join('') || '<option value="">Add a job in Work → Jobs &amp; rates first</option>';
  if (keep && wJobs.some(j => j.id === keep)) sel.value = keep;
  if (cardId) {
    const s = wShifts.find(x => x.card === cardId);
    if (s) { sel.value = s.job; f.wHours.value = s.hours ? s.hours : ''; f.wFlat.value = s.flat != null ? s.flat : ''; f.wStart.value = s.start || ''; f.wEnd.value = s.end || ''; f.wBreak.value = s.brk || ''; }
  }
}
/* Adds, updates or removes the card's shift so the Work tab always matches the card */
function syncCardWork(t, fd) {
  const hrs = String(fd.get('wHours') || '').trim(), flat = String(fd.get('wFlat') || '').trim(), jobId = String(fd.get('wJob') || '');
  const start = String(fd.get('wStart') || ''), end = String(fd.get('wEnd') || ''), brk = Math.max(0, parseInt(fd.get('wBreak'), 10) || 0);
  const useTimes = !!(start && end);
  const idx = wShifts.findIndex(s => s.card === t.id);
  if (t.category !== 'Work' || (!hrs && !flat && !useTimes)) { if (idx >= 0) { wShifts.splice(idx, 1); wSaveShifts(); } return; }
  const job = wJob(jobId);
  if (!job) { toast('Add a job in Work → Jobs & rates so this pay counts'); return; }
  const prev = idx >= 0 ? wShifts[idx] : null;
  const s = { id: prev ? prev.id : uuid(), card: t.id, job: job.id, date: t.hasDue ? t.date : ymd(new Date()), start: useTimes ? start : '', end: useTimes ? end : '', brk: useTimes ? brk : 0, note: t.title,
    hours: useTimes ? null : (hrs ? wRound(parseFloat(hrs)) : 0), flat: flat ? wRound(parseFloat(flat)) : null,
    rate: prev && prev.job === job.id && prev.rate != null ? prev.rate : (+job.rate || 0) };
  if (prev) wShifts[idx] = s; else wShifts.push(s);
  wSaveShifts(); if (view === 'work') renderWork();
}
/* Deleting a card removes its logged pay too */
function wDropCards(ids) { const n = wShifts.length; wShifts = wShifts.filter(s => !(s.card && ids.includes(s.card))); if (wShifts.length !== n) wSaveShifts(); }
/* Small chip on the card showing the pay it contributes */
function workChip(t) { const s = wShifts.find(x => x.card === t.id); return s ? `<span class="chip amt" title="Counted in Work">💼 ${wHrs(shiftHours(s))} h · ${money(shiftPay(s))}</span>` : ''; }

/* ---------- Import work from text: paste or upload a text message, email, or schedule; review; add ---------- */
let wImported = [];
function ensureImportDialog() {
  if ($('#wImportDialog')) return;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="wImportDialog"><form class="dialogIn form" id="wImportForm" method="dialog" novalidate>
    <div class="dialogHead"><h2>Import from text</h2><button type="button" class="iconbtn" data-close aria-label="Close">×</button></div>
    <p class="sub">Paste a text message, an email, or a schedule, or upload a text file. Kayaos finds the shifts and payments. You check them before anything is added.</p>
    <label class="lbl">Paste text<textarea id="wImpText" rows="6" placeholder="e.g. Hey, you're on Fri 5pm–11pm at the bar. Paid $120 by Zelle, ref 4421."></textarea></label>
    <label class="lbl">Or upload a file (.txt, .eml, .csv)<input type="file" id="wImpFile" accept=".txt,.eml,.csv,text/plain,text/csv,message/rfc822"></label>
    <div class="clearList"><button class="primary" type="button" id="wImpRead">Read entries</button></div>
    <div id="wImpList"></div>
    <div class="clearList"><button class="primary" type="button" data-wk="impAdd" id="wImpAdd" hidden>✓ Add selected</button></div>
  </form></dialog>`);
  $('#wImpRead').addEventListener('click', readImported);
  $('#wImpFile').addEventListener('change', async e => { const f = e.target.files[0]; if (f) $('#wImpText').value = await f.text(); });
}
function openImport() {
  if (!needJob()) return;
  ensureImportDialog(); wImported = []; $('#wImpList').innerHTML = ''; $('#wImpAdd').hidden = true;
  $('#wImportDialog').showModal();
}
async function readImported() {
  const text = $('#wImpText').value.trim(); if (!text) { toast('Paste the text or upload a file first'); return; }
  if (!sb || !currentUser) { toast('Sign in first (Settings → Account) to read text'); return; }
  $('#wImpList').innerHTML = '<p class="sub">Reading…</p>';
  try {
    const { data } = await sb.auth.getSession(); const token = data && data.session && data.session.access_token;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/parse-work`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text, today: ymd(new Date()) }) });
    if (!r.ok) throw new Error(await r.text().catch(() => 'import'));
    wImported = (await r.json()).entries || [];
    renderImported();
  } catch (err) { $('#wImpList').innerHTML = '<p class="sub">Could not read entries from this text. Try again or type them in.</p>'; $('#wImpAdd').hidden = true; }
}
function jobForEntry(e) {
  const n = (e.job || '').toLowerCase();
  return (n && wJobs.find(j => j.name.toLowerCase() === n || n.includes(j.name.toLowerCase()) || j.name.toLowerCase().includes(n))) || wJobs[0];
}
function renderImported() {
  const list = $('#wImpList');
  if (!wImported.length) { list.innerHTML = '<p class="sub">No shifts or payments found in this text.</p>'; $('#wImpAdd').hidden = true; return; }
  list.innerHTML = `<div class="wkList">${wImported.map((e, i) => {
    const j = jobForEntry(e);
    const what = e.kind === 'shift'
      ? `Shift · ${fmtShort(e.date)} · ${e.start && e.end ? `${e.start}–${e.end}` : `${wHrs(e.hours || 0)} h`}`
      : `Payment · ${fmtShort(e.date)} · ${money(e.amount)}${e.ref ? ' · Ref ' + esc(e.ref) : ''}`;
    return `<label class="wkRow"><input type="checkbox" data-imp="${i}" checked style="width:20px;height:20px"><div style="min-width:0"><strong>${esc(what)}</strong><span class="sub">${esc(j ? j.name : 'No job yet')}${e.note ? ' · ' + esc(e.note) : ''}</span></div></label>`;
  }).join('')}</div>`;
  $('#wImpAdd').hidden = false;
}
function addImported() {
  const picks = [...document.querySelectorAll('[data-imp]')].filter(c => c.checked).map(c => wImported[+c.dataset.imp]);
  if (!picks.length) { toast('Tick at least one entry'); return; }
  let shifts = 0, pays = 0;
  picks.forEach(e => {
    const j = jobForEntry(e); if (!j) return;
    if (e.kind === 'shift') {
      const useTimes = !!(e.start && e.end);
      wShifts.push({ id: uuid(), card: null, job: j.id, date: e.date, start: useTimes ? e.start : '', end: useTimes ? e.end : '', brk: 0, note: e.note || 'Imported',
        hours: useTimes ? null : (e.hours || 0), flat: null, rate: +j.rate || 0 });
      shifts++;
    } else {
      wPays.push({ id: uuid(), job: j.id, on: e.date, amount: e.amount, ref: e.ref || '', note: e.note || 'Imported' });
      pays++;
    }
  });
  wSaveShifts(); wSavePays();
  $('#wImportDialog').close(); renderWork();
  toast(`Added ${shifts} shift${shifts === 1 ? '' : 's'} and ${pays} payment${pays === 1 ? '' : 's'}`);
}
