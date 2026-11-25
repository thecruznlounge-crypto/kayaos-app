/* Kayaos Portfolio: one place for income, expenses, debt and assets.
   Pulls in what's already entered elsewhere, so nothing is typed twice:
     Work  → payments received (income) and wages/fuel still owed to you (an asset)
     Bills → every bill payment (expense) and what's still unpaid this month (owed)
     Fuel  → fill-ups you paid and weren't reimbursed for (expense)
   Adds its own entries: other income, other expenses, assets and debts. Income and expenses can repeat.
   Saved with the Work data (same sync record), so it follows the account to every device.
   Loaded after work.js and fuel.js and uses their helpers (wRange, wInR, wRound, wStats, blCards, blTotals, fLogs, ...). */
'use strict';
const PF_KEY = 'kayaos.v4.portfolio';
let pf = load(PF_KEY, { items: [], snaps: {} });
if (!Array.isArray(pf.items)) pf.items = [];
if (!pf.snaps || typeof pf.snaps !== 'object') pf.snaps = {};
/* Work sync carries this along (see workSync in work.js) */
window.pfGet = () => pf;
window.pfSet = d => { if (!d || !Array.isArray(d.items)) return; pf = { items: d.items, snaps: d.snaps || {} }; store(PF_KEY, pf); if (view === 'money') renderPortfolio(); };
const pfSave = () => { store(PF_KEY, pf); store(WK.stamp, Date.now()); workSyncSoon(); };

const PF_CATS = {
  income: ['Business', 'Side gig', 'Rental', 'Interest / dividends', 'Benefits', 'Child support', 'Gift', 'Refund', 'Sale', 'Other income'],
  expense: ['Housing', 'Food & groceries', 'Dining out', 'Transportation', 'Car', 'Shopping', 'Kids & school', 'Health', 'Insurance', 'Phone & internet', 'Subscriptions', 'Entertainment', 'Personal care', 'Business', 'Gifts & giving', 'Debt payment', 'Taxes', 'Other'],
  asset: ['Cash', 'Checking', 'Savings', 'Investments', 'Retirement', 'Crypto', 'Vehicle', 'Home / property', 'Business', 'Equipment', 'Money owed to me', 'Other asset'],
  debt: ['Credit card', 'Auto loan', 'Mortgage', 'Student loan', 'Personal loan', 'Business loan', 'Medical', 'Taxes owed', 'Buy now, pay later', 'Owed to a person', 'Other debt']
};
const PF_ICON = { income: '💵', expense: '🧾', asset: '🏦', debt: '💳' };
const PF_REPEAT = [['none', 'One time'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month'], ['yearly', 'Every year']];
let pfPer = 'month', pfOff = 0, pfOpen = { flow: true, sheet: true, debts: true, repeat: false, activity: true };

/* ---------- Dates ---------- */
const pfD = s => new Date(s + 'T12:00');
const pfAddMonths = (d, n, day) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1, 12); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x; };
/* Every date an income or expense lands on inside range r */
function pfOcc(it, r) {
  if (!it.on) return [];
  const until = it.until && it.until < r.to ? it.until : r.to;
  if (!it.repeat || it.repeat === 'none') return wInR(it.on, r) ? [it.on] : [];
  const out = [], start = pfD(it.on), day = start.getDate();
  for (let i = 0; i < 2000; i++) {
    let d;
    if (it.repeat === 'weekly') d = addDays(start, i * 7);
    else if (it.repeat === 'biweekly') d = addDays(start, i * 14);
    else if (it.repeat === 'monthly') d = pfAddMonths(start, i, day);
    else if (it.repeat === 'yearly') d = pfAddMonths(start, i * 12, day);
    else break;
    const s = ymd(d); if (s > until) break;
    if (s >= r.from) out.push(s);
  }
  return out;
}
const pfOrd = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const pfRepLabel = it => (PF_REPEAT.find(x => x[0] === it.repeat) || PF_REPEAT[0])[1];

/* ---------- Everything that moved money in a period, from every source ---------- */
function pfFlow(r) {
  const rows = [];   /* { dir: 'in'|'out', amt, on, title, cat, src, id } */
  wPays.forEach(p => { if (wInR(p.on, r) && +p.amount) rows.push({ dir: 'in', amt: +p.amount, on: p.on, title: wJob(p.job)?.name || 'Work', cat: 'Work pay', src: 'Work' }); });
  blCards().forEach(t => (t.payments || []).forEach(p => { if (wInR(p.on, r) && +p.amount) rows.push({ dir: 'out', amt: +p.amount, on: p.on, title: t.title, cat: 'Bills · ' + (t.category || 'Bills'), src: 'Bills' }); }));
  fLogs.forEach(l => { if (wInR(l.date, r) && l.payer !== 'owner' && !l.reimb && +l.total) rows.push({ dir: 'out', amt: +l.total, on: l.date, title: l.station || 'Fuel', cat: 'Fuel', src: 'Fuel' }); });
  pf.items.forEach(it => {
    if (it.kind !== 'income' && it.kind !== 'expense') return;
    /* Your own entries count once their date arrives; what's still ahead is in “Next 30 days” */
    const today = ymd(new Date()), upTo = { from: r.from, to: r.to < today ? r.to : today };
    if (upTo.from <= upTo.to) pfOcc(it, upTo).forEach(on => rows.push({ dir: it.kind === 'income' ? 'in' : 'out', amt: +it.amount || 0, on, title: it.name, cat: it.cat || (it.kind === 'income' ? 'Other income' : 'Other'), src: 'Portfolio', id: it.id }));
  });
  rows.sort((a, b) => (b.on || '').localeCompare(a.on || ''));
  const inc = wRound(rows.filter(x => x.dir === 'in').reduce((a, x) => a + x.amt, 0));
  const out = wRound(rows.filter(x => x.dir === 'out').reduce((a, x) => a + x.amt, 0));
  const byCat = dir => { const m = {}; rows.filter(x => x.dir === dir).forEach(x => { m[x.cat] = (m[x.cat] || 0) + x.amt; }); return Object.entries(m).map(([c, v]) => [c, wRound(v)]).sort((a, b) => b[1] - a[1]); };
  const st = wRangeStats(r);
  return { rows, inc, out, net: wRound(inc - out), save: inc > 0 ? Math.round((inc - out) / inc * 100) : null, inCats: byCat('in'), outCats: byCat('out'), earned: st.earned, unpaidWork: wRound(Math.max(0, st.earned - st.received)) };
}

/* ---------- What you own and owe right now ---------- */
function pfSheet() {
  const assets = pf.items.filter(i => i.kind === 'asset'), debts = pf.items.filter(i => i.kind === 'debt');
  const wages = wRound(wJobs.reduce((a, j) => a + Math.max(0, wStats(j).owed), 0));
  const fuel = wRound(wJobs.reduce((a, j) => a + fuelDueForJob(j.id), 0));
  const bills = blTotals(blCards());
  const aLines = assets.map(i => ({ name: i.name, cat: i.cat, amt: +i.amount || 0, id: i.id, on: i.on }));
  if (wages > 0.005) aLines.push({ name: 'Wages owed to you', cat: 'From Work', amt: wages });
  if (fuel > 0.005) aLines.push({ name: 'Fuel to be reimbursed', cat: 'From Work', amt: fuel });
  const dLines = debts.map(i => ({ name: i.name, cat: i.cat, amt: +i.amount || 0, id: i.id, it: i }));
  if (bills.left > 0.005) dLines.push({ name: `Unpaid bills · ${bills.month}`, cat: 'From Bills', amt: bills.left });
  const A = wRound(aLines.reduce((a, x) => a + x.amt, 0)), D = wRound(dLines.reduce((a, x) => a + x.amt, 0));
  const bal = wRound(debts.reduce((a, i) => a + (+i.amount || 0), 0));
  const minPay = wRound(debts.reduce((a, i) => a + (+i.amount > 0 ? Math.min(+i.minPay || 0, +i.amount) : 0), 0));
  const interest = wRound(debts.reduce((a, i) => a + (+i.amount || 0) * (+i.apr || 0) / 1200, 0));
  const apr = bal > 0 ? Math.round(debts.reduce((a, i) => a + (+i.amount || 0) * (+i.apr || 0), 0) / bal * 100) / 100 : 0;
  const liquid = wRound(assets.filter(i => ['Cash', 'Checking', 'Savings'].includes(i.cat)).reduce((a, i) => a + (+i.amount || 0), 0));
  return { aLines, dLines, A, D, net: wRound(A - D), bal, minPay, interest, apr, liquid, billsSoon: bills.soon };
}
/* Months to pay off at the minimum payment (null = the payment doesn't cover the interest) */
function pfPayoff(i) {
  const B = +i.amount || 0, P = +i.minPay || 0, r = (+i.apr || 0) / 1200;
  if (B <= 0) return 0; if (P <= 0) return null;
  if (r === 0) return Math.ceil(B / P);
  if (P <= B * r) return null;
  return Math.ceil(-Math.log(1 - r * B / P) / Math.log(1 + r));
}
const pfMonths = n => n == null ? 'never at this payment' : n === 0 ? 'paid off' : n < 12 ? `${n} mo` : `${Math.floor(n / 12)} yr${n % 12 ? ` ${n % 12} mo` : ''}`;

/* Next 30 days: bills, repeating expenses and debt minimums vs repeating income */
function pfSoon() {
  const t = new Date(), r = { from: ymd(t), to: ymd(addDays(t, 30)) };
  let inc = 0, out = 0;
  pf.items.forEach(it => {
    if (it.kind !== 'income' && it.kind !== 'expense') return;
    const n = pfOcc(it, r).length * (+it.amount || 0);
    if (it.kind === 'income') inc += n; else out += n;
  });
  const sh = pfSheet();
  return { inc: wRound(inc), out: wRound(out + sh.billsSoon + sh.minPay), bills: sh.billsSoon, min: sh.minPay };
}

/* Keep one net worth per month so you can see the trend */
function pfSnap(net) {
  const k = ymd(new Date()).slice(0, 7);
  if (pf.snaps[k] !== net) { pf.snaps[k] = net; store(PF_KEY, pf); }
}
function pfTrendHTML() {
  const keys = Object.keys(pf.snaps).sort().slice(-12); if (keys.length < 2) return '';
  const vals = keys.map(k => pf.snaps[k]), max = Math.max(...vals.map(Math.abs), 1);
  const W = 100 / keys.length;
  const bars = keys.map((k, i) => { const v = vals[i], h = Math.max(2, Math.abs(v) / max * 42); return `<rect x="${i * W + W * 0.15}" y="${v >= 0 ? 46 - h : 46}" width="${W * 0.7}" height="${h}" rx="1.5" fill="${v >= 0 ? '#2e9e4f' : 'var(--red)'}"><title>${pfD(k + '-01').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}: ${money(v)}</title></rect>`; }).join('');
  const prev = vals[vals.length - 2], diff = wRound(vals[vals.length - 1] - prev);
  return `<div class="pfTrend"><svg viewBox="0 0 100 ${vals.some(v => v < 0) ? 92 : 48}" preserveAspectRatio="none" role="img" aria-label="Net worth by month">${bars}</svg>
    <span class="sub">${diff >= 0 ? '▲' : '▼'} ${money(Math.abs(diff))} since last month · last ${keys.length} months</span></div>`;
}

/* ---------- Drawing ---------- */
const pfBars = (cats, total) => cats.length ? cats.map(([c, v]) => { const pct = total > 0 ? Math.round(v / total * 100) : 0; return `<div class="pfCat"><div class="pfCatTop"><span>${esc(c)}</span><b>${money(v)} <span class="sub">${pct}%</span></b></div><div class="billBar"><span style="width:${pct}%"></span></div></div>`; }).join('') : '<div class="sub">Nothing in this period.</div>';
const pfSec = (k, title, sub) => `<button class="wkSecHead" data-pf="sec" data-v="${k}">${title} <span class="sub">${sub ? esc(sub) + ' · ' : ''}${pfOpen[k] ? 'hide' : 'show'}</span></button>`;

function renderPortfolio() {
  const body = $('#pfBody'); if (!body) return;
  const r = wRange(pfPer, pfOff), fl = pfFlow(r), sh = pfSheet(), soon = pfSoon();
  pfSnap(sh.net);
  $('#pfSub').textContent = `Net worth ${money(sh.net)}`;
  const segs = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']].map(([k, l]) => `<button class="${pfPer === k ? 'primary' : 'ghost'}" data-pf="per" data-v="${k}">${l}</button>`).join('');

  const flow = `<div class="sectionHead"><h2>Money in and out</h2><span class="sub">Work, Bills, Fuel and your own entries</span></div>
    <div class="card wkPeriod">
      <div class="wkNav"><button class="iconbtn" data-pf="nav" data-d="-1" aria-label="Previous">‹</button><strong>${esc(r.label)}</strong><button class="iconbtn" data-pf="nav" data-d="1" aria-label="Next" ${pfOff >= 0 ? 'disabled' : ''}>›</button></div>
      <div class="wkSegs">${segs}</div>
      <div class="wkTiles">
        <div class="wkTile"><span>Income</span><strong>${money(fl.inc)}</strong><span class="sub">money received</span></div>
        <div class="wkTile"><span>Expenses</span><strong>${money(fl.out)}</strong><span class="sub">money spent</span></div>
        <div class="wkTile ${fl.net >= 0 ? 'over' : 'pfNeg'}"><span>Left over</span><strong>${fl.net < 0 ? '−' : ''}${money(Math.abs(fl.net))}</strong><span class="sub">${fl.save == null ? 'income − expenses' : `${fl.save}% of income kept`}</span></div>
        <div class="wkTile"><span>Work earned</span><strong>${money(fl.earned)}</strong><span class="sub">${fl.unpaidWork > 0 ? `${money(fl.unpaidWork)} not paid yet` : 'all paid'}</span></div>
      </div>
      ${pfSec('flow', 'Where it came from and went', `${fl.inCats.length + fl.outCats.length} categories`)}
      ${pfOpen.flow ? `<strong class="wkSub">Income</strong>${pfBars(fl.inCats, fl.inc)}<strong class="wkSub">Expenses</strong>${pfBars(fl.outCats, fl.out)}` : ''}
    </div>`;

  const aRows = sh.aLines.length ? sh.aLines.map(a => `<div class="wkRow"${a.id ? ` data-pf="edit" data-id="${esc(a.id)}" style="cursor:pointer"` : ''}><div><strong>${esc(a.name)}</strong><span class="sub">${esc(a.cat || '')}${a.on ? ' · updated ' + fmtShort(a.on) : ''}</span></div><div class="wkAmt"><b>${money(a.amt)}</b></div></div>`).join('') : '<div class="sub">No assets yet. Add cash, accounts, vehicles, property or investments.</div>';
  const dRows = sh.dLines.filter(d => !d.id).map(d => `<div class="wkRow"><div><strong>${esc(d.name)}</strong><span class="sub">${esc(d.cat)}</span></div><div class="wkAmt"><b>${money(d.amt)}</b></div></div>`).join('');
  const sheet = `<div class="sectionHead"><h2>Net worth</h2><span class="sub">Today: what you own − what you owe</span></div>
    <div class="card wkList">
      <div class="wkTiles">
        <div class="wkTile"><span>Assets</span><strong>${money(sh.A)}</strong><span class="sub">${money(sh.liquid)} cash &amp; bank</span></div>
        <div class="wkTile"><span>Owed</span><strong>${money(sh.D)}</strong><span class="sub">debts + unpaid bills</span></div>
        <div class="wkTile ${sh.net >= 0 ? 'over' : 'pfNeg'}"><span>Net worth</span><strong>${sh.net < 0 ? '−' : ''}${money(Math.abs(sh.net))}</strong></div>
        <div class="wkTile"><span>Next 30 days</span><strong>${money(soon.out)}</strong><span class="sub">due out · ${money(soon.inc)} set to come in</span></div>
      </div>
      ${pfTrendHTML()}
      ${pfSec('sheet', 'Assets', `${sh.aLines.length} · ${money(sh.A)}`)}
      ${pfOpen.sheet ? `<div class="wkJobBtns"><button class="ghost" data-pf="add" data-k="asset">+ Asset</button></div>${aRows}` : ''}
      ${pfSec('debts', 'Debts', `${sh.dLines.length} · ${money(sh.D)}`)}
      ${pfOpen.debts ? `<div class="wkJobBtns"><button class="ghost" data-pf="add" data-k="debt">+ Debt</button></div>
        ${sh.bal > 0 ? `<div class="sub" style="margin:4px 0 6px">${money(sh.minPay)}/mo minimums · about ${money(sh.interest)}/mo interest · ${sh.apr}% average APR</div>` : ''}
        ${pf.items.filter(i => i.kind === 'debt').sort((a, b) => (+b.apr || 0) - (+a.apr || 0)).map(i => {
          const orig = +i.orig || 0, pct = orig > 0 ? Math.min(100, Math.max(0, Math.round((orig - (+i.amount || 0)) / orig * 100))) : 0;
          return `<div class="wkJob"><div class="wkRow" data-pf="edit" data-id="${esc(i.id)}" style="cursor:pointer"><div><strong>${esc(i.name)}</strong><span class="sub">${esc(i.cat || '')}${+i.apr ? ` · ${+i.apr}% APR` : ''}${+i.minPay ? ` · ${money(i.minPay)}/mo` : ''}${+i.dueDay ? ` · due the ${pfOrd(+i.dueDay)}` : ''} · ${pfMonths(pfPayoff(i))}</span></div><div class="wkAmt"><b>${money(i.amount)}</b>${orig > 0 ? `<span class="sub">${pct}% paid</span>` : ''}</div></div>
            ${orig > 0 ? `<div class="billBar"><span style="width:${pct}%"></span></div>` : ''}
            ${+i.amount > 0 ? `<div class="row" style="margin:6px 0 4px"><button class="ghost" data-pf="payDebt" data-id="${esc(i.id)}">💵 Pay</button></div>` : ''}</div>`;
        }).join('')}${dRows}${!sh.dLines.length ? '<div class="sub">No debts. Add credit cards, loans or anything you owe.</div>' : ''}` : ''}
    </div>`;

  const reps = pf.items.filter(i => (i.kind === 'income' || i.kind === 'expense') && i.repeat && i.repeat !== 'none');
  const repeat = `<div class="card wkList">${pfSec('repeat', 'Repeating income and expenses', `${reps.length}`)}
    ${pfOpen.repeat ? (reps.map(i => `<div class="wkRow" data-pf="edit" data-id="${esc(i.id)}" style="cursor:pointer"><div><strong>${PF_ICON[i.kind]} ${esc(i.name)}</strong><span class="sub">${esc(i.cat || '')} · ${pfRepLabel(i)} from ${fmtShort(i.on)}${i.until ? ' to ' + fmtShort(i.until) : ''}</span></div><div class="wkAmt"><b>${i.kind === 'expense' ? '−' : '+'}${money(i.amount)}</b></div></div>`).join('') || '<div class="sub">Nothing repeating. Set “Repeats” on an income or expense, like rent or a weekly side gig.</div>') : ''}</div>`;

  const shown = fl.rows.slice(0, 200);
  const act = `<div class="sectionHead"><h2>Activity</h2><span class="sub">${fl.rows.length} in ${esc(r.label)}</span></div>
    <div class="card wkList">${pfSec('activity', 'Every entry', fl.rows.length > shown.length ? `showing ${shown.length}` : '')}
    ${pfOpen.activity ? (shown.map(x => `<div class="wkRow"${x.id ? ` data-pf="edit" data-id="${esc(x.id)}" style="cursor:pointer"` : ''}><div><strong>${esc(x.title)}</strong><span class="sub">${esc(x.cat)} · ${fmtShort(x.on)} · ${x.src}</span></div><div class="wkAmt"><b class="${x.dir === 'in' ? 'pfIn' : ''}">${x.dir === 'in' ? '+' : '−'}${money(x.amt)}</b></div></div>`).join('') || '<div class="empty">No money in or out in this period.</div>') : ''}</div>`;

  body.innerHTML = flow + sheet + repeat + act;
}

/* ---------- Add / edit dialog ---------- */
function pfOpenForm(kind, id, debtId) {
  const it = id ? pf.items.find(x => x.id === id) : null; kind = it ? it.kind : kind;
  const f = $('#pfForm'); f.reset(); f.pid.value = it ? it.id : ''; f.kind.value = kind;
  $('#pfTitle').textContent = (it ? 'Edit ' : 'Add ') + { income: 'income', expense: 'expense', asset: 'asset', debt: 'debt' }[kind];
  f.cat.innerHTML = PF_CATS[kind].map(c => `<option>${esc(c)}</option>`).join('');
  f.repeat.innerHTML = PF_REPEAT.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const debts = pf.items.filter(i => i.kind === 'debt');
  f.debt.innerHTML = '<option value="">No</option>' + debts.map(d => `<option value="${esc(d.id)}">${esc(d.name)} (${money(d.amount)})</option>`).join('');
  $$('#pfForm [data-for]').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(kind) || (el.dataset.for.includes('debtpick') && !debts.length && kind === 'expense'); });
  $('#pfAmtLbl').textContent = { income: 'Amount', expense: 'Amount', asset: 'Value today', debt: 'Balance owed today' }[kind];
  $('#pfDateLbl').firstChild.textContent = { income: 'Date', expense: 'Date', asset: 'Value as of', debt: 'Balance as of' }[kind];
  f.on.value = ymd(new Date()); f.repeat.value = 'none';
  if (it) {
    f.name.value = it.name || ''; if (![...f.cat.options].some(o => o.value === it.cat) && it.cat) f.cat.insertAdjacentHTML('beforeend', `<option>${esc(it.cat)}</option>`); f.cat.value = it.cat || PF_CATS[kind][0];
    f.amount.value = it.amount ?? ''; f.on.value = it.on || ymd(new Date()); f.repeat.value = it.repeat || 'none'; f.until.value = it.until || '';
    f.apr.value = it.apr ?? ''; f.minPay.value = it.minPay ?? ''; f.dueDay.value = it.dueDay ?? ''; f.orig.value = it.orig ?? ''; f.note.value = it.note || ''; f.debt.value = it.debt || '';
  } else if (debtId) {
    const d = pf.items.find(x => x.id === debtId);
    f.cat.value = 'Debt payment'; f.debt.value = debtId; f.name.value = d ? d.name + ' payment' : ''; if (d && +d.minPay) f.amount.value = Math.min(+d.minPay, +d.amount || 0).toFixed(2);
  }
  $('#pfUntilRow').hidden = kind !== 'income' && kind !== 'expense' || f.repeat.value === 'none';
  $('#pfDel').hidden = !it;
  $('#pfDialog').showModal(); setTimeout(() => f.name.focus({ preventScroll: true }), 50);
}
/* A payment linked to a debt lowers that debt's balance; editing or deleting it puts the difference back */
function pfDebtAdjust(debtId, delta) { const d = pf.items.find(x => x.id === debtId && x.kind === 'debt'); if (d) d.amount = wRound(Math.max(0, (+d.amount || 0) - delta)); }
$('#pfForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, kind = f.kind.value;
  const amt = wRound(+f.amount.value || 0);
  if (!f.name.value.trim()) { toast('Give it a name'); return; }
  if (!(amt >= 0)) { toast('Enter an amount'); return; }
  let it = f.pid.value ? pf.items.find(x => x.id === f.pid.value) : null;
  if (it && it.kind === 'expense' && it.debt) pfDebtAdjust(it.debt, -(+it.amount || 0));   /* undo the old payment first */
  const rec = { kind, name: f.name.value.trim().slice(0, 60), cat: f.cat.value, amount: amt, on: f.on.value || ymd(new Date()), note: f.note.value.trim().slice(0, 120) };
  if (kind === 'income' || kind === 'expense') { rec.repeat = f.repeat.value; rec.until = rec.repeat !== 'none' && f.until.value ? f.until.value : ''; }
  if (kind === 'expense') rec.debt = f.debt.value || '';
  if (kind === 'debt') { rec.apr = f.apr.value === '' ? '' : +f.apr.value; rec.minPay = f.minPay.value === '' ? '' : +f.minPay.value; rec.dueDay = f.dueDay.value === '' ? '' : Math.min(31, Math.max(1, +f.dueDay.value)); rec.orig = f.orig.value === '' ? (it?.orig || amt) : +f.orig.value; }
  if (rec.debt && rec.repeat !== 'none') { rec.debt = ''; toast('Repeating payments don’t lower the debt balance automatically. Update the balance when it changes.'); }
  if (it) Object.assign(it, rec); else { it = { id: uuid(), ...rec }; pf.items.push(it); }
  if (it.kind === 'expense' && it.debt) pfDebtAdjust(it.debt, amt);
  pfSave(); $('#pfDialog').close(); renderPortfolio(); toast('Saved');
});
$('#pfForm').repeat.addEventListener('change', e => { $('#pfUntilRow').hidden = e.target.value === 'none'; });
$('#pfForm').cat.addEventListener('change', e => { const f = $('#pfForm'); if (f.kind.value === 'expense' && e.target.value !== 'Debt payment' && f.debt.value && !f.pid.value) f.debt.value = ''; });
$('#pfDel').addEventListener('click', () => {
  const f = $('#pfForm'), it = pf.items.find(x => x.id === f.pid.value); if (!it) return;
  const links = it.kind === 'debt' ? pf.items.filter(x => x.debt === it.id).length : 0;
  if (!confirm(`Delete “${it.name}”?${links ? ` Its ${links} payment${links === 1 ? '' : 's'} stay as expenses.` : ''}${it.kind === 'expense' && it.debt ? ' The amount goes back onto the debt.' : ''}`)) return;
  if (it.kind === 'expense' && it.debt) pfDebtAdjust(it.debt, -(+it.amount || 0));
  if (links) pf.items.forEach(x => { if (x.debt === it.id) x.debt = ''; });
  pf.items = pf.items.filter(x => x.id !== it.id); pfSave(); $('#pfDialog').close(); renderPortfolio();
});

/* ---------- Export ---------- */
function pfCSV() {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const r = wRange(pfPer, pfOff), fl = pfFlow(r), sh = pfSheet();
  const L = [`Kayaos portfolio,${q(r.label)}`, '', 'Summary,Amount', `Income,${fl.inc}`, `Expenses,${fl.out}`, `Left over,${fl.net}`, `Assets,${sh.A}`, `Owed,${sh.D}`, `Net worth,${sh.net}`,
    '', 'Assets,Category,Value', ...sh.aLines.map(a => [a.name, a.cat, a.amt].map(q).join(',')),
    '', 'Debts,Category,Balance,APR,Min payment', ...sh.dLines.map(d => [d.name, d.cat, d.amt, d.it?.apr ?? '', d.it?.minPay ?? ''].map(q).join(',')),
    '', 'Date,In/Out,Amount,Name,Category,Source', ...[...fl.rows].reverse().map(x => [x.on, x.dir === 'in' ? 'In' : 'Out', x.amt, x.title, x.cat, x.src].map(q).join(','))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv' })); a.download = `kayaos-portfolio-${ymd(new Date())}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Portfolio exported as CSV');
}

/* ---------- Wiring ---------- */
$('[data-view="money"]').addEventListener('click', e => {
  const b = e.target.closest('[data-pf]'); if (!b) return; const k = b.dataset.pf;
  if (k === 'per') { pfPer = b.dataset.v; pfOff = 0; renderPortfolio(); }
  else if (k === 'nav') { if (!b.disabled) { pfOff = Math.min(0, pfOff + (+b.dataset.d)); renderPortfolio(); } }
  else if (k === 'sec') { pfOpen[b.dataset.v] = !pfOpen[b.dataset.v]; renderPortfolio(); }
  else if (k === 'add') pfOpenForm(b.dataset.k);
  else if (k === 'edit') pfOpenForm(null, b.dataset.id);
  else if (k === 'payDebt') pfOpenForm('expense', null, b.dataset.id);
  else if (k === 'csv') pfCSV();
  else if (k === 'sync') workSync(true);
});
