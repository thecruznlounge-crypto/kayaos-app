/* Kayaos.space — app logic (loaded by index.html after Supabase + Leaflet) */
'use strict';
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- Storage ---------- */
const K = { tasks: 'kayaos.v4.tasks', theme: 'kayaos.theme', locs: 'kayaos.locations', settings: 'kayaos.settings', notified: 'kayaos.notified' };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

const CATS = ['Work', 'Personal', 'School', 'Errands', 'Groceries', 'Bills', 'Appointments', 'Travel', 'Family', 'Health'];
let settings = Object.assign({ name: '', studentName: '', voiceURI: '', voiceGender: 'female', voiceAccent: 'auto', voiceEngine: 'auto', cloudVoice: '', quietStart: '21:30', quietEnd: '07:00', alert: 'both', tracking: false, barCats: [] }, load(K.settings, {}));
let tasks = load(K.tasks, []).map(normalize);
let locs = load(K.locs, []);
let notified = new Set(load(K.notified, []));
let view = 'cards', selectedCat = 'All', selectedDay = startOfDay(new Date()), weekOffset = 0;
let editingId = null, geoTimer = null, deferredPrompt = null;

const saveTasks = () => { store(K.tasks, tasks); pushNative(); };
const saveLocs = () => { locs = locs.slice(0, 25); store(K.locs, locs); };
const saveSettings = () => { store(K.settings, settings); pushNative(); };

/* Make every card (old or new) have the same shape */
function normalize(t) {
  const hasDue = t.hasDue ?? !!t.date;
  return {
    id: t.id || uuid(), title: t.title || 'Untitled', category: t.category || 'Personal',
    hasDue, date: hasDue ? (t.date || ymd(new Date())) : '', time: hasDue ? (t.time || '09:00') : '',
    repeat: t.repeat || 'none', reminder: +(t.reminder ?? 15), alert: t.alert || settings.alert || 'both', nag: +(t.nag || 0),
    forName: t.forName || '', place: t.place || '', gps_coordinates: t.gps_coordinates || null, notes: t.notes || '',
    startDate: t.startDate || '', startTime: t.startDate ? (t.startTime || '00:00') : '',
    teamId: t.teamId || null, assignedTo: t.teamId ? (t.assignedTo || null) : null, completedBy: t.completedBy || null,
    checklist: Array.isArray(t.checklist) ? t.checklist.filter(i => i && i.t).map(i => ({ t: String(i.t).slice(0, 80), d: !!i.d })) : [], nearMe: !!t.nearMe,
    media: Array.isArray(t.media) ? t.media.filter(m => m && m.id) : [], proof: !!t.proof, doneAt: t.doneAt || null, amount: t.amount > 0 ? Math.round(+t.amount * 100) / 100 : 0, conf: String(t.conf || '').trim().toUpperCase().slice(0, 40), flightNo: fmtFlight(t.flightNo), installments: t.repeat && t.repeat !== 'none' && +t.installments > 0 ? Math.min(120, Math.floor(+t.installments)) : 0, review: t.review && t.review.for ? { for: String(t.review.for), state: t.review.state === 'redo' ? 'redo' : 'ok', by: t.review.by || null, at: +t.review.at || Date.now(), note: String(t.review.note || '').slice(0, 140) } : null, payments: Array.isArray(t.payments) ? t.payments.filter(p => p && p.for).slice(-200).map(p => ({ for: String(p.for), on: String(p.on || ''), amount: +p.amount || 0, ref: String(p.ref || '').slice(0, 40) })) : [], terminal: String(t.terminal || '').trim().replace(/^terminal\s*/i, '').toUpperCase().slice(0, 20), checkin: !!t.checkin, link: cleanLink(t.link), payApp: t.payApp && t.payApp.pkg ? { pkg: String(t.payApp.pkg).slice(0, 200), name: String(t.payApp.name || t.payApp.pkg).slice(0, 60) } : null,
    done: !!t.done, doneFor: t.doneFor || null, demo: !!t.demo, createdAt: t.createdAt || Date.now(), user_id: t.user_id || null
  };
}

/* ---------- Helpers ---------- */
function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })); }
const pad = n => String(n).padStart(2, '0');
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(+n || 0);
const isBill = c => /bill|pay|rent|loan|insurance/i.test(String(c || ''));
/* Links on cards: websites (https), phone numbers (tel:), email (mailto:). Anything else — e.g. javascript: — is refused. */
function cleanLink(v) {
  v = String(v || '').trim().replace(/\s+/g, ''); if (!v) return '';
  if (/^(tel|sms):/i.test(v)) { const n = v.slice(v.indexOf(':') + 1).replace(/[^\d+*#,;]/g, ''); return n ? v.slice(0, v.indexOf(':')).toLowerCase() + ':' + n : ''; }
  if (/^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(v)) return v.slice(0, 500);
  if (/^[+(]?\d[\d().\-]{6,}$/.test(v)) return 'tel:' + v.replace(/[^\d+]/g, '');
  if (/^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i.test(v)) return 'mailto:' + v;
  if (/^\/\//.test(v)) v = 'https:' + v;
  else if (!/^https?:\/\//i.test(v)) { if (/^[a-z][\w+.\-]*:(?!\d)/i.test(v)) return ''; v = 'https://' + v; }
  try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return ''; return u.href.slice(0, 500); } catch (e) { return ''; }
}
const linkHost = l => { if (/^tel:/.test(l)) return l.slice(4); if (/^sms:/.test(l)) return 'Text ' + l.slice(4); if (/^mailto:/.test(l)) return l.slice(7); try { return new URL(l).hostname.replace(/^www\./, ''); } catch (e) { return l; } };
const isTravel = c => /travel|trip|flight|vacation|hotel|cruise/i.test(String(c || ''));
/* Quick picks for travel cards: [name, website, kind, other app name] */
const TRAVEL = [['American', 'aa.com', 'air', 'American Airlines'], ['Delta', 'delta.com', 'air', 'Fly Delta'], ['United', 'united.com', 'air', 'United Airlines'], ['Southwest', 'southwest.com', 'air', 'Southwest Airlines'], ['JetBlue', 'jetblue.com', 'air'], ['Frontier', 'flyfrontier.com', 'air', 'Frontier Airlines'],
  ['Marriott', 'marriott.com', 'stay', 'Marriott Bonvoy'], ['Hilton', 'hilton.com', 'stay', 'Hilton Honors'], ['Airbnb', 'airbnb.com', 'stay'], ['Expedia', 'expedia.com', 'stay'], ['Uber', 'uber.com', 'ride'], ['Lyft', 'lyft.com', 'ride']];
const AIR_CODE = { American: 'AA', Delta: 'DL', United: 'UA', Southwest: 'WN', JetBlue: 'B6', Frontier: 'F9', Alaska: 'AS', Allegiant: 'G4', Breeze: 'MX', 'Sun Country': 'SY', Spirit: 'NK' };
/* "dl1234" / "DL 1234" → "DL 1234"; digits only stay digits (the airline code is added on save if known) */
function fmtFlight(v) { const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); const m = s.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/); return m && /[A-Z]/.test(m[1]) ? `${m[1]} ${m[2]}` : s; }
/* Live gate / terminal / delay info: a flight-status search (no paid service needed) */
const flightStatusURL = t => `https://www.google.com/search?q=${encodeURIComponent(t.flightNo.replace(' ', '') + ' flight status')}`;
const isGrocery = c => /grocer|supermarket/i.test(String(c || ''));
/* Quick picks for grocery cards: [name, website, kind, other app name] */
const STORES = [['Publix', 'publix.com', 'store'], ['Walmart', 'walmart.com', 'store'], ['Target', 'target.com', 'store'], ['Costco', 'costco.com', 'store'], ["Sam's Club", 'samsclub.com', 'store'], ["BJ's", 'bjs.com', 'store', "BJ's Wholesale Club"], ['Aldi', 'aldi.us', 'store', 'ALDI'], ['Kroger', 'kroger.com', 'store'], ['Winn-Dixie', 'winndixie.com', 'store'], ['Whole Foods', 'wholefoodsmarket.com', 'store', 'Whole Foods Market'], ["Trader Joe's", 'traderjoes.com', 'store'], ['Instacart', 'instacart.com', 'delivery']];
function storePick(t) {
  const host = t.link ? linkHost(t.link) : '';
  return STORES.find(x => host && (host === x[1] || host.endsWith('.' + x[1]))) || (t.payApp && STORES.find(x => [x[0], x[3]].some(n => n && normName(t.payApp.name).startsWith(normName(n))))) || null;
}
const pickHref = host => host === 'cash.app' ? 'https://cash.app/' : 'https://www.' + host + '/';
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/* Which travel pick (if any) a card points to — by its link or its chosen app */
function travelPick(t) {
  const host = t.link ? linkHost(t.link) : '';
  return TRAVEL.find(x => host && (host === x[1] || host.endsWith('.' + x[1]))) || (t.payApp && TRAVEL.find(x => [x[0], x[3]].some(n => n && normName(t.payApp.name).startsWith(normName(n))))) || null;
}
/* Directions: Google Maps (Android/desktop) or Apple Maps (iPhone) */
const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
function directionsURL(t) {
  /* Typed addresses go to Maps as text, so Maps finds the place itself. Map coordinates come from a free geocoder
     and can land on a different spot, so they're only used when there's no address (a pinned location). */
  const c = coordFromTask(t), dest = t.place ? t.place : (c ? `${c.lat},${c.lng}` : ''); if (!dest) return '';
  return isApple() && !window.KayaosNative ? `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
/* Opening links: Android app → in-app browser tab (Custom Tab, back = Kayaos); installed PWA → opens inside the
   Kayaos window with a close (×) bar; regular browser tab → new tab. Phone/text/email always go to the phone's app.
   Sign-ins stay saved in the phone's browser + password manager, so you log in to each site once. */
const isStandalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
function openOutside(url) { if (!url) return; if (window.KayaosNative || isStandalone() || /^(tel|sms|mailto):/.test(url)) location.href = url; else window.open(url, '_blank', 'noopener'); }
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) {}
  try { const ta = document.createElement('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
}
/* Quick picks for bill cards (website; the Android app also finds the matching app on the phone) */
const BILLERS = [['PayPal', 'paypal.com'], ['Venmo', 'venmo.com'], ['Cash App', 'cash.app'], ['Zelle', 'zellepay.com'], ['Chase', 'chase.com'], ['Bank of America', 'bankofamerica.com'], ['Wells Fargo', 'wellsfargo.com'], ['Capital One', 'capitalone.com'], ['Citi', 'citi.com'], ['Amex', 'americanexpress.com', 'American Express'], ['Discover', 'discover.com'], ['FPL', 'fpl.com'], ['Xfinity', 'xfinity.com'], ['Spectrum', 'spectrum.net'], ['T-Mobile', 't-mobile.com'], ['Verizon', 'verizon.com'], ['AT&T', 'att.com'], ['Geico', 'geico.com'], ['Progressive', 'progressive.com'], ['State Farm', 'statefarm.com']];
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
function fmtTime(t) { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; }
const fmtDate = d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
function dur(ms) { const m = Math.max(0, Math.round(ms / 60000)); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 48) return `${h}h ${m % 60}m`; return `${Math.floor(h / 24)}d ${h % 24}h`; }
function durSpoken(ms) {
  const m = Math.max(1, Math.round(ms / 60000)); const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (m < 60) return pl(m, 'minute'); const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${pl(h, 'hour')} and ${pl(r, 'minute')}` : pl(h, 'hour'); return pl(Math.round(h / 24), 'day');
}
let toastTimer;
function toast(m) { const e = $('#toast'); e.textContent = m; e.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('show'), 2600); }

/* ---------- Occurrences, completion, urgency ---------- */
const parseDT = t => new Date(`${t.date}T${t.time || '09:00'}`);
function step(d, repeat, n = 1) { const x = new Date(d); if (repeat === 'daily') x.setDate(x.getDate() + n); else if (repeat === 'weekly') x.setDate(x.getDate() + 7 * n); else if (repeat === 'biweekly') x.setDate(x.getDate() + 14 * n); else if (repeat === 'monthly') x.setMonth(x.getMonth() + n); return x; }
/* Which occurrence (0, 1, 2…) a date is for a repeating card, or -1 if it isn't one */
function occIndex(t, date) {
  if (!t.hasDue) return -1; const first = parseDT(t);
  const d0 = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate()), d1 = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  if (d1 < d0) return -1; const days = Math.round((d1 - d0) / 864e5);
  if (t.repeat === 'none') return days === 0 ? 0 : -1;
  if (t.repeat === 'daily') return days;
  if (t.repeat === 'weekly') return days % 7 ? -1 : days / 7;
  if (t.repeat === 'biweekly') return days % 14 ? -1 : days / 14;
  if (t.repeat === 'monthly') return date.getDate() === first.getDate() ? (date.getFullYear() - first.getFullYear()) * 12 + date.getMonth() - first.getMonth() : -1;
  return -1;
}
/* An installment plan ends after its last payment */
function planLast(t) { return t.installments > 0 && t.hasDue && t.repeat !== 'none' ? step(parseDT(t), t.repeat, t.installments - 1) : null; }
function nextOcc(t, from = new Date()) { if (!t.hasDue) return null; let d = parseDT(t); if (t.repeat === 'none') return d; while (d < from) d = step(d, t.repeat); const last = planLast(t); return last && d > last ? null : d; }
function prevOcc(t, from = new Date()) { if (!t.hasDue) return null; const first = parseDT(t); if (t.repeat === 'none') return first <= from ? first : null; const n = nextOcc(t, from); if (!n) { const last = planLast(t); return last && last <= from ? last : null; } const p = step(n, t.repeat, -1); return p >= first ? p : null; }
/* The occurrence that matters right now: an unfinished one from the last 12h, else the next one */
function relevantOcc(t, now = new Date()) {
  if (!t.hasDue) return null; if (t.repeat === 'none') return parseDT(t);
  const p = prevOcc(t, now); if (p && !isDoneOn(t, p) && now - p < 12 * 36e5) return p; return nextOcc(t, now);
}
/* Start of the current occurrence (repeating cards keep the same lead time before each due) */
function startOf(t, occ = relevantOcc(t)) {
  if (!t.startDate) return null; const s0 = new Date(`${t.startDate}T${t.startTime || '00:00'}`);
  if (t.hasDue && t.repeat !== 'none' && occ) return new Date(occ - (parseDT(t) - s0));
  return s0;
}
const fmtClock = d => fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
/* A bill counts as done for an occurrence when it's paid in full (payments are the source of truth) */
function isDoneOn(t, date) {
  if (t.repeat === 'none' || !t.hasDue) return t.done;
  if (isBill(t.category) && billDue(t) > 0) return paidFor(t, ymd(date)) >= billDue(t) - 0.005;
  return t.doneFor === ymd(date);
}
function isDone(t) { const o = relevantOcc(t); return o ? isDoneOn(t, o) : t.done; }
function occursOn(t, date) {
  if (!t.hasDue) return false; const target = ymd(date);
  if (t.repeat === 'none') return t.date === target;
  if (target < t.date) return false; const i = occIndex(t, date); return i >= 0 && (!t.installments || i < t.installments);
}
function urgency(t, now = new Date()) {
  if (isDone(t)) return 'done'; const o = relevantOcc(t, now); if (!o) return 'nodue';
  const h = (o - now) / 36e5; if (h < 0) return 'missed'; if (h <= 1) return 'hot'; if (h <= 3) return 'urgent'; if (h <= 24) return 'soon'; return 'low';
}
/* Quiet hours: "keep reminding until done" repeats stay silent overnight (reminders you set for a time still ring) */
function inQuietHours(d) {
  const qs = settings.quietStart, qe = settings.quietEnd; if (!qs || !qe || qs === qe) return false;
  const m = d.getHours() * 60 + d.getMinutes(), toMin = s => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm; }, a = toMin(qs), b = toMin(qe);
  return a < b ? (m >= a && m < b) : (m >= a || m < b);
}
const LEVEL = { done: 'Done', nodue: 'No due date', missed: 'Missed', hot: 'Critical', urgent: 'Urgent', soon: 'Soon', low: 'Low' };
const REPEAT_MS = { daily: 864e5, weekly: 7 * 864e5, biweekly: 14 * 864e5, monthly: 30 * 864e5 };
/* Heat from time left alone: 3+ days = cool, 24h = yellow, 3h = orange, 1h = red, due = deep red */
function timeHeat(ms) {
  const h = ms / 36e5, pts = [[72, 0], [24, 40], [3, 65], [1, 85], [0, 97]];
  if (h <= 0) return 100; if (h >= 72) return 0;
  for (let i = 1; i < pts.length; i++) { const [h1, p1] = pts[i - 1], [h2, p2] = pts[i]; if (h >= h2) return p2 + (p1 - p2) * (h - h2) / (h1 - h2); }
  return 97;
}
/* Smooth card color for a heat value 0–100 (green → yellow → orange → red → burgundy) */
const HEAT_STOPS = [[0, [155, 231, 177]], [40, [255, 225, 106]], [65, [255, 179, 71]], [85, [255, 90, 79]], [100, [139, 30, 30]]];
function heatColor(p) {
  p = Math.max(0, Math.min(100, p)); let i = 1; while (i < HEAT_STOPS.length - 1 && p > HEAT_STOPS[i][0]) i++;
  const [a, ca] = HEAT_STOPS[i - 1], [b, cb] = HEAT_STOPS[i], k = (p - a) / (b - a || 1);
  const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * k)), lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return { bg: `rgb(${c.join(',')})`, dark: lum < 0.42 };
}
/* Per-card urgency meter: the larger of "share of the start→due window used" and "how little time is left" */
function meter(t, now = new Date()) {
  const u = urgency(t, now), o = relevantOcc(t, now), s = startOf(t, o);
  if (u === 'done') return { u, pct: 100, text: 'Completed' };
  if (s && now < s) return { u, pct: 0, label: 'Not started', text: `Starts in ${dur(s - now)}` };
  if (u === 'nodue') return { u, pct: 0, text: s ? `Started ${dur(now - s)} ago` : 'Anytime' };
  const rem = o - now; if (rem < 0) return { u, pct: 100, text: `${dur(-rem)} overdue` };
  const win = s ? Math.max(60000, o - s) : t.repeat !== 'none' ? REPEAT_MS[t.repeat] : Math.max(36e5, o - t.createdAt);
  const pct = Math.min(100, Math.max(4, (1 - rem / win) * 100, timeHeat(rem)));
  return { u, pct, text: `Due in ${dur(rem)}` };
}
const billDue = t => +t.amount || 0;
const paidFor = (t, key) => t.payments.filter(p => p.for === key).reduce((s, p) => s + (+p.amount || 0), 0);
/* The date a payment/undo applies to (null for one-off cards) */
const occDate = (t, onDate) => t.repeat === 'none' || !t.hasDue ? null : (onDate || relevantOcc(t) || planLast(t));
const payKey = (t, onDate) => { const d = occDate(t, onDate); return d ? ymd(d) : 'once'; };
/* An installment plan is done when every payment in it is paid */
function allPlanPaid(t) { for (let i = 0; i < t.installments; i++) if (paidFor(t, ymd(step(parseDT(t), t.repeat, i))) < billDue(t) - 0.005) return false; return true; }
function setPaidState(t, key, done) {
  if (key === 'once') { t.done = done; return; }
  t.doneFor = done ? key : null; if (t.installments) t.done = allPlanPaid(t);
}
async function toggleDone(t, onDate, pay) {
  if (t.proof && !isDone(t) && !hasProof(t)) {
    pendingProofDone = t.id; openMediaChooser(t.id, 'proof', true); return;
  }
  const od = occDate(t, onDate), key = od ? ymd(od) : 'once', wasDone = od ? isDoneOn(t, od) : t.done;
  /* Bills: ask for amount / date / reference first. A bill can be paid in parts; it's done when paid in full */
  if (isBill(t.category) && !wasDone && pay === undefined) { openPayDialog(t, onDate); return; }
  if (isBill(t.category) && !wasDone) {
    t.payments.push({ for: key, ...pay }); t.payments = t.payments.slice(-200);
    setPaidState(t, key, paidFor(t, key) >= billDue(t) - 0.005);
    const left = Math.max(0, billDue(t) - paidFor(t, key));
    if (!isDone(t)) toast(`Partly paid · ${money(left)} left${pay.ref ? ' · Ref ' + pay.ref : ''}`);
    else toast(`Marked paid${pay.ref ? ' · Ref ' + pay.ref : ''}`);
    /* Say it out loud too, so the amount update is acknowledged even with the phone in a pocket */
    speak(isDone(t) ? `Payment of ${money(pay.amount)} recorded. ${t.title} is paid in full.`
      : `Payment of ${money(pay.amount)} recorded for ${t.title}. ${money(left)} left.`);
  } else {
    if (isBill(t.category)) t.payments = t.payments.filter(p => p.for !== key); /* undo removes that bill's payments */
    setPaidState(t, key, !wasDone);
  }
  if (!wasDone && t.review && t.review.for === key) t.review = null; /* new completion → needs a fresh review */
  t.completedBy = isDone(t) ? myId() : null; t.doneAt = isDone(t) ? Date.now() : null;
  saveTasks(); render(); pushTask(t);
  if (isDone(t) && t.category === 'School') { const n = t.forName || settings.studentName; speak(`Nice work${n ? ', ' + n : ''}! ${t.title} is done.`); }
}

/* "Mark as paid" sheet for bills */
let payCtx = null;
function openPayDialog(t, onDate) {
  const key = payKey(t, onDate); payCtx = { id: t.id, onDate, key }; const f = $('#payForm'), o = t.hasDue ? (onDate ? new Date(`${ymd(onDate)}T${t.time}`) : relevantOcc(t) || planLast(t)) : null;
  const idx = t.installments && o ? occIndex(t, o) : -1, left = billDue(t) - paidFor(t, key);
  $('#payTitle').textContent = `Pay “${t.title}”`; $('#payFor').textContent = o ? `Bill due ${fmtDate(o)} • ${fmtTime(t.time)}` : '';
  $('#payPlan').textContent = idx >= 0 ? `Installment ${idx + 1} of ${t.installments}` : '';
  f.amount.value = left > 0.005 ? left.toFixed(2) : ''; f.on.value = ymd(new Date()); f.ref.value = '';
  updatePayLeft();
  if ($('#cardDialog').open) $('#cardDialog').close();
  $('#payDialog').showModal();
}
/* Shows what's left after the amount typed in the Pay sheet */
function updatePayLeft() {
  const t = payCtx && tasks.find(x => x.id === payCtx.id); if (!t) return;
  const left = billDue(t) - paidFor(t, payCtx.key) - (parseFloat($('#payForm').amount.value) || 0);
  $('#payLeft').textContent = left > 0.005 ? `Left after this payment: ${money(left)} — the bill stays open until it's paid in full.` : 'This pays it in full ✓';
}
$('#payForm').amount.addEventListener('input', updatePayLeft);
$('#payForm').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, t = payCtx && tasks.find(x => x.id === payCtx.id); if (!t) { $('#payDialog').close(); return; }
  const amt = parseFloat(f.amount.value) || 0; if (!(amt > 0)) { toast('Enter the amount you paid'); f.amount.focus(); return; }
  $('#payDialog').close();
  toggleDone(t, payCtx.onDate, { on: f.on.value || ymd(new Date()), amount: amt, ref: f.ref.value.trim().toUpperCase() });
});
const shortDay = s => s ? new Date(s + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
/* Bill status for the occurrence on the card: Paid / Unpaid / Overdue, plus the last payment */
/* "$30.00 paid of $100.00 · $70.00 left" with a bar. Installment plans also show the whole plan's progress */
function billProgressHTML(t) {
  if (!isBill(t.category) || !(billDue(t) > 0)) return '';
  const due = billDue(t), key = payKey(t), paid = Math.min(due, paidFor(t, key)), pct = Math.round(paid / due * 100), done = isDone(t);
  const planTotal = t.installments ? due * t.installments : 0, planPaid = t.installments ? Math.min(planTotal, t.payments.reduce((s, p) => s + (+p.amount || 0), 0)) : 0;
  const line = done ? `<b>${money(due)}</b> paid in full ✓` : `<b>${money(paid)}</b> paid of ${money(due)} · <b>${money(due - paid)}</b> left`;
  const plan = t.installments ? `<div class="sub">Whole plan: <b>${money(planPaid)}</b> of ${money(planTotal)} paid</div>` : '';
  return `<div class="billProg" role="progressbar" aria-label="Paid toward this bill" aria-valuemin="0" aria-valuemax="${due}" aria-valuenow="${paid}"><div class="billBar"><span style="width:${pct}%"></span></div><div class="billNums">${line}</div>${plan}</div>`;
}
function billStatusHTML(t) {
  if (!isBill(t.category) || !(t.hasDue || t.amount)) return '';
  const o = relevantOcc(t), key = payKey(t), done = isDone(t), due = billDue(t), paid = paidFor(t, key), p = t.payments.filter(x => x.for === key).slice(-1)[0];
  const last = [...t.payments].reverse().find(x => x.for !== key), idx = t.installments && o ? occIndex(t, o) : -1, plan = idx >= 0 ? `Installment ${idx + 1} of ${t.installments} · ` : '';
  const st = t.installments && t.done ? `<span class="chip st-paid">✓ All ${t.installments} installments paid</span>` : done ? `<span class="chip st-paid">✓ ${plan}Paid${p && p.on ? ' ' + shortDay(p.on) : ''}${p && p.ref ? ' · Ref ' + esc(p.ref) : ''}</span>`
    : paid > 0 && due > 0 ? `<span class="chip st-part">${plan}Partly paid ${money(paid)} · ${money(due - paid)} left</span>`
    : o && o < new Date() ? `<span class="chip st-late">⚠ ${plan}Overdue</span>` : `<span class="chip st-due">${plan}Unpaid</span>`;
  return st + (!done && last ? `<span class="chip">Last paid ${shortDay(last.on)}${last.amount ? ' · ' + money(last.amount) : ''}${last.ref ? ' · Ref ' + esc(last.ref) : ''}</span>` : '');
}
function payHistHTML(t) {
  if (!isBill(t.category) || !t.payments.length) return '';
  return `<div class="sub"><b>Payments</b></div><ul class="payHist">${[...t.payments].reverse().slice(0, 8).map(p => `<li><b>${shortDay(p.on)}</b>${p.amount ? `<span>${money(p.amount)}</span>` : ''}${p.ref ? `<span>Ref ${esc(p.ref)}</span>` : ''}${p.for !== 'once' ? `<span class="sub">for ${shortDay(p.for)} bill</span>` : ''}</li>`).join('')}</ul>`;
}

/* ---------- Rendering ---------- */
/* Cards are compact in lists; tapping one pops it up as a modal with every detail */
const CARD_OPTS = { listFull: false }; /* tests can render list cards in full */
function linkBtnHTML(t) {
  if (!t.link && !t.payApp) return '';
  const bill = isBill(t.category), l = t.link || '', tp = travelPick(t), app = t.payApp ? esc(t.payApp.name) : '';
  const sp = isGrocery(t.category) ? storePick(t) : null;
  const label = sp ? (sp[2] === 'delivery' ? `🛒 Order on ${app || esc(sp[0])}` : app ? `🛒 Shop in ${app}` : `🛒 Shop ${esc(sp[0])} ↗`)
    : isGrocery(t.category) && !t.payApp && /^https?:/.test(l) ? '🛒 Open store ↗' : tp && !bill ? (tp[2] === 'air' ? (app ? `✈️ Check in · ${app}` : '✈️ Check in ↗') : tp[2] === 'stay' ? (app ? `🏨 Booking · ${app}` : '🏨 View booking ↗') : `🚗 Open ${app || esc(tp[0])}`)
    : isTravel(t.category) && !t.payApp && /^https?:/.test(l) ? '🧳 Open trip ↗' : t.payApp ? `${bill ? '💳 Pay in ' : '📱 Open '}${esc(t.payApp.name)}` : /^tel:/.test(l) ? `📞 Call` : /^sms:/.test(l) ? '💬 Text' : /^mailto:/.test(l) ? '✉️ Email' : bill ? '💳 Pay now ↗' : `🔗 ${esc(linkHost(l))} ↗`;
  return `<button class="mini linkBtn" data-act="openLink" data-id="${t.id}" title="${esc(t.payApp ? t.payApp.name : linkHost(l))}">${label}</button>`;
}
function cardHTML(t, full = CARD_OPTS.listFull) {
  const m = meter(t), o = relevantOcc(t), cls = m.u, st = startOf(t, o), open = full;
  const due = t.hasDue ? (o && !(t.installments && t.done) ? `${t.repeat !== 'none' ? 'Next: ' : 'Due '}${fmtDate(o)} • ${fmtTime(t.time)}` : 'All installments paid') : 'No due date';
  const bg = m.pct ? `width:${m.pct.toFixed(1)}%;background-size:${(10000 / m.pct).toFixed(1)}% 100%` : 'width:0';
  const alertIcon = { both: '🔔🗣', chime: '🔔', voice: '🗣', silent: '🔕' }[t.alert] || '🔔';
  const heat = ['done', 'nodue'].includes(m.u) ? null : heatColor(m.pct);
  const left = t.checklist.filter(i => !i.d).length;
  /* always visible: the few things you need at a glance */
  const summary = `<span class="chip">${esc(t.category)}</span>${t.amount ? `<span class="chip amt">💵 ${money(t.amount)}</span>` : ''}${billStatusHTML(t)}${typeof workChip === 'function' ? workChip(t) : ''}${t.flightNo ? `<span class="chip conf" title="Entered by you — tap Live gate & status for the airline's current info">✈️ ${esc(t.flightNo)}${t.terminal ? ` · Terminal ${esc(t.terminal)}` : ''}</span>` : t.terminal ? `<span class="chip conf">Terminal ${esc(t.terminal)}</span>` : ''}${t.conf ? `<button class="chip conf" data-act="copyConf" data-id="${t.id}" title="Copy confirmation number">🎫 ${esc(t.conf)}</button>` : ''}${t.checklist.length ? `<span class="chip">☑ ${t.checklist.length - left}/${t.checklist.length}</span>` : ''}${t.proof ? `<span class="chip">${hasProof(t) ? '✓ proof added' : '📸 proof needed'}</span>` : ''}${t.media.length ? `<span class="chip">🖼 ${t.media.length}</span>` : ''}${t.teamId && t.assignedTo ? `<span class="chip">→ ${esc(memberName(t.teamId, t.assignedTo))}</span>` : ''}`;
  /* only when expanded */
  const details = `${t.nearMe ? '<span class="chip">📍 near-me</span>' : ''}${t.checkin && t.hasDue ? '<span class="chip">✈️ check-in reminder</span>' : ''}${t.hasDue ? `<span class="chip">${t.repeat !== 'none' ? '↻ ' + t.repeat : 'one-time'}</span><span class="chip">${alertIcon} ${reminderLabel(t.reminder)}${t.nag ? ` · every ${t.nag}m` : ''}</span>` : ''}${t.teamId ? `<span class="chip">👥 ${esc(teamName(t.teamId))}</span>` : ''}${t.forName && !t.teamId ? `<span class="chip">👤 ${esc(t.forName)}</span>` : ''}${t.teamId && t.completedBy && isDone(t) ? `<span class="chip">✓ by ${esc(memberName(t.teamId, t.completedBy))}</span>` : ''}${t.place || t.gps_coordinates ? `<button class="chip" data-act="map" data-id="${t.id}">⌖ ${esc(t.place || 'Pinned spot')}</button>` : ''}${t.payApp && t.link ? `<button class="chip" data-act="openWeb" data-id="${t.id}">🔗 ${esc(linkHost(t.link))} ↗</button>` : ''}`;
  return `<article class="task ${cls}${heat?.dark ? ' dark' : ''}${open ? ' open' : ' compact'}" data-id="${t.id}"${open ? '' : ` tabindex="0" role="button" aria-haspopup="dialog" aria-label="Open ${esc(t.title)}"`}${heat ? ` style="background:${heat.bg};color:${heat.dark ? '#fff' : '#1b1407'}"` : ''}>
  <div class="taskHead"><h3>${esc(t.title)}</h3>${t.demo ? '<span class="badge">Demo</span>' : ''}${open ? '' : '<span class="chev" aria-hidden="true">⤢</span>'}</div>
  <div class="sub">${due}</div>
  <div class="meter" role="meter" aria-label="Urgency" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(m.pct)}"><span style="${bg}"></span></div>
  <div class="meterLabel"><b>${m.label || LEVEL[m.u]}</b> · ${m.text}</div>
  <div class="meta">${summary}</div>
  ${billProgressHTML(t)}
  ${t.proof || lastProof(t) ? proofPeekHTML(t) : ''}
  ${open ? `<div class="more"><div class="moreIn">
    ${st ? `<div class="sub">Starts ${fmtDate(st)} • ${fmtClock(st)}</div>` : ''}
    ${details ? `<div class="meta">${details}</div>` : ''}
    ${t.checklist.length ? `<ul class="checklist">${t.checklist.map((i, k) => `<li><button class="chk ${i.d ? 'on' : ''}" data-act="chk" data-id="${t.id}" data-i="${k}" aria-pressed="${i.d}"><span class="box">${i.d ? '✓' : ''}</span><span class="ct">${esc(i.t)}</span></button></li>`).join('')}</ul>` : ''}
    ${t.flightNo || t.terminal ? '<div class="sub entered">✏️ Flight # and terminal are what you entered. 🛫 Live gate & status shows the airline’s current gate, terminal and delays.</div>' : ''}
    ${payHistHTML(t)}
    ${t.notes ? `<p class="notes">${esc(t.notes)}</p>` : ''}
    ${mediaStripHTML(t)}
    ${mediaExpiry(t) ? `<div class="sub keepNote">🗑 Photos & videos on this card are removed ${new Date(mediaExpiry(t)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${needsReview(t) ? ' — or 7 days after the proof is approved' : ''}.</div>` : ''}
    <div class="taskActions more-actions"><button class="mini" data-act="addProof" data-id="${t.id}" aria-label="Add photo or video" title="Add photo / video">📷</button><button class="mini" data-act="say" data-id="${t.id}" aria-label="Read aloud">🔊</button><button class="mini" data-act="edit" data-id="${t.id}" aria-label="Edit">✎</button>${canDelete(t) ? `<button class="mini" data-act="del" data-id="${t.id}" aria-label="Delete">×</button>` : ''}</div>
  </div></div>` : ''}
  <div class="taskActions">${linkBtnHTML(t)}${t.flightNo ? `<button class="mini linkBtn" data-act="flightStatus" data-id="${t.id}">🛫 Live gate & status</button>` : ''}${(open || !(t.link || t.payApp)) && (t.place || t.gps_coordinates) ? `<button class="mini dirBtn" data-act="directions" data-id="${t.id}">🧭 Directions</button>` : ''}${open || t.link || t.payApp || t.place || t.gps_coordinates ? '' : '<span class="hint">Tap for details</span>'}<button class="mini big" data-act="done" data-id="${t.id}">${isDone(t) ? '↺ Undo' : t.proof && !hasProof(t) ? '📸 Done' : isBill(t.category) ? '💵 Pay' : '✓ Done'}</button></div>
</article>`;
}
document.addEventListener('click', e => { const row = e.target.closest('.item[data-open]'); if (row && !e.target.closest('button')) openCardModal(row.dataset.open, row); });
/* Card modal: tap a compact card (anywhere but its buttons) to pop it up */
let modalCardId = null;
function openCardModal(id, fromEl) {
  const t = tasks.find(x => x.id === id); if (!t) { toast('That card was removed'); return; }
  modalCardId = id; renderCardModal();
  const d = $('#cardDialog'); if (!d.open) d.showModal();
  const box = d.getBoundingClientRect(), r = fromEl && fromEl.getBoundingClientRect ? fromEl.getBoundingClientRect() : null;
  d.style.transformOrigin = r ? `${r.left + r.width / 2 - box.left}px ${r.top + r.height / 2 - box.top}px` : 'center';
  d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop');
  setTimeout(() => hydrateThumbs($('#cardModalBody')), 0);
}
function renderCardModal() {
  const t = tasks.find(x => x.id === modalCardId);
  if (!t) { if ($('#cardDialog').open) $('#cardDialog').close(); return; }
  $('#cardModalBody').innerHTML = cardHTML(t, true);
  setTimeout(() => hydrateThumbs($('#cardModalBody')), 0);
}
$('#cardDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); }); /* tap the dimmed background */
$('#cardDialog').addEventListener('close', () => { modalCardId = null; });
document.addEventListener('click', e => {
  const card = e.target.closest('.task.compact'); if (!card || e.target.closest('button, a, input, label, select, textarea, .thumb, dialog')) return;
  openCardModal(card.dataset.id, card);
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('compact')) { e.preventDefault(); openCardModal(e.target.dataset.id, e.target); } });
/* Bills: this month's total, what's paid, what's left (shown when the list has bills with amounts) */
function billSummaryHTML(list) {
  if (!isBill(selectedCat)) return '';
  const bills = list.filter(t => t.amount > 0); if (!bills.length) return '';
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth(); let total = 0, paid = 0, late = 0;
  for (const t of bills) {
    /* One-off bills (no due date, or a single due date) keep their payments under 'once' or their due date: use the same key the card uses */
    if (!t.hasDue) { total += t.amount; paid += t.done ? t.amount : Math.min(t.amount, paidFor(t, payKey(t))); continue; }
    for (let d = new Date(y, mo, 1); d.getMonth() === mo; d.setDate(d.getDate() + 1)) {
      if (!occursOn(t, d)) continue; total += t.amount;
      const got = isDoneOn(t, d) ? t.amount : Math.min(t.amount, paidFor(t, payKey(t, d))); paid += got;
      if (!isDoneOn(t, d) && new Date(`${ymd(d)}T${t.time}`) < now) late += t.amount - got;
    }
  }
  let soon = 0, soonN = 0; const end = addDays(now, 30);
  for (const t of bills) { if (!t.hasDue) continue; for (let d = startOfDay(now); d <= end; d = addDays(d, 1)) if (occursOn(t, d) && !isDoneOn(t, d) && new Date(`${ymd(d)}T${t.time}`) >= now) { soon += t.amount - Math.min(t.amount, paidFor(t, payKey(t, d))); soonN++; } }
  if (!total && !soon) return '';
  const month = now.toLocaleDateString(undefined, { month: 'long' });
  const pctAll = total ? Math.min(100, Math.round(paid / total * 100)) : 0;
  return `<div class="billBox"><div class="billBar" style="grid-column:1/-1" role="progressbar" aria-label="Share of this month's bills paid" aria-valuenow="${pctAll}"><span style="width:${pctAll}%"></span></div><div><span class="sub">${month} bills</span><b>${money(total)}</b></div><div><span class="sub">Paid</span><b class="ok">${money(paid)}</b></div><div><span class="sub">Left</span><b>${money(total - paid)}</b></div>${late ? `<div><span class="sub">Overdue</span><b class="bad">${money(late)}</b></div>` : ''}<div class="wide"><span class="sub">Coming up — next 30 days</span><b>${money(soon)} · ${soonN} bill${soonN === 1 ? '' : 's'}</b></div></div>`;
}
function reminderLabel(min) { min = +min || 0; if (min === 0) return 'at due time'; if (min === 1440) return '1 day before'; if (min >= 60) return (min / 60) + ' hr before'; return min + ' min before'; }
const byUrgency = (a, b) => { const oa = relevantOcc(a), ob = relevantOcc(b); const da = isDone(a), db = isDone(b); if (da !== db) return da ? 1 : -1; if (!oa || !ob) return oa ? -1 : ob ? 1 : 0; return oa - ob; };

function renderCards() {
  const now = new Date(), u = tasks.map(t => urgency(t, now));
  const c = k => u.filter(x => k.includes(x)).length, today = tasks.filter(t => occursOn(t, now)).length;
  $('#statRow').innerHTML = `<div class="stat"><b>${c(['hot', 'urgent'])}</b>urgent</div><div class="stat ${c(['missed']) ? 'warn' : ''}"><b>${c(['missed'])}</b>missed</div><div class="stat"><b>${today}</b>today</div><div class="stat"><b>${c(['done'])}</b>done</div>`;
  const cats = ['All', ...new Set([...CATS, ...tasks.map(t => t.category)])];
  $('#catbar').innerHTML = cats.map(x => `<button class="cat ${x === selectedCat ? 'active' : ''}" data-act="cat" data-cat="${esc(x)}">${esc(x)}</button>`).join('');
  const q = $('#searchInput').value.trim().toLowerCase();
  const list = tasks.filter(t => (selectedCat === 'All' || t.category === selectedCat) && [t.title, t.category, t.place, t.notes, t.forName, ...t.checklist.map(i => i.t)].join(' ').toLowerCase().includes(q)).sort(byUrgency);
  $('#billSum').innerHTML = billSummaryHTML(list); $('#billSum').hidden = !$('#billSum').innerHTML;
  $('#taskTitle').textContent = selectedCat === 'All' ? 'Cards' : selectedCat; $('#viewTitle').textContent = selectedCat === 'All' ? 'Cards' : selectedCat;
  $('#taskCount').textContent = `${list.length} shown`;
  $('#taskGrid').innerHTML = list.length ? list.map(t => cardHTML(t)).join('') : `<div class="empty">${tasks.length ? 'Nothing matches.' : 'No cards yet. Tap + to add one — or open 🧰 in the add screen to load demo cards.'}</div>`;
  setTimeout(() => hydrateThumbs(), 0);
}

function itemHTML(t, date) {
  const done = isDoneOn(t, date), occ = t.hasDue ? new Date(`${ymd(date)}T${t.time}`) : null, st = startOf(t, occ);
  let cls = done ? 'done' : 'low', edge = '';
  if (!done && occ) { const ms = occ - new Date(), h = ms / 36e5; cls = h < 0 ? 'missed' : h <= 1 ? 'hot' : h <= 3 ? 'urgent' : h <= 24 ? 'soon' : 'low'; edge = ` style="border-left-color:${heatColor(timeHeat(ms)).bg}"`; }
  return `<div class="item ${cls}"${edge} data-open="${t.id}" role="button" tabindex="0"><time>${t.hasDue ? fmtTime(t.time) : '—'}</time><div><b>${esc(t.title)}</b><span class="sub">${esc(t.category)}${t.forName ? ' · ' + esc(t.forName) : ''}${t.place ? ' · ' + esc(t.place) : ''}${st ? ' · starts ' + (ymd(st) === ymd(date) ? '' : fmtDate(st) + ' ') + fmtClock(st) : ''}</span></div><button class="mini" data-act="${t.hasDue ? 'doneOn' : 'done'}" data-id="${t.id}" data-date="${ymd(date)}" aria-label="${done ? 'Mark not done' : 'Mark done'}">${done ? '↺' : '✓'}</button></div>`;
}
const onDay = d => tasks.filter(t => occursOn(t, d)).sort((a, b) => a.time.localeCompare(b.time));
/* Flight check-ins open 24 h before departure — they show on the day they open */
const checkinsOn = d => tasks.filter(t => t.checkin && t.hasDue && occursOn(t, addDays(d, 1)) && !isDoneOn(t, addDays(d, 1)));
function checkinItemHTML(t, d) {
  const leave = addDays(d, 1);
  return `<div class="item checkin" data-open="${t.id}" role="button" tabindex="0"><time>${fmtTime(t.time)}</time><div><b>✈️ Check-in opens · ${esc(t.title)}</b><span class="sub">${t.flightNo ? 'Flight ' + esc(t.flightNo) + ' · ' : ''}leaves ${leave.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${fmtTime(t.time)}${t.terminal ? ' · Terminal ' + esc(t.terminal) : ''}</span></div>${t.link || t.payApp ? `<button class="mini" data-act="openLink" data-id="${t.id}" aria-label="Check in">↗</button>` : ''}</div>`;
}
/* Day/week rows: cards due that day + check-ins opening that day, by time */
function dayRows(d, list = onDay(d)) { return [...list.map(t => ({ time: t.time, html: itemHTML(t, d) })), ...checkinsOn(d).map(t => ({ time: t.time, html: checkinItemHTML(t, d) }))].sort((a, b) => a.time.localeCompare(b.time)); }

function renderWeek() {
  const today = startOfDay(new Date()), start = addDays(today, weekOffset * 7 - today.getDay()), end = addDays(start, 6);
  $('#weekLabel').textContent = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: start.getMonth() === end.getMonth() ? undefined : 'short', day: 'numeric' })}`;
  let strip = '', agenda = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), list = dayRows(d), isToday = ymd(d) === ymd(today);
    strip += `<button class="day ${isToday ? 'today' : ''}" data-act="openDay" data-date="${ymd(d)}"><b>${d.toLocaleDateString(undefined, { weekday: 'short' })}</b><strong>${d.getDate()}</strong><div class="dots">${'<span class="dot"></span>'.repeat(Math.min(list.length, 3))}</div></button>`;
    if (list.length) agenda += `<div class="agendaDay"><h3>${isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}<button data-act="openDay" data-date="${ymd(d)}">Open day ›</button></h3>${list.map(r => r.html).join('')}</div>`;
  }
  $('#week').innerHTML = strip;
  $('#agenda').innerHTML = agenda || '<div class="empty">Nothing scheduled this week.</div>';
}

function renderDay() {
  const d = selectedDay, isToday = ymd(d) === ymd(new Date());
  $('#dayLabel').textContent = isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const list = dayRows(d), groups = [['Morning', 0, 12], ['Afternoon', 12, 17], ['Evening', 17, 24]];
  let html = '';
  for (const [name, a, b] of groups) { const g = list.filter(r => { const h = +r.time.slice(0, 2); return h >= a && h < b; }); if (g.length) html += `<div class="groupTitle">${name}</div>${g.map(r => r.html).join('')}`; }
  if (isToday) { const any = tasks.filter(t => !t.hasDue && !t.done); if (any.length) html += `<div class="groupTitle">Anytime</div>${any.map(t => itemHTML(t, d)).join('')}`; }
  $('#timeline').innerHTML = html || `<div class="empty">Nothing due ${isToday ? 'today' : 'this day'}. Tap + to add a card.</div>`;
}

function schoolTasks() { return tasks.filter(t => t.category === 'School'); }
function renderSchool() {
  if (document.activeElement !== $('#studentName')) $('#studentName').value = settings.studentName;
  const list = schoolTasks().sort(byUrgency), missed = list.filter(t => urgency(t) === 'missed').length, open = list.filter(t => !isDone(t)).length;
  $('#schoolSummary').textContent = `${open} open${missed ? ` · ${missed} missing` : ''}`;
  $('#schoolCount').textContent = `${list.length} total`;
  $('#schoolGrid').innerHTML = list.length ? list.map(t => cardHTML(t)).join('') : '<div class="empty">No assignments yet. Tap “+ Assignment”.</div>';
  setTimeout(() => hydrateThumbs(), 0);
}

function render() {
  renderNav(); setTimeout(() => hydrateThumbs(), 0); if ($('#cardDialog').open) renderCardModal();
  if (view === 'cards') renderCards(); else if (view === 'week') renderWeek(); else if (view === 'day') renderDay(); else if (view === 'school') renderSchool(); else if (view === 'place') renderMap(); else if (view === 'team') renderTeam(); else if (view === 'work') renderWork(); else if (view === 'bills') renderBills(); else if (view === 'fuel') renderFuel();
  lastSig = screenSigSafe();
}
/* Redraws only when something on screen would actually change (a card's meter moving to a new step, data, or view).
   Timers and returning to the app use this, so the page no longer redraws itself on a schedule. */
let lastSig = '';
function screenSigSafe() { try { return screenSig(); } catch (e) { return 'unknown-' + Date.now(); } }
function screenSig() {
  const now = new Date();
  const cards = tasks.map(t => { const m = meter(t, now); return [t.id, isDone(t) ? 1 : 0, Math.round(m.pct), m.u, m.label || '', t.media.length, (t.review && t.review.at) || 0, t.checklist.filter(i => i.d).length].join(','); });
  const extra = [typeof fLogs !== 'undefined' ? fLogs.length : 0, typeof fVehicles !== 'undefined' ? fVehicles.length : 0, typeof wShifts !== 'undefined' ? wShifts.length : 0, typeof wPays !== 'undefined' ? wPays.length : 0, typeof wPer !== 'undefined' ? wPer + wOff : '', ymd(now), typeof wShifts !== 'undefined' ? wShifts.map(s => s.date + s.job + (s.flat ?? '') + (s.start || '') + (s.end || '')).join('') + wPays.map(p => (p.on || '') + p.job + p.amount).join('') : ''].join(',');
  return [view, selectedCat, teamFilter, teamSel, extra, cards.join(';')].join('|');
}
function softRender() {
  if (document.querySelector('dialog[open]')) return;
  if (screenSigSafe() !== lastSig) render();
}
function setView(v) {
  view = v; $$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === v));
  $('#viewTitle').textContent = { cards: 'Cards', week: 'Week', day: 'Day', school: 'School', team: 'Team', place: 'Place', work: 'Work', bills: 'Bills', fuel: 'Around me' }[v] || 'Kayaos';
  window.scrollTo({ top: 0 }); render(); if (v === 'team' && currentUser) loadTeams();
}

/* ---------- Add / edit card ---------- */
function fillCategorySelect(current) {
  const cats = [...new Set([...CATS, ...tasks.map(t => t.category)])];
  $('#categorySelect').innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join('') + '<option value="__custom">+ Custom…</option>';
  $('#categorySelect').value = current && cats.includes(current) ? current : 'Personal';
  $('#customCat').hidden = true;
}
function defaultDueTime() { const d = new Date(Date.now() + 60 * 60000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5 % 60); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function syncDueGroup() { const on = $('#hasDue').checked; $('#dueGroup').hidden = !on; const f = $('#taskForm'); f.date.required = on; f.time.required = on; }
function setReminder(v) { const s = $('#reminderSelect'); if (![...s.options].some(o => +o.value === +v)) s.add(new Option(reminderLabel(v), v)); s.value = String(v); }
function applySchoolDefaults(f) {
  if (!f.forName.value) f.forName.value = settings.studentName || '';
  f.alert.value = 'both'; if (+f.nag.value === 0) f.nag.value = '10'; if (+f.reminder.value < 60) setReminder(60);
}
function openAdd(preset = {}) {
  editingId = null; const f = $('#taskForm'); f.reset(); delete f.title.dataset.pick; fillCategorySelect(preset.category || (selectedCat !== 'All' ? selectedCat : 'Personal'));
  $('#taskDialogTitle').textContent = preset.category === 'School' ? 'Add assignment' : 'Add card'; $('#saveBtn').textContent = 'Save card';
  const nowR = new Date(); nowR.setMinutes(Math.floor(nowR.getMinutes() / 5) * 5); f.startDate.value = ymd(nowR); f.startTime.value = pad(nowR.getHours()) + ':' + pad(nowR.getMinutes());
  f.date.value = ymd(view === 'day' ? selectedDay : new Date()); f.time.value = defaultDueTime(); f.alert.value = settings.alert; setReminder(15);
  if (f.category.value === 'School') applySchoolDefaults(f);
  fillTeamFields(preset.teamId ?? (view === 'team' ? teamSel : ''), preset.assignedTo); delete f.forName.dataset.auto;
  formChecklist = []; renderCheckEdit(); $('#checkInput').value = ''; formMedia = []; renderFormMedia(); formApp = null; syncAmountRow();
  $('#hasDue').checked = true; syncDueGroup(); closeTools(); $('#voiceBar').hidden = true;
  $('#taskDialog').showModal(); updateToolStates();
}
function openEdit(id) {
  const t = tasks.find(x => x.id === id); if (!t) return; openAdd({ category: t.category }); editingId = id;
  const f = $('#taskForm'); $('#taskDialogTitle').textContent = 'Edit card'; $('#saveBtn').textContent = 'Save changes';
  f.title.value = t.title; f.forName.value = t.forName; f.startDate.value = t.startDate; f.startTime.value = t.startDate ? t.startTime : ''; fillTeamFields(t.teamId, t.assignedTo); $('#hasDue').checked = t.hasDue; syncDueGroup();
  if (t.hasDue) { f.date.value = t.date; f.time.value = t.time; }
  f.repeat.value = t.repeat; setReminder(t.reminder); f.alert.value = t.alert; f.nag.value = String(t.nag); f.place.value = t.place; f.notes.value = t.notes; f.nearMe.checked = t.nearMe;
  formChecklist = t.checklist.map(i => ({ ...i })); renderCheckEdit(); f.proof.checked = t.proof; formMedia = []; renderFormMedia(); f.amount.value = t.amount || ''; f.conf.value = t.conf; f.installments.value = t.installments || ''; f.flightNo.value = t.flightNo; f.terminal.value = t.terminal; f.checkin.checked = t.checkin; f.link.value = t.link; formApp = t.payApp ? { ...t.payApp } : null; syncAmountRow(); fillWorkRow(t.id);
}
function syncAmountRow() { const f = $('#taskForm'), c = f.category.value === '__custom' ? f.custom.value : f.category.value; $('#amountRow').hidden = !(isBill(c) || +f.amount.value > 0); $('#planRow').hidden = !isBill(c); $('#workRow').hidden = c !== 'Work'; if (c === 'Work') fillWorkRow(); $('#travelRow').hidden = !(isTravel(c) || f.conf.value.trim() || f.flightNo.value.trim() || f.checkin.checked); syncLinkRow(isBill(c) ? 'bill' : isTravel(c) ? 'travel' : isGrocery(c) ? 'grocery' : ''); }
/* ---------- Links & apps ---------- */
let formApp = null, appCache = null;
const nativeApps = () => !!(window.KayaosNative && window.KayaosNative.listApps);
const PICKS = () => BILLERS.concat(TRAVEL, STORES);
const PICK_LIST = k => k === 'bill' ? BILLERS : k === 'travel' ? TRAVEL : STORES;
function syncLinkRow(kind) {
  $('#linkLbl').textContent = kind === 'bill' ? 'Pay link — website or app' : kind === 'travel' ? 'Booking link — airline, hotel or ride' : kind === 'grocery' ? 'Store — website or app' : 'Website link';
  $('#linkInput').placeholder = kind === 'bill' ? 'e.g. fpl.com/pay or pick below' : kind === 'travel' ? 'e.g. delta.com or pick below' : kind === 'grocery' ? 'e.g. publix.com or pick below' : 'e.g. school.edu, a recipe, a phone number';
  const picks = $('#linkPicks'); picks.hidden = !kind;
  if (kind && picks.dataset.kind !== kind) { picks.dataset.kind = kind; picks.innerHTML = PICK_LIST(kind).map(b => `<button type="button" data-biller="${esc(b[0])}">${kind === 'travel' ? { air: '✈️ ', stay: '🏨 ', ride: '🚗 ' }[b[2]] : ''}${esc(b[0])}</button>`).join(''); }
  markPick(); $('#appRow').hidden = !nativeApps() && !formApp; $('#pickAppBtn').hidden = !nativeApps(); renderAppChosen();
}
function markPick() { const host = linkHost(cleanLink($('#linkInput').value)); $$('#linkPicks button').forEach(b => { const x = PICKS().find(y => y[0] === b.dataset.biller); b.classList.toggle('on', !!x && host === x[1]); }); }
function renderAppChosen() {
  const el = $('#appChosen'); el.hidden = !formApp;
  el.innerHTML = formApp ? `📱 ${esc(formApp.name)} <button type="button" id="appClear" aria-label="Remove app">×</button>` : '';
  if (formApp) $('#appRow').hidden = false;
}
function loadApps() { if (!nativeApps()) return []; if (!appCache) { try { appCache = JSON.parse(window.KayaosNative.listApps() || '[]').filter(a => a && a.pkg); } catch (e) { appCache = []; } } return appCache; }
function findApp(names) { const apps = loadApps(), ns = names.filter(Boolean).map(n => n.toLowerCase().replace(/[^a-z0-9]/g, '')); return apps.find(a => ns.includes(a.name.toLowerCase().replace(/[^a-z0-9]/g, ''))) || apps.find(a => ns.some(n => n.length > 3 && a.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(n))) || null; }
function renderAppList() {
  const q = $('#appSearch').value.trim().toLowerCase(), list = loadApps().filter(a => !q || a.name.toLowerCase().includes(q));
  $('#appList').innerHTML = list.length ? list.slice(0, 300).map(a => `<button type="button" class="appItem" data-pkg="${esc(a.pkg)}" data-name="${esc(a.name)}"><span class="appIco">${esc((a.name.trim()[0] || '?').toUpperCase())}</span>${esc(a.name)}</button>`).join('') : '<p class="sub">No apps match.</p>';
}
$('#pickAppBtn').addEventListener('click', () => { appCache = null; $('#appSearch').value = ''; renderAppList(); $('#appDialog').showModal(); });
$('#appSearch').addEventListener('input', renderAppList);
$('#appList').addEventListener('click', e => { const b = e.target.closest('.appItem'); if (!b) return; formApp = { pkg: b.dataset.pkg, name: b.dataset.name }; renderAppChosen(); $('#appDialog').close(); });
$('#appChosen').addEventListener('click', e => { if (e.target.closest('#appClear')) { formApp = null; renderAppChosen(); $('#appRow').hidden = !nativeApps(); } });
$('#linkInput').addEventListener('input', markPick);
$('#confInput').addEventListener('input', syncAmountRow);
const PACKING = ['ID / passport', 'Boarding pass', 'Wallet & cards', 'Phone charger', 'Medications', 'Toiletries', 'Clothes', 'House keys'];
$('#packBtn').addEventListener('click', () => { const have = new Set(formChecklist.map(i => i.t.toLowerCase())); const add = PACKING.filter(x => !have.has(x.toLowerCase())); formChecklist.push(...add.map(t => ({ t, d: false }))); renderCheckEdit(); toast(add.length ? `Added ${add.length} packing items — edit them below` : 'Packing list already added'); });
$('#flightInput').addEventListener('change', e => { e.target.value = fmtFlight(e.target.value); });
$('#linkPicks').addEventListener('click', e => {
  const b = e.target.closest('[data-biller]'); if (!b) return; const kind = $('#linkPicks').dataset.kind, travel = kind === 'travel', grocery = kind === 'grocery', x = PICK_LIST(kind).find(y => y[0] === b.dataset.biller); if (!x) return;
  const f = $('#taskForm'); f.link.value = pickHref(x[1]);
  /* Title follows the latest pick — unless the user typed their own */
  const cur = f.title.value.trim();
  if (!cur || cur === f.title.dataset.pick) { f.title.value = grocery ? (x[2] === 'delivery' ? `${x[0]} order` : `${x[0]} groceries`) : travel ? `${x[0]} ${{ air: 'flight', stay: 'stay', ride: 'ride' }[x[2]]}` : 'Pay ' + x[0]; f.title.dataset.pick = f.title.value; }
  if (travel && x[2] === 'air' && $('#hasDue').checked) f.checkin.checked = true;
  formApp = null; /* a new pick replaces the old app */
  const app = findApp(travel || grocery ? [x[0], x[3]] : [x[0], x[2]]); if (app && !formApp) formApp = { pkg: app.pkg, name: app.name };
  markPick(); renderAppChosen();
});
function openCardLink(t, webOnly) {
  const N = window.KayaosNative;
  if (!webOnly && t.payApp) {
    if (N && N.openApp) { let ok = false; try { ok = N.openApp(t.payApp.pkg); } catch (e) {} if (ok) return; if (!t.link) { toast(`${t.payApp.name} isn't on this phone — opening the Play Store`); try { N.openStore(t.payApp.pkg); } catch (e) {} return; } }
    else if (!t.link) { toast(`${t.payApp.name} opens from the Kayaos Android app`); return; }
  }
  if (!t.link) return;
  openOutside(t.link); /* the Android app hands outside links to the right app */
}
$('#customCat').addEventListener('input', syncAmountRow);
$('#categorySelect').addEventListener('change', e => {
  syncAmountRow();
  const custom = e.target.value === '__custom'; $('#customCat').hidden = !custom; if (custom) $('#customCat').focus();
  if (e.target.value === 'School' && !editingId) applySchoolDefaults($('#taskForm'));
});
$('#hasDue').addEventListener('change', syncDueGroup);
$('#taskForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, fd = new FormData(f);
  let cat = fd.get('category') === '__custom' ? String(fd.get('custom') || '').trim() : fd.get('category');
  if (!cat) { toast('Type a custom category name'); $('#customCat').focus(); return; }
  const hasDue = $('#hasDue').checked;
  let startDate = String(fd.get('startDate') || ''), startTime = String(fd.get('startTime') || '');
  if (startTime && !startDate) startDate = hasDue ? String(fd.get('date')) : ymd(new Date());
  if (startDate && hasDue && new Date(`${startDate}T${startTime || '00:00'}`) >= new Date(`${fd.get('date')}T${fd.get('time')}`)) { toast('Start must be before the due date & time'); f.startDate.focus(); return; }
  const rawLink = String(fd.get('link') || '').trim();
  if (rawLink && !cleanLink(rawLink)) { toast('That link doesn’t look right — use a website like chase.com or a phone number'); f.link.focus(); return; }
  const old = editingId ? tasks.find(x => x.id === editingId) : null;
  const t = normalize({
    ...(old || {}), id: old?.id, title: String(fd.get('title')).trim(), category: cat, hasDue,
    date: hasDue ? fd.get('date') : '', time: hasDue ? fd.get('time') : '', repeat: hasDue ? fd.get('repeat') : 'none',
    reminder: +fd.get('reminder') || 0, alert: fd.get('alert'), nag: +fd.get('nag') || 0, forName: String(fd.get('forName') || '').trim(),
    teamId: String(fd.get('team') || '') || null, assignedTo: String(fd.get('team') || '') ? (String(fd.get('assignee') || '') || null) : null,
    checklist: formChecklist.concat(splitItems($('#checkInput').value).map(x => ({ t: x, d: false }))), nearMe: !!fd.get('nearMe'), proof: !!fd.get('proof'), amount: parseFloat(String(fd.get('amount') || '').replace(/[^0-9.]/g, '')) || 0, link: rawLink, payApp: formApp, conf: String(fd.get('conf') || ''), installments: +fd.get('installments') || 0, flightNo: String(fd.get('flightNo') || ''), terminal: String(fd.get('terminal') || ''), checkin: !!fd.get('checkin') && hasDue, media: (old ? old.media : []).concat(formMedia),
    startDate, startTime, place: String(fd.get('place') || '').trim(), notes: String(fd.get('notes') || '').trim(), createdAt: old?.createdAt || Date.now()
  });
  if (/^\d{1,4}$/.test(t.flightNo)) { const tp = travelPick(t); if (tp && AIR_CODE[tp[0]]) t.flightNo = `${AIR_CODE[tp[0]]} ${t.flightNo}`; }
  if (t.teamId) t.demo = false;
  if (t.nearMe && !t.place && !fd.get('attachLoc') && !coordFromTask(t)) { toast('Add a place (or pin your location) for the near-me reminder'); f.place.focus(); return; }
  if (old && old.place !== t.place) t.gps_coordinates = null;
  if (old && (old.date !== t.date || old.time !== t.time || old.repeat !== t.repeat)) { t.done = false; t.doneFor = null; }
  if (fd.get('attachLoc')) { const p = await getPosition(); if (p) { t.gps_coordinates = { lat: p.lat, lng: p.lng }; addCheckin(p); } }
  if (old) tasks[tasks.indexOf(old)] = t; else tasks.push(t);
  syncCardWork(t, fd);
  saveTasks(); $('#taskDialog').close(); toast(old ? 'Card updated' : 'Card saved'); render();
  if (t.nearMe && !geoTimer) { toggleTracking(true); toast('Location tracking turned on so Kayaos knows when you’re near'); }
  if (t.place && !t.gps_coordinates) { const g = await geocodeAddress(t.place); if (g) { t.gps_coordinates = { lat: g.lat, lng: g.lng }; saveTasks(); } }
  formMedia = []; await uploadMedia(t);
  pushTask(t);
});

/* Checklist editor in the Add card form (grocery lists, packing lists, steps…) */
let formChecklist = [];
const splitItems = txt => String(txt || '').split(/\s*,\s*|\s*;\s*|\n|\s+and\s+|\s*&\s*/i).map(x => x.replace(/^(?:some|a|an|the)\s+/i, '').trim()).filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).slice(0, 40);
function renderCheckEdit() {
  $('#checkEdit').innerHTML = formChecklist.map((i, k) => `<li><label><input type="checkbox" data-ci="${k}" ${i.d ? 'checked' : ''}> <span>${esc(i.t)}</span></label><button type="button" class="mini" data-cx="${k}" aria-label="Remove ${esc(i.t)}">×</button></li>`).join('');
}
function addCheckItems() { const items = splitItems($('#checkInput').value); if (!items.length) return; items.forEach(x => formChecklist.push({ t: x, d: false })); $('#checkInput').value = ''; renderCheckEdit(); $('#checkInput').focus(); }
$('#checkAdd').addEventListener('click', addCheckItems);
$('#checkInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCheckItems(); } });
$('#checkEdit').addEventListener('click', e => { const x = e.target.closest('[data-cx]'); if (x) { formChecklist.splice(+x.dataset.cx, 1); renderCheckEdit(); } });
$('#checkEdit').addEventListener('change', e => { const c = e.target.closest('[data-ci]'); if (c) formChecklist[+c.dataset.ci].d = c.checked; });
function toggleCheckItem(t, k) {
  const it = t.checklist[k]; if (!it) return; it.d = !it.d; saveTasks(); render(); pushTask(t);
  if (t.checklist.length && t.checklist.every(i => i.d) && !isDone(t)) toast(`Everything on “${t.title}” is checked — tap ✓ Done to finish it`);
}
/* Voice: "add milk, eggs and bread to the grocery list" */
const listSay = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : (a[0] || '');
function tryListCommand(text) {
  const m = String(text).trim().match(/^(?:please\s+|hey\s+\w+,?\s+)?(?:add|put|throw)\s+(.+?)\s+(?:to|on|in|onto)\s+(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+list)?[.!?]*$/i);
  if (!m) return false;
  const target = m[2].trim().toLowerCase();
  if (target.split(/\s+/).length > 3 || /\b(calendar|schedule|tomorrow|today|tonight|at \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(target)) return false;
  const items = splitItems(m[1]); if (!items.length) return false;
  const store = STORES.find(s => [s[0], s[3]].some(n => n && normName(n) === normName(target.replace(/\s+(groceries|grocery)$/, ''))));
  const groc = !!store || /^(grocery|groceries|shopping|store|supermarket)$/.test(target);
  let card = (store && tasks.find(t => !isDone(t) && normName(t.title).startsWith(normName(store[0])) && isGrocery(t.category)))
    || tasks.find(t => !isDone(t) && t.title.toLowerCase().includes(target))
    || (groc && !store && tasks.find(t => !isDone(t) && /grocer|shopping/i.test(t.title)))
    || tasks.find(t => !isDone(t) && t.category.toLowerCase() === target && t.checklist.length);
  if (!card) {
    card = normalize({ title: store ? `${store[0]} groceries` : groc ? 'Grocery list' : titleCase(target) + ' list', category: groc ? 'Groceries' : (allCats().find(c => c.toLowerCase() === target) || 'Personal'), hasDue: false, link: store ? pickHref(store[1]) : '' });
    tasks.push(card);
  }
  items.forEach(x => { const ex = card.checklist.find(i => i.t.toLowerCase() === x.toLowerCase()); if (ex) ex.d = false; else card.checklist.push({ t: x, d: false }); });
  saveTasks(); render(); pushTask(card);
  toast(`Added ${listSay(items)} to ${card.title}`); speak(`Added ${listSay(items)} to ${card.title}.`);
  return true;
}

/* ---------- Photos & short videos: how-to instructions and proof of completion ---------- */
/* Stored on the phone (IndexedDB). With cloud accounts they also go to the private "kayaos-media" bucket,
   so a parent's how-to photo shows on the child's phone and the child's proof shows on the parent's. */
const MediaDB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('kayaos-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('m', mode), req = fn(t.objectStore('m')); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
  return { put: (k, v) => run('readwrite', s => s.put(v, k)), get: k => run('readonly', s => s.get(k)), del: k => run('readwrite', s => s.delete(k)) };
})();
const MAX_VIDEO_SEC = 15, MEDIA_KEEP_DAYS = 7, mediaURLs = new Map();
let formMedia = [], mediaTarget = null, pendingProofDone = null;
function compressImage(file, max = 1000, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error('compress')), 'image/jpeg', q); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Not a readable image')); };
    img.src = url;
  });
}
function videoSeconds(file) { return new Promise(res => { const v = document.createElement('video'), url = URL.createObjectURL(file); v.preload = 'metadata'; v.onloadedmetadata = () => { URL.revokeObjectURL(url); res(v.duration); }; v.onerror = () => { URL.revokeObjectURL(url); res(NaN); }; v.src = url; }); }
async function ingestMedia(file, role) {
  try {
    let blob, kind;
    if (/^image\//.test(file.type)) { blob = await compressImage(file); kind = 'photo'; }
    else if (/^video\//.test(file.type)) {
      const sec = await videoSeconds(file);
      if (sec > MAX_VIDEO_SEC + 0.5) { toast(`Videos can be up to ${MAX_VIDEO_SEC} seconds — this one is ${Math.round(sec)}s`); return null; }
      if (file.size > 25 * 1024 * 1024) { toast('That video is too large (25 MB max)'); return null; }
      blob = file; kind = 'video';
    } else { toast('Pick a photo or a video'); return null; }
    const m = { id: uuid(), kind, role, at: Date.now(), by: myId(), name: settings.name || '', type: blob.type || (kind === 'photo' ? 'image/jpeg' : 'video/mp4'), path: '' };
    await MediaDB.put(m.id, blob);
    return m;
  } catch (e) { toast('Could not use that file'); return null; }
}
/* Chooser: what it's for (proof / how-to) + where it comes from (camera photo, camera video, gallery).
   Proof can only come from the camera, so an old gallery picture can't count as "done". */
let mcRole = 'guide', mcTask = null, mcLocked = false;
function openMediaChooser(taskId, role, locked = false) {
  mcTask = taskId; mcRole = role; mcLocked = locked;
  $('#mcTitle').textContent = locked ? '📸 Show it’s done' : 'Add to this card';
  $('#mcRole').hidden = locked; syncMediaChooser(); $('#mediaChoice').showModal();
}
function syncMediaChooser() {
  $$('#mcRole [data-role]').forEach(b => { const on = b.dataset.role === mcRole; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
  $('#mcGallery').hidden = mcRole === 'proof';
  $('#mcNote').textContent = mcRole === 'proof' ? 'Proof must be taken now with the camera. Videos up to 15 seconds.' : 'Photos are shrunk to save space; videos up to 15 seconds. Media is removed 7 days after the card is finished (proof waits for review, up to 30 days).';
}
$('#mcRole').addEventListener('click', e => { const b = e.target.closest('[data-role]'); if (b) { mcRole = b.dataset.role; syncMediaChooser(); } });
$('#mediaChoice').addEventListener('click', e => { const b = e.target.closest('[data-source]'); if (!b) return; $('#mediaChoice').close(); pickMedia(mcRole, mcTask, b.dataset.source); });
$('#mediaChoice').addEventListener('close', () => { if (pendingProofDone && !mediaTarget) pendingProofDone = null; });
function pickMedia(role, taskId, source = 'photo') {
  if (role === 'proof' && source === 'gallery') source = 'photo';
  mediaTarget = { role, taskId };
  const inp = $(source === 'video' ? '#camVideo' : source === 'gallery' ? '#pickGallery' : '#camPhoto'); inp.value = '';
  inp.click();
}
async function onMediaPicked(e) {
  const file = e.target.files && e.target.files[0], tgt = mediaTarget; mediaTarget = null; if (!file || !tgt) { pendingProofDone = null; return; }
  const m = await ingestMedia(file, tgt.role); if (!m) return;
  if (!tgt.taskId) { formMedia.push(m); renderFormMedia(); return; }
  const t = tasks.find(x => x.id === tgt.taskId); if (!t) return;
  t.media.push(m); saveTasks(); render(); await uploadMedia(t);
  if (m.role === 'proof') {
    toast('Proof added'); 
    if (pendingProofDone === t.id && !isDone(t)) { pendingProofDone = null; toggleDone(t); }
  } else toast('Added to the card');
}
['#camPhoto', '#camVideo', '#pickGallery'].forEach(sel => $(sel).addEventListener('change', onMediaPicked));
async function uploadMedia(t) {
  if (!sb || !currentUser || t.demo || !sb.storage) return;
  let changed = false;
  for (const m of t.media) {
    if (m.path) continue;
    const blob = await MediaDB.get(m.id).catch(() => null); if (!blob) continue;
    const path = `${t.teamId || myId()}/${t.id}/${m.id}.${m.kind === 'photo' ? 'jpg' : (m.type.split('/')[1] || 'mp4').replace('quicktime', 'mov')}`;
    const { error } = await sb.storage.from('kayaos-media').upload(path, blob, { contentType: m.type, upsert: true });
    if (!error) { m.path = path; changed = true; } else { toast('Photo saved on this phone (cloud upload failed)'); break; }
  }
  if (changed) { saveTasks(); pushTask(t); }
}
async function mediaURL(m) {
  if (mediaURLs.has(m.id)) return mediaURLs.get(m.id);
  let blob = await MediaDB.get(m.id).catch(() => null);
  if (!blob && m.path && sb && currentUser && sb.storage) { const { data } = await sb.storage.from('kayaos-media').download(m.path); if (data) { blob = data; MediaDB.put(m.id, data).catch(() => {}); } }
  if (!blob) return null;
  const u = URL.createObjectURL(blob); mediaURLs.set(m.id, u); return u;
}
function mediaStripHTML(t) {
  if (!t.media.length) return '';
  return `<div class="mediaRow">${t.media.map(m => `<button class="thumb ${m.role}" data-act="viewMedia" data-id="${t.id}" data-m="${m.id}" aria-label="${m.role === 'proof' ? 'Proof' : 'How-to'} ${m.kind}">${m.kind === 'photo' ? `<img data-mid="${m.id}" alt="">` : '<span class="play">▶</span>'}<span class="tag">${m.role === 'proof' ? '✓ Proof' : 'How-to'}</span></button>`).join('')}</div>`;
}
async function hydrateThumbs(root = document) {
  for (const img of root.querySelectorAll('img[data-mid]:not([src])')) {
    const t = tasks.find(x => x.media.some(m => m.id === img.dataset.mid)), m = t && t.media.find(x => x.id === img.dataset.mid);
    const u = m && await mediaURL(m); if (u) img.src = u; else img.closest('.thumb')?.classList.add('missing');
  }
}
async function openMediaViewer(taskId, mid) {
  const t = tasks.find(x => x.id === taskId), m = t && t.media.find(x => x.id === mid); if (!m) return;
  const u = await mediaURL(m);
  $('#mediaView').innerHTML = !u ? '<div class="empty">This file isn’t on this phone yet (sign in to sync photos).</div>' : m.kind === 'photo' ? `<img src="${u}" alt="">` : `<video src="${u}" controls autoplay playsinline></video>`;
  const who = m.by && t.teamId ? memberName(t.teamId, m.by) : (m.name || '');
  $('#mediaCaption').textContent = `${m.role === 'proof' ? 'Proof' : 'How-to'} ${m.kind}${who ? ' · ' + who : ''} · ${new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  $('#mediaDelete').dataset.id = taskId; $('#mediaDelete').dataset.m = mid; $('#mediaDelete').hidden = !canDelete(t) && m.by !== myId();
  $('#mediaDialog').showModal();
}
async function deleteMedia(t, mid) {
  const m = t.media.find(x => x.id === mid); if (!m) return;
  t.media = t.media.filter(x => x.id !== mid); MediaDB.del(mid).catch(() => {}); if (mediaURLs.has(mid)) { URL.revokeObjectURL(mediaURLs.get(mid)); mediaURLs.delete(mid); }
  if (m.path && sb && currentUser && sb.storage) sb.storage.from('kayaos-media').remove([m.path]).catch(() => {});
  saveTasks(); render(); pushTask(t);
}
$('#mediaDelete').addEventListener('click', e => { const t = tasks.find(x => x.id === e.currentTarget.dataset.id); if (t && confirm('Delete this photo/video?')) { deleteMedia(t, e.currentTarget.dataset.m); $('#mediaDialog').close(); } });
$('#mediaDialog').addEventListener('close', () => { const v = $('#mediaView video'); if (v) v.pause(); });
function renderFormMedia() {
  $('#formMedia').innerHTML = formMedia.map((m, k) => `<span class="fm">${m.kind === 'photo' ? '📷' : '🎬'} How-to ${m.kind}<button type="button" class="mini" data-fmx="${k}" aria-label="Remove">×</button></span>`).join('');
}
$('#formMedia').addEventListener('click', e => { const x = e.target.closest('[data-fmx]'); if (x) { const [m] = formMedia.splice(+x.dataset.fmx, 1); if (m && !tasks.some(t => t.media.some(z => z.id === m.id))) MediaDB.del(m.id).catch(() => {}); renderFormMedia(); } });
$('#addHowTo').addEventListener('click', () => openMediaChooser(null, 'guide'));
/* Proof: has this card got a proof photo/video for the current occurrence? */
function hasProof(t) {
  const o = relevantOcc(t), rv = t.review && t.review.state === 'redo' ? t.review.at : 0, since = Math.max(t.repeat !== 'none' && o ? o.getTime() - 36 * 36e5 : 0, rv);
  return t.media.some(m => m.role === 'proof' && m.at > since - (rv ? 0 : 1));
}
/* Clean-up: media on a finished card is removed 7 days after the proof is approved (or 7 days after it's
   finished when there's no proof). Proof nobody has reviewed yet is kept for 30 days so a parent/lead can see it.
   The cloud "cleanup-media" function applies the same rule on the server, even when nobody opens the app. */
const UNREVIEWED_KEEP_DAYS = 30;
function mediaExpiry(t) {
  if (!t.media.length || !t.done || !t.doneAt) return null;
  const proof = lastProof(t), ok = t.review && t.review.for === 'once' && t.review.state === 'ok';
  if (proof && !ok) return t.doneAt + UNREVIEWED_KEEP_DAYS * 864e5;
  return Math.max(t.doneAt, ok ? t.review.at : 0) + MEDIA_KEEP_DAYS * 864e5;
}
function purgeOldMedia() {
  let n = 0;
  for (const t of tasks) { const exp = mediaExpiry(t); if (exp && exp < Date.now() && (!t.teamId || t.user_id === myId() || !t.user_id)) { [...t.media].forEach(m => deleteMedia(t, m.id)); n++; } }
  return n;
}
/* ---------- Proof review: the parent / team lead approves the photo or asks for a redo ---------- */
const doneKey = t => t.repeat === 'none' || !t.hasDue ? (t.done ? 'once' : null) : t.doneFor;
function lastProof(t) { return t.media.filter(m => m.role === 'proof').sort((a, b) => b.at - a.at)[0] || null; }
function reviewOf(t) { const k = doneKey(t); return k && t.review && t.review.for === k ? t.review : null; }
/* The person who finished the card doesn't review their own proof on a team card */
function canReview(t) { return !!doneKey(t) && !!lastProof(t) && !(t.teamId && t.assignedTo === myId() && t.user_id !== myId()); }
const needsReview = t => !!doneKey(t) && !!lastProof(t) && !reviewOf(t);
function proofPeekHTML(t) {
  const k = doneKey(t), p = lastProof(t); if (!k || !p) { const rv = t.review && t.review.state === 'redo' && !isDone(t) ? t.review : null; return rv ? `<div class="meta"><span class="chip rv-redo">🔁 Redo asked${rv.note ? ': ' + esc(rv.note) : ''}</span></div>` : ''; }
  const rv = reviewOf(t), who = p.by && t.teamId ? memberName(t.teamId, p.by) : '';
  const chip = rv ? `<span class="chip rv-ok">👍 Approved${rv.by && t.teamId ? ' by ' + esc(memberName(t.teamId, rv.by)) : ''}</span>` : '<span class="chip rv-wait">👀 Proof to review</span>';
  const btns = !rv && canReview(t) ? `<div class="pBtns"><button class="mini" data-act="approve" data-id="${t.id}">👍 Looks good</button><button class="mini" data-act="redo" data-id="${t.id}">🔁 Redo</button></div>` : '';
  return `<div class="proofPeek"><button class="thumb proof" data-act="viewMedia" data-id="${t.id}" data-m="${p.id}" aria-label="View proof">${p.kind === 'photo' ? `<img data-mid="${p.id}" alt="">` : '<span class="play">▶</span>'}<span class="tag">✓ Proof</span></button><div class="pInfo">${chip}<span class="sub">${who ? esc(who) + ' · ' : ''}${new Date(p.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>${btns}</div></div>`;
}
function approveProof(t) { const k = doneKey(t); if (!k) return; t.review = { for: k, state: 'ok', by: myId(), at: Date.now(), note: '' }; saveTasks(); render(); pushTask(t); toast('👍 Proof approved'); }
function redoProof(t) {
  const k = doneKey(t); if (!k) return;
  const note = (prompt(`What needs to be redone on “${t.title}”? (optional)`) ?? null); if (note === null) return;
  if (k === 'once') t.done = false; else t.doneFor = null;
  t.completedBy = null; t.doneAt = null; t.review = { for: k, state: 'redo', by: myId(), at: Date.now(), note: note.trim() };
  saveTasks(); render(); pushTask(t); toast('🔁 Sent back — reminders start again until new proof is added');
}

/* ---------- Tool menu (inside Add card) ---------- */
function closeTools() { $('#toolMenu').hidden = true; $('#toolsBtn').setAttribute('aria-expanded', 'false'); }
$('#toolsBtn').addEventListener('click', () => { const m = $('#toolMenu'); m.hidden = !m.hidden; $('#toolsBtn').setAttribute('aria-expanded', String(!m.hidden)); updateToolStates(); });
function updateToolStates() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#notifyState').textContent = perm === 'granted' ? 'On — pop-ups + sound' : perm === 'denied' ? 'Blocked — allow in browser settings' : perm === 'unsupported' ? 'Pop-ups unsupported here — sound still works' : 'Off — tap to turn on';
  $('[data-tool="notify"]').classList.toggle('on', perm === 'granted');
  $('#trackState').textContent = geoTimer ? 'On — near-me reminders active' : 'Off — powers check-ins + near-me reminders';
  $('[data-tool="track"]').classList.toggle('on', !!geoTimer);
  $('#trackBtn').textContent = geoTimer ? 'Stop tracking' : 'Start tracking'; $('#trackBtn').classList.toggle('on', !!geoTimer);
  $('#settingsNotify').textContent = perm === 'granted' ? 'Notifications on ✓' : 'Enable notifications';
}
$('#toolMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-tool]'); if (!b) return; const tool = b.dataset.tool;
  if (tool === 'voice') { closeTools(); voiceFill(); }
  if (tool === 'notify') askNotify();
  if (tool === 'track') toggleTracking();
  if (tool === 'share') shareLocation();
  if (tool === 'demo') { loadDemo(); $('#taskDialog').close(); }
});

/* ---------- Voice → form ---------- */
let recognizer = null;
function voiceFill() {
  if (window.KayaosNative && window.KayaosNative.listen) { $('#voiceBar').hidden = false; $('#voiceLive').textContent = 'Listening…'; window.KayaosNative.listen(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try { recognizer?.abort(); } catch (e) {}
    recognizer = new SR(); recognizer.lang = 'en-US'; recognizer.interimResults = true; recognizer.continuous = false; recognizer.maxAlternatives = 1;
    $('#voiceBar').hidden = false; $('#voiceLive').textContent = 'Listening… e.g. “Math worksheet due tomorrow at 8 pm”';
    let finalText = '', lastText = '', failed = false;
    recognizer.onresult = e => {
      lastText = Array.from(e.results).map(r => r[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
      $('#voiceLive').textContent = lastText;
      const fin = Array.from(e.results).filter(r => r.isFinal).map(r => r[0].transcript).join(' ').trim(); if (fin) finalText = fin;
    };
    recognizer.onerror = e => { failed = true; toast(e.error === 'not-allowed' ? 'Microphone permission needed' : e.error === 'no-speech' ? 'Didn’t hear anything — tap AI voice and try again' : 'Could not hear that — try again'); };
    /* Some phones never mark the result "final" — use whatever was heard */
    recognizer.onend = () => { $('#voiceBar').hidden = true; const t = finalText || lastText; if (t) applyVoice(t); else if (!failed) toast('Didn’t catch that — tap AI voice and try again'); };
    recognizer.start(); return;
  }
  if (PROCESS_VOICE_FUNCTION_URL && currentUser) { toggleRecording(); return; }
  toast('Voice input is not supported in this browser');
}
/* Android app: native speech recognition hands the words back here */
window.kayaosVoiceResult = function (text) { $('#voiceBar').hidden = true; if (text) { if (!$('#taskDialog').open) openAdd(); applyVoice(String(text)); } else toast('Didn’t catch that — try again'); };
$('#voiceStop').addEventListener('click', () => { if (recognizer) try { recognizer.stop(); } catch (e) {} if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); $('#voiceBar').hidden = true; });
async function applyVoice(text, cloudPayload = null) {
  text = String(text || '').trim(); if (!text) return;
  if (tryListCommand(text)) { $('#taskDialog').close(); return; }
  if (!$('#taskDialog').open) openAdd();
  const local = buildKayaosJson(text);
  let c = cloudPayload;
  if (!c && sb && currentUser) { $('#voiceBar').hidden = false; $('#voiceLive').textContent = '“' + text + '” — understanding…'; c = await cloudParse(text); $('#voiceBar').hidden = true; }
  const j = c ? { ...local, ...c, task: { ...local.task, ...c.task, target_date: c.task?.target_date || local.task.target_date, target_time: (c.task?.target_time || local.task.target_time) }, ai: local.ai } : local;
  const f = $('#taskForm'), set = (el, v) => { if (v === undefined || v === null || v === '') return; el.value = v; el.classList.remove('filled'); void el.offsetWidth; el.classList.add('filled'); };
  set(f.title, j.task.title);
  fillCategorySelect(CATS.includes(j.task.category) ? j.task.category : local.task.category); set(f.category, f.category.value);
  $('#hasDue').checked = true; syncDueGroup();
  set(f.date, j.task.target_date); set(f.time, String(j.task.target_time).slice(0, 5));
  set(f.repeat, ['none', 'daily', 'weekly', 'biweekly', 'monthly'].includes(j.recurrence?.type) ? j.recurrence.type : 'none');
  setReminder(j.reminders?.times?.[0]?.offset_minutes ?? local.reminders.times[0].offset_minutes); set(f.reminder, f.reminder.value);
  if (f.category.value === 'School') applySchoolDefaults(f);
  const place = j.location_context?.raw_address_or_venue; if (place) set(f.place, place);
  if (Array.isArray(j.checklist) && j.checklist.length) { formChecklist = j.checklist.map(x => ({ t: String(x), d: false })); renderCheckEdit(); }
  const amt = detectAmount(text); if (amt) { set(f.amount, amt.toFixed(2)); if (f.category.value === 'Personal') { fillCategorySelect('Bills'); } syncAmountRow(); }
  const conf = detectConf(text); if (conf) { set(f.conf, conf); f.title.value = f.title.value.replace(new RegExp('\\b(?:confirmation|record locator)\\b.*$', 'i'), '').trim() || f.title.value; }
  const tp = TRAVEL.find(x => new RegExp(`\\b${x[0]}\\b`, 'i').test(text) && (x[2] !== 'ride' || /\b(uber|lyft)\b/i.test(text)));
  if (tp && (isTravel(f.category.value) || /\b(flight|fly|flying|hotel|stay|trip|airport|check[\s-]?in)\b/i.test(text))) { if (!isTravel(f.category.value)) fillCategorySelect('Travel'); if (!f.link.value) set(f.link, pickHref(tp[1])); }
  const fl = String(text).match(/\bflight\s*(?:number|no\.?|#)?\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])?\s?(\d{1,4})\b(?!\s*(?:am|pm|a\.m|p\.m|:|o'?clock))/i);
  if (fl) { const code = fl[1] && !/^(to|on|at|in|is|my)$/i.test(fl[1]) ? fl[1].toUpperCase() : (tp && AIR_CODE[tp[0]]) || ''; set(f.flightNo, code ? `${code} ${fl[2]}` : fl[2]); if (!isTravel(f.category.value)) fillCategorySelect('Travel'); }
  const term = String(text).match(/\bterminal\s+([A-Z]{1,2}\d?|\d{1,2}[A-Z]?)\b/i); if (term) set(f.terminal, term[1].toUpperCase());
  if (fl && fl[1] && !/^(to|on|at|in|is|my)$/i.test(fl[1])) f.title.value = f.title.value.replace(new RegExp(`\\s*\\b${fl[1]}\\b\\s?(?:${fl[2]}\\b)?`, 'i'), ' ').replace(/\s+/g, ' ').trim();
  if (fl || term) f.title.value = f.title.value.replace(/\s+(?:number|no|#)?\s*\d{1,4}\b/i, m => fl && m.includes(fl[2]) ? '' : m).replace(/\s+terminal\s+\S+/i, '').trim();
  if (isTravel(f.category.value) && (/\bcheck[\s-]?in\b/i.test(text) || (tp && tp[2] === 'air'))) f.checkin.checked = true;
  syncAmountRow();
  if (!f.notes.value) set(f.notes, text);
  f.title.scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast('Filled from voice — check it and tap Save');
  speak(`${f.title.value}, ${fmtDate(new Date(f.date.value + 'T12:00'))} at ${fmtTime(f.time.value)}.`);
}

const titleCase = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
/* Conversational parser: pulls the task, date, time, repeat, reminder and place out of everyday speech,
   e.g. "um so Jayden has a science project due next Thursday after school, remind him 2 hours before". */
const MONTH_RX = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMWORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const num = w => NUMWORDS[w] ?? +w;
function parseWhen(text, now = new Date()) {
  const low = ' ' + String(text).toLowerCase().replace(/[,!?]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let d = new Date(now), time = null, m;
  /* "in 20 minutes", "in an hour", "in half an hour", "in 2 hours" → exact time */
  if ((m = low.match(/\bin\s+(half an|an?|one|two|three|four|five|\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/))) {
    const n = /half/.test(m[1]) ? 0.5 : num(m[1]), t = new Date(now.getTime() + (/^h/.test(m[2]) ? n * 36e5 : n * 60000));
    return { date: t, time: pad(t.getHours()) + ':' + pad(t.getMinutes()), timeGiven: true };
  }
  if (/\bday after tomorrow\b/.test(low)) d.setDate(d.getDate() + 2);
  else if (/\b(tomorrow|tmrw|tomorow)\b/.test(low)) d.setDate(d.getDate() + 1);
  else if ((m = low.match(/\bin\s+(a|an|one|two|three|four|five|six|seven|couple(?: of)?|few|\d{1,3})\s+(days?|weeks?|months?)\b/))) {
    const n = num(m[1].replace(' of', '')); if (/^m/.test(m[2])) d.setMonth(d.getMonth() + n); else d.setDate(d.getDate() + (/^w/.test(m[2]) ? 7 * n : n));
  } else if ((m = low.match(MONTH_RX))) {
    const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3));
    d = new Date(now.getFullYear(), mi, +m[2], now.getHours(), now.getMinutes()); if (d < startOfDay(now)) d.setFullYear(d.getFullYear() + 1);
  } else if ((m = low.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    d = new Date(y, +m[1] - 1, +m[2], now.getHours(), now.getMinutes()); if (!m[3] && d < startOfDay(now)) d.setFullYear(d.getFullYear() + 1);
  } else if ((m = low.match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/))) {
    d = new Date(now.getFullYear(), now.getMonth(), +m[1], now.getHours(), now.getMinutes()); if (d < startOfDay(now)) d.setMonth(d.getMonth() + 1);
  } else if (/\bnext week\b/.test(low)) d.setDate(d.getDate() + 7);
  else if (/\bnext month\b/.test(low)) d.setMonth(d.getMonth() + 1);
  else if (/\b(this|on the|over the) weekend\b/.test(low)) { d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); time = '10:00'; }
  else {
    const wd = WEEKDAYS.findIndex(x => new RegExp(`\\b${x.slice(0, 3)}(?:${x.slice(3)})?s?\\b`).test(low));
    if (wd >= 0) { let diff = (wd - d.getDay() + 7) % 7; if (diff === 0 && !/\btoday\b/.test(low)) diff = 7; d.setDate(d.getDate() + diff); }
  }
  /* time of day */
  if ((m = low.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)/))) {
    let h = +m[1]; const p = m[3][0]; if (p === 'p' && h < 12) h += 12; if (p === 'a' && h === 12) h = 0; time = pad(h) + ':' + (m[2] || '00');
  } else if ((m = low.match(/\b(?:at|by|before|around|until)\s+(\d{1,2})(?::(\d{2}))?(?!\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|st|nd|rd|th|\/|\d))\b/))) {
    let h = +m[1]; if (h <= 12) { if (/\b(morning|breakfast)\b/.test(low)) { if (h === 12) h = 0; } else if (h < 8 || /\b(tonight|evening|night|afternoon)\b/.test(low)) { if (h < 12) h += 12; } } time = pad(Math.min(h, 23)) + ':' + (m[2] || '00');
  }
  else if (/\bnoon\b|\blunch(?:time)?\b/.test(low)) time = '12:00';
  else if (/\bmidnight\b/.test(low)) time = '23:59';
  else if (/\bafter school\b/.test(low)) time = '15:30';
  else if (/\b(end of (?:the )?day|eod|close of business)\b/.test(low)) time = '17:00';
  else if (/\b(before bed|bedtime)\b/.test(low)) time = '20:30';
  else if (/\bdinner\b/.test(low)) time = '18:00';
  else if (/\bmorning\b/.test(low)) time = '09:00';
  else if (/\bafternoon\b/.test(low)) time = '15:00';
  else if (/\b(evening|tonight)\b/.test(low)) time = '19:00';
  else if (/\bnight\b/.test(low)) time = '20:00';
  const timeGiven = !!time;
  if (!time) time = ymd(d) === ymd(now) ? defaultDueTime() : '09:00';
  return { date: d, time, timeGiven };
}
function parseRelativeDate(text, now = new Date()) { return parseWhen(text, now).date; }
function parseTime(text) { return parseWhen(text).time; }
function cleanTitle(raw, place) {
  let s = ' ' + String(raw || '') + ' ';
  if (place) s = s.replace(new RegExp(`\\b(?:at|near|from|in)\\s+(?:the\\s+)?${place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ' ');
  /* "Jayden has", "my son needs to", "I've got to" … */
  s = s.replace(/\b(?:[A-Z][a-z]+|[Mm]y (?:son|daughter|kid|boy|girl|wife|husband)|[Hh]e|[Ss]he|[Ww]e|I|[Tt]hey)\s+(?:needs?|has|have|got|gotta|has got|have got|must|should)(?:\s+to)?\b/g, ' ');
  const kill = [
    /\b(?:um+|uh+|erm|like|oh man|hey|okay|ok|so|please|just|actually|basically|kinda|you know)\b/gi,
    /\b(?:can|could|would|will) you\b/gi, /\b(?:remind|tell|ping) (?:me|him|her|us|them)(?: to| that| about| of)?\b/gi,
    /\bdon'?t (?:let (?:me|him|her) )?forget(?: to| about)?\b/gi, /\bmake sure(?: (?:to|that|i|he|she|we))?\b/gi,
    /\b(?:i've|i have|i'?ve)? ?got(?:ta)? (?:to )?\b/gi, /\b(?:i|we) need(?: to)?\b/gi, /\bneed to\b/gi, /\bgo ahead and\b/gi, /\bthere(?:'s| is) (?:a|an)\b/gi,
    /\b(?:is |are |that's |it's )?due\b/gi,
    /\b(?:today|tonight|tomorrow|tmrw|day after tomorrow|this (?:morning|afternoon|evening|weekend)|later(?: today)?|next (?:week|month)|(?:on|over) the weekend|after school|(?:at )?end of (?:the )?day|before bed(?:time)?|bedtime|(?:at )?noon|(?:at )?midnight|(?:at )?lunch(?:time)?|in the (?:morning|afternoon|evening))\b/gi,
    /\b(?:every|each) (?:other )?(?:day|week|month|morning|night|evening|weekday|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?: (?:night|morning|evening|afternoon)s?)?\b/gi, /\b(?:daily|weekly|monthly)\b/gi,
    /\b(?:on |by |this |next |before )?(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?s?\b/gi,
    /\bin (?:half an|an?|one|two|three|four|five|six|seven|couple(?: of)?|few|\d+) (?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/gi,
    new RegExp('\\b(?:on |by )?' + MONTH_RX.source.slice(2), 'gi'), /\b(?:on |by )?(?:the )?\d{1,2}(?:st|nd|rd|th)\b/gi, /\b(?:on |by )?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
    /\b(?:remind|notify|alert|warn)(?: (?:me|him|her|us))? (?:again )?(?:\d{1,4}|an?|one|two) ?(?:minutes?|mins?|hours?|hrs?|days?) (?:before|early|ahead)\b/gi, /\b(?:\d{1,4}|an?|one|two|three|four|five|six|half an|a couple(?: of)?) ?(?:minutes?|mins?|hours?|hrs?|days?) (?:before|early|ahead)\b(?!\s+(?:bed|bedtime|school|dinner|lunch|work|class|practice|church|the|my|his|her|it))/gi,
    /\b(?:at|by|before|around|until)\s+\d{1,2}(?::\d{2})?(?:\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))?/gi, /\b\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)/gi,
    /\b(?:it's |its |this is )?(?:high priority|super urgent|urgent|asap|not urgent|important)\b/gi, /\brepeat\b/gi,
    /(?:\bfor |\bof )?\$\s?\d[\d,]*(?:\.\d{1,2})?/g, /\b(?:for |of )?\d[\d,]*(?:\.\d{1,2})?\s*(?:dollars|bucks|usd)\b/gi
  ];
  kill.forEach(r => { s = s.replace(r, ' '); });
  s = s.replace(/[,.;:!?]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\bpay for\b/i, 'Pay');
  for (let i = 0; i < 3; i++) s = s.replace(/^(?:to|for|and|the|a|an|on|by|at|of|with|that|about)\s+/i, '').replace(/\s+(?:to|for|and|the|a|an|on|by|at|of|with|that|about|it)$/i, '');
  return titleCase(s.split(' ').filter(Boolean).slice(0, 7).join(' ') || 'New Reminder');
}
function detectConf(text) {
  const m = String(text).match(/\b(?:confirmation|conf\.?|record locator|booking)\s*(?:number|code|no\.?|#)?\s*(?:is|:|#)?\s*([A-Z0-9]{5,8}|(?:[A-Z0-9][\s-]){4,7}[A-Z0-9])\b/i);
  if (!m) return ''; const c = m[1].replace(/[\s-]/g, '').toUpperCase();
  return /\d/.test(c) || /^[A-Z]{6}$/.test(c) ? c : '';
}
function detectAmount(text) {
  const m = String(text).match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/) || String(text).match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:dollars|bucks|usd)\b/i);
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
}
function detectCategory(text) {
  const low = text.toLowerCase();
  if (/\b(homework|assignment|worksheet|essay|quiz|test|exam|teacher|class|school|book report|study|reading log|science|math|english|history|project for|permission slip)\b/.test(low)) return 'School';
  if (/\b(grocer(y|ies)|supermarket|food shopping|milk|eggs|bread|produce|instacart|publix|aldi|kroger|winn[- ]?dixie|whole foods|trader joe'?s|costco|sam'?s club|bj'?s)\b/.test(low) && !/\b(pay|bill|membership)\b/.test(low)) return 'Groceries';
  if (/\b(work|client|email|meeting|proposal|project|boss|job|deadline|invoice|booking|bus|charter)\b/.test(low)) return 'Work';
  if (/\b(prescription|doctor|dentist|gym|medicine|medication|health|workout|pharmacy)\b/.test(low)) return 'Health';
  if (/\b(pay|bill|insurance|budget|bank|rent|mortgage|subscription)\b/.test(low)) return 'Bills';
  if (/\b(appointment|oil change|haircut|mechanic|barber)\b/.test(low)) return 'Appointments';
  if (/\b(pick up|pickup|buy|store|drop off|shopping|walmart|target)\b/.test(low)) return 'Errands';
  if (/\b(flight|hotel|trip|airport|pack|vacation)\b/.test(low)) return 'Travel';
  if (/\b(mom|dad|family|birthday|anniversary|grandma|grandpa|kids?)\b/.test(low)) return 'Family';
  return 'Personal';
}
function detectRepeat(text) {
  const low = text.toLowerCase();
  if (/\b(daily|every (?:day|morning|night|evening))\b/.test(low)) return 'daily';
  if (/\b(bi-?weekly|biweekly|every other week|every (?:two|2) weeks|fortnightly)\b/.test(low)) return 'biweekly';
  if (/\b(weekly|every (?:week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?)\b/.test(low)) return 'weekly';
  if (/\b(monthly|every month)\b/.test(low)) return 'monthly';
  return 'none';
}
function detectReminder(text) {
  const low = text.toLowerCase(), m = low.match(/(?:remind|notify|alert|warn)?(?:\s+(?:me|him|her|us))?(?:\s+again)?\s*(\d{1,4}|an?|one|two|three|four|five|six|half an)\s*(minutes?|mins?|hours?|hrs?|days?)\s+(?:before|early|ahead)\b(?!\s+(?:bed|bedtime|school|dinner|lunch|work|class|practice|church|the|my|his|her|it))/);
  if (m) { let v = /half/.test(m[1]) ? 0.5 : num(m[1]); if (/^h/.test(m[2])) v *= 60; if (/^d/.test(m[2])) v *= 1440; return Math.round(v); }
  if (/\b(high priority|urgent|asap)\b/.test(low)) return 0;
  return 15;
}
function detectLocation(text) {
  const m = String(text || '').match(/\b(?:at|near|from)\s+(?:the\s+)?([^.;,]+?)(?=\s+(?:today|tomorrow|tonight|later|before|by|at\s+\d|on\s+\w+day|next|this|every|repeat|daily|weekly|monthly|category|remind|notify|alert|make it|high priority|not urgent|after|around|in\s+\d)\b|[.;,]|$)/i);
  if (!m) return '';
  const place = m[1].trim();
  if (/^\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i.test(place) || /^(noon|night|midnight|lunch|home time|the end|end of|least|most|school\b.*)$/i.test(place) || place.split(' ').length > 6) return '';
  return place;
}
function buildKayaosJson(raw) {
  const now = new Date(); raw = String(raw || '').trim();
  const w = parseWhen(raw, now), d = w.date, time = w.time, diffH = (new Date(`${ymd(d)}T${time}`) - now) / 36e5;
  const high = /\b(high priority|urgent|asap|immediately|right away|forgot|missed)\b/i.test(raw) || diffH <= 6;
  const repeat = detectRepeat(raw), place = detectLocation(raw), cat = detectCategory(raw), title = cleanTitle(raw, place);
  return {
    task: { title, description: null, category: cat, target_date: ymd(d), target_time: time },
    location_context: { is_location_dependent: !!place, raw_address_or_venue: place || null, search_term_for_maps_api: place || null },
    urgency: { is_high_priority: !!high, time_window_hours: diffH > 12 ? Math.ceil(diffH) : 12 },
    recurrence: { enabled: repeat !== 'none', type: repeat, interval: 1 },
    reminders: { enabled: true, notification: true, sound: true, voice: true, times: [{ offset_minutes: detectReminder(raw) }] },
    ai: { voice_prompt: `${title}, ${fmtDate(d)} at ${fmtTime(time)}${place ? ', at ' + place : ''}.`, source: 'voice', system_timestamp: now.toISOString() }
  };
}
/* When signed in, the cloud AI (same Supabase function as voice notes, text mode) understands long, rambling sentences even better */
async function cloudParse(text) {
  if (!sb || !currentUser || !PROCESS_VOICE_FUNCTION_URL) return null;
  try {
    const { data: { session } } = await sb.auth.getSession(), fd = new FormData(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 7000);
    fd.append('text', text); fd.append('dry_run', '1'); fd.append('client_now', new Date().toString()); fd.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    const r = await fetch(PROCESS_VOICE_FUNCTION_URL, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${session?.access_token || ''}`, apikey: SUPABASE_ANON_KEY }, body: fd });
    clearTimeout(timer); if (!r.ok) return null;
    const out = await r.json(), j = out.aiPayload; if (!j?.task?.title) return null;
    return j;
  } catch (e) { return null; }
}

/* Backend audio fallback (only when browser has no speech recognition and Supabase is configured) */
let mediaRecorder = null, audioChunks = [];
async function toggleRecording() {
  if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); return; }
  try {
    audioChunks = []; const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = e => { if (e.data?.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => { stream.getTracks().forEach(t => t.stop()); $('#voiceBar').hidden = true; await sendToEdgeFunction(new Blob(audioChunks, { type: mime || 'audio/webm' }), mime.includes('mp4') ? 'm4a' : 'webm'); };
    mediaRecorder.start(); $('#voiceBar').hidden = false; $('#voiceLive').textContent = 'Recording… tap Stop when finished';
  } catch (err) { toast('Microphone permission needed'); }
}
async function sendToEdgeFunction(blob, ext) {
  toast('Processing voice…');
  const { data: { session } } = await sb.auth.getSession();
  const fd = new FormData(); fd.append('voice_note', blob, 'input.' + ext); fd.append('dry_run', '1'); fd.append('client_now', new Date().toString()); fd.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  try {
    const res = await fetch(PROCESS_VOICE_FUNCTION_URL, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}`, apikey: SUPABASE_ANON_KEY }, body: fd });
    const out = await res.json(); if (!res.ok) throw new Error(out.error || 'Voice processing failed');
    if (out.aiPayload) applyVoice(out.transcript || out.aiPayload.task?.title || '', out.aiPayload);
    else if (out.data) { const t = localTaskFromRow(out.data); tasks.push(t); saveTasks(); $('#taskDialog').close(); render(); toast('Voice card added'); }
  } catch (err) { toast(err.message || 'Voice processing failed'); }
}

/* ---------- Sound, voice, notifications ---------- */
let audioCtx = null;
function unlockAudio() {
  try { const A = window.AudioContext || window.webkitAudioContext; audioCtx = audioCtx || new A(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
  try { if ('speechSynthesis' in window && !unlockAudio.spoke) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); unlockAudio.spoke = true; } } catch (e) {}
}
/* Three-note bell chime */
function chime(times = 1) {
  try {
    unlockAudio(); const a = audioCtx; if (!a) return; const notes = [1046.5, 1318.5, 1568]; const t0 = a.currentTime + 0.03;
    for (let r = 0; r < times; r++) notes.forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(a.destination);
      const st = t0 + r * 0.95 + i * 0.17; g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.28, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 1.1); o.start(st); o.stop(st + 1.15);
    });
    if (navigator.vibrate) navigator.vibrate([200, 90, 200]);
  } catch (e) {}
}
/* Male / female voice choice. Browsers don't label gender, so we match well-known voice names
   (iPhone, Android/Google, Windows, Mac). If the device has none of the chosen kind, pitch makes the difference. */
const FEMALE_RX = /female|woman|samantha|karen|victoria|moira|tessa|fiona|veena|serena|allison|ava|susan|zira|aria|jenny|michelle|emma|libby|sonia|natasha|hazel|heather|catherine|kate|nicky|joanna|salli|kimberly|ivy|amy|martha|kathy|vicki|princess|shelley|flo|sandy|grandma|x-(?:sfg|iob|iog|tpc|tpf|cxx)|google us english$/i;
const MALE_RX = /\bmale\b|\bman\b|daniel|alex\b|fred|aaron|arthur|oliver|rishi|gordon|\blee\b|david|mark|\bguy\b|ryan|christopher|eric|roger|brian|thomas|james|george|william|matthew|justin|joey|evan|reed|rocko|ralph|bruce|junior|albert|\btom\b|eddy|grandpa|x-(?:iol|iom|tpd|bmh)/i;
function voiceGender(v) { const n = v.name; if (/female/i.test(n) || FEMALE_RX.test(n)) return 'female'; if (MALE_RX.test(n)) return 'male'; return ''; }
function englishVoices() { try { return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); } catch (e) { return []; } }
/* Accents: phone voices are chosen by language region; natural AI voices are told which accent to use */
const ACCENTS = { auto: ['', 'Automatic'], us: ['en-US', 'American'], uk: ['en-GB', 'British'], au: ['en-AU', 'Australian'], in: ['en-IN', 'Indian'], ie: ['en-IE', 'Irish'], za: ['en-ZA', 'South African'], jm: ['', 'Jamaican (natural voice)'], latam: ['', 'Latino / Spanish (natural voice)'] };
const CLOUD_VOICES = { female: [['marin', 'Marin'], ['coral', 'Coral'], ['nova', 'Nova'], ['shimmer', 'Shimmer'], ['sage', 'Sage']], male: [['onyx', 'Onyx (deep)'], ['ash', 'Ash'], ['cedar', 'Cedar'], ['echo', 'Echo'], ['verse', 'Verse']] };
const langOf = v => String(v.lang || '').replace('_', '-').toLowerCase();
const accentLang = () => (ACCENTS[settings.voiceAccent] || ACCENTS.auto)[0];
function voiceFor(gender = settings.voiceGender) {
  const all = englishVoices(), want = gender === 'male' ? 'male' : 'female', not = want === 'male' ? 'female' : 'male', acc = accentLang().toLowerCase();
  const chosen = settings.voiceURI && all.find(v => v.voiceURI === settings.voiceURI);
  if (chosen) return { voice: chosen, pitch: 1, matched: true, accentOk: true };
  const pool = acc ? all.filter(v => langOf(v) === acc) : all, src = pool.length ? pool : all, accentOk = !acc || pool.length > 0;
  const rank = v => (!acc && langOf(v) === 'en-us' ? 2 : 0) + (v.localService ? 1 : 0) + (/enhanced|premium|natural|neural|online/i.test(v.name) ? 3 : 0);
  const match = src.filter(v => voiceGender(v) === want).sort((a, b) => rank(b) - rank(a))[0];
  if (match) return { voice: match, pitch: 1, matched: true, accentOk };
  const other = src.filter(v => voiceGender(v) !== not).sort((a, b) => rank(b) - rank(a))[0] || src[0] || null;
  /* only a gentle shift — big pitch changes are what made the male voice sound robotic */
  return { voice: other, pitch: want === 'male' ? 0.78 : 1.06, matched: false, accentOk };
}
/* Brand name is said like the word "chaos" (KAY-oss) */
const sayable = txt => String(txt).replace(/kayaos(\.space)?/gi, (m, dot) => 'Chaos' + (dot ? ' dot space' : ''));
/* Natural AI voices (OpenAI via your Supabase "tts" function). Each sentence is fetched once, then kept on the phone. */
const useCloudVoice = () => !!(sb && currentUser && settings.voiceEngine !== 'device');
function cloudVoiceName() { const list = CLOUD_VOICES[settings.voiceGender === 'male' ? 'male' : 'female']; return list.some(v => v[0] === settings.cloudVoice) ? settings.cloudVoice : list[0][0]; }
let speakSeq = 0, currentSource = null;
async function cloudSpeak(text, seq) {
  const voice = cloudVoiceName(), accent = settings.voiceAccent || 'auto';
  let buf;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`v2|${voice}|${accent}|${text}`));
    const key = `https://kayaos-tts.local/${Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40)}.mp3`;
    const cache = window.caches ? await caches.open('kayaos-tts') : null;
    let res = cache && await cache.match(key);
    if (!res) {
      const { data: { session } } = await sb.auth.getSession(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(`${SUPABASE_URL}/functions/v1/tts`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}`, apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ text, voice, accent, gender: settings.voiceGender === 'male' ? 'male' : 'female' }) });
      clearTimeout(timer); if (!r.ok) throw new Error('tts ' + r.status);
      if (cache) await cache.put(key, r.clone());
      res = r;
    }
    buf = await res.arrayBuffer();
  } catch (e) { return false; }
  if (seq !== speakSeq) return true; /* something newer is already speaking */
  try {
    unlockAudio(); const audio = await audioCtx.decodeAudioData(buf.slice(0));
    try { currentSource?.stop(); } catch (e) {}
    const src = audioCtx.createBufferSource(); src.buffer = audio; src.connect(audioCtx.destination); src.start(); currentSource = src; return true;
  } catch (e) { return false; }
}
function deviceSpeak(txt) {
  try { if (!('speechSynthesis' in window)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(txt), vf = voiceFor(); if (vf.voice) { u.voice = vf.voice; u.lang = vf.voice.lang; } u.pitch = vf.pitch; u.rate = 1; speechSynthesis.speak(u); } catch (e) {}
}
function speak(txt) {
  txt = sayable(txt); const seq = ++speakSeq;
  try { speechSynthesis.cancel(); } catch (e) {}
  try { currentSource?.stop(); } catch (e) {}
  const native = window.KayaosNative && window.KayaosNative.speak ? t => { try { window.KayaosNative.speak(t); } catch (e) { deviceSpeak(t); } } : deviceSpeak;
  if (useCloudVoice() && txt.length <= 600) { cloudSpeak(txt, seq).then(ok => { if (!ok && seq === speakSeq) native(txt); }); return; }
  native(txt); /* Android app: real male/female voices from the phone's speech engine */
}
async function showNote(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  /* icon = the Kayaos logo; badge = a white K on transparent (Android draws the badge as a flat silhouette, so a full-colour logo shows as a block) */
  const opts = { body, tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', vibrate: [200, 100, 200] };
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.showNotification(title, opts); return; } } catch (e) {}
  try { new Notification(title, opts); } catch (e) {} /* Android PWAs only allow the service-worker path above */
}
async function askNotify() {
  unlockAudio(); chime();
  if (!('Notification' in window)) { toast('Sound is on. Pop-up notifications are not supported here.'); updateToolStates(); return; }
  let p = Notification.permission; if (p === 'default') p = await Notification.requestPermission();
  toast(p === 'granted' ? 'Notifications + sound on' : 'Sound is on. Allow notifications in browser settings for pop-ups.'); updateToolStates();
}

/* Spoken day: "today", "tomorrow", "yesterday", or "on Friday, October 17" */
function dayPhrase(d, now = new Date()) {
  const days = Math.round((new Date(ymd(d) + 'T12:00') - new Date(ymd(now) + 'T12:00')) / 864e5);
  if (days === 0) return 'today'; if (days === 1) return 'tomorrow'; if (days === -1) return 'yesterday';
  return 'on ' + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
/* Personal alert wording */
function alertText(t, occ, kind, now = new Date()) {
  if (t.amount && !t.__amt) return alertText({ ...t, __amt: 1, title: `${t.title}, ${money(t.amount)},` }, occ, kind, now).replace(/,\s*(\.|,)/g, '$1').replace(/,(\s+(?:is|was))/g, '$1');
  const name = t.forName || (t.category === 'School' ? settings.studentName : '') || settings.name;
  const hey = name ? `Hey ${name}, ` : '', at = fmtTime(t.time), diff = occ ? occ - now : 0, school = t.category === 'School', dp = occ ? dayPhrase(occ, now) : '';
  if (kind === 'start') return `${hey}it's time to start ${t.title}.${occ ? ` It's due ${dp} at ${at}.` : ''}${school ? ' You can do this.' : ''}`;
  if (kind === 'checkin') return `${hey}check-in is open for ${t.title}. It leaves ${dp} at ${at}${t.terminal ? ` from Terminal ${t.terminal}` : ''}.${t.flightNo ? ` Flight ${t.flightNo.replace(/^([A-Z0-9]{2}) /, (m, c) => c.split('').join(' ') + ' ')}.` : ''}${t.conf ? ` Your confirmation number is ${t.conf.split('').join(' ')}.` : ''}`;
  if (kind === 'due') return `${hey}${t.title} is due right now${school ? '. Finish it up and turn it in.' : '.'}`;
  const finish = t.proof ? 'then take a photo to show it’s done.' : 'then tap done.';
  if (diff < -60000) return `${name ? name + ', ' : ''}${t.title} was due ${dp} at ${at}. That's ${durSpoken(-diff)} late. ${school ? "Let's get it done and turned in, " + finish : 'Finish it, ' + finish}`;
  if (kind === 'nag') return `${hey}reminder: ${t.title} is due ${dp} at ${at}, in ${durSpoken(diff)}. ${school ? "You've got this — keep going." : ''}`;
  return `${hey}${t.title} is due ${dp} at ${at}. That's in ${durSpoken(diff)}.${school ? ' Time to get started.' : ''}`;
}
function fireAlert(t, occ, kind, key, msgOverride) {
  if (notified.has(key)) return; notified.add(key); store(K.notified, [...notified].slice(-400));
  const msg = msgOverride || alertText(t, occ, kind);
  showNote(t.category === 'School' ? '📚 ' + t.title : 'Kayaos: ' + t.title, msg, t.id);
  toast(msg);
  const nagging = kind === 'nag' && !!occ && occ < new Date();
  if (t.alert === 'both' || t.alert === 'chime') chime(nagging ? 2 : 1);
  if (t.alert === 'both' || t.alert === 'voice') setTimeout(() => speak(msg), t.alert === 'both' ? (nagging ? 2000 : 1100) : 0);
}
/* Runs every 15s: lead-time alert, due-time alert, and "keep reminding until done" */
function tickAlerts() {
  if (window.KayaosNative) return; /* Android app: alarms are scheduled natively (they ring even when the app is closed) */
  const now = new Date();
  for (const t of tasks) {
    if (!alertsForMe(t)) continue;
    const occ = relevantOcc(t, now), win = 3 * 60000; if (occ ? isDoneOn(t, occ) : t.done) continue;
    const st = startOf(t, occ), base = `${t.id}|${occ ? occ.getTime() : 'any'}`;
    /* "time to start" — only for starts that were set in the future (not the default "now") */
    if (st && now >= st && now - st < win && st - t.createdAt > 60000) fireAlert(t, occ, 'start', base + '|start');
    if (!occ) continue;
    const lead = +t.reminder || 0, alertAt = new Date(occ - lead * 60000);
    if (now >= alertAt && now - alertAt < win && !(st && Math.abs(alertAt - st) < win && st - t.createdAt > 60000)) fireAlert(t, occ, 'lead', base + '|lead');
    if (lead > 0 && now >= occ && now - occ < win) fireAlert(t, occ, 'due', base + '|due');
    if (t.checkin) { const ci = new Date(occ - 864e5); if (now >= ci && now - ci < win) fireAlert(t, occ, 'checkin', base + '|checkin'); }
    if (t.nag > 0 && now >= alertAt && now - occ < 12 * 36e5) {
      const n = Math.floor((now - alertAt) / (t.nag * 60000)); if (n > 0 && !inQuietHours(now)) fireAlert(t, occ, 'nag', `${base}|nag${n}`);
    }
  }
}

/* ---------- Bottom bar: core screens + up to 5 categories the user picks ---------- */
const MAXCATS = 5;
const CORE = [['cards', '✓', 'Cards'], ['week', '▦', 'Week'], ['day', '◷', 'Day'], ['place', '⌖', 'Place']];
const CAT_ICON = { Work: '💼', Personal: '🙂', School: '📚', Fuel: '⛽', Errands: '🛍️', Groceries: '🛒', Bills: '💵', Appointments: '📅', Travel: '✈️', Family: '🏠', Health: '❤️' };
const allCats = () => [...new Set([...CATS, 'Fuel', ...tasks.map(t => t.category), ...barCats()])];
const barCats = () => (settings.barCats || []).slice(0, MAXCATS);
function catCounts(c) { const l = tasks.filter(t => t.category === c && !isDone(t)); return { open: l.length, late: l.filter(t => urgency(t) === 'missed').length }; }
function openCategory(c) { if (c === 'School') { setView('school'); return; } if (c === 'Fuel') { setView('fuel'); return; } selectedCat = c; $('#searchInput').value = ''; setView('cards'); }
function renderNav() {
  const inBar = v => CORE.some(x => x[0] === v) || (view === 'cards' && selectedCat !== 'All') || (view === 'school' && barCats().includes('School')) || (view === 'fuel' && barCats().includes('Fuel'));
  const core = CORE.map(([v, ic, l]) => `<button class="navItem ${view === v && !(v === 'cards' && selectedCat !== 'All') ? 'active' : ''}" data-nav="v:${v}" title="${l}"><span class="ic">${ic}</span><span>${l}</span></button>`).join('');
  const cats = barCats().map(c => {
    const n = catCounts(c), on = (view === 'cards' && selectedCat === c) || (view === 'school' && c === 'School') || (view === 'fuel' && c === 'Fuel');
    return `<button class="navItem navCat ${on ? 'active' : ''}" data-nav="c:${esc(c)}" title="${esc(c)}${n.open ? ` · ${n.open} open` : ''}"><span class="ic">${CAT_ICON[c] || '🏷️'}</span><span class="nl">${esc(c)}</span>${n.open ? `<span class="count ${n.late ? '' : 'calm'}">${n.open}</span>` : ''}</button>`;
  }).join('');
  const add = barCats().length < MAXCATS ? `<button class="navItem navAdd" data-nav="pick" aria-label="Choose categories for this bar"><span class="ic">＋</span><span>${barCats().length ? 'Category' : 'Categories'}</span></button>` : '';
  const tw = teamWaiting(), moreOn = !inBar(view);
  const nItems = CORE.length + barCats().length + (add ? 1 : 0) + 1; $('#navBar').classList.toggle('compact', nItems >= 9);
  $('#navBar').innerHTML = core + (cats || add ? '<span class="navSep" aria-hidden="true"></span>' : '') + cats + add + `<button class="navItem ${moreOn ? 'active' : ''}" data-nav="more"><span class="ic">☰</span><span>More</span>${tw ? `<span class="count">${tw}</span>` : ''}</button>`;
}
$('#navBar').addEventListener('click', e => {
  const b = e.target.closest('[data-nav]'); if (!b) return; const k = b.dataset.nav;
  if (k.startsWith('v:')) { if (k === 'v:cards') selectedCat = 'All'; setView(k.slice(2)); }
  else if (k.startsWith('c:')) openCategory(k.slice(2));
  else if (k === 'pick') openCatPicker();
  else if (k === 'more') openMore();
});
/* More menu: everything not in the bar */
function openMore() {
  const tw = teamWaiting(), extra = allCats().filter(c => !barCats().includes(c) && c !== 'Fuel');
  $('#moreList').innerHTML = `<div class="moreCats">${CORE.map(([v, ic, l]) => `<button class="cat" data-more="view:${v}">${ic} ${l}</button>`).join('')}</div>` + [
    ['team', '👥', 'Team', tw ? `${tw} waiting for you` : 'Shared cards'],
    ['school', '📚', 'School', 'Assignments + student alerts'],
    ['work', '💼', 'Work', 'Hours, pay rate, earnings and payments'],
    ['bills', '🧾', 'Bills', 'Due dates, payments and balances'],
    ['fuel', '📍', 'Around me', 'Gas, groceries and places near you'],
    ...(isOwner ? [['owner', '👑', 'Owner dashboard', 'Users, cards and storage']] : []),
    ['settings', '⚙', 'Settings', 'Name, voice, account']
  ].map(([k, ic, l, d]) => `<button class="toolItem" data-more="${k}"><span class="ti">${ic}</span><strong>${l}</strong><span>${d}</span></button>`).join('')
    + (extra.length ? `<div class="groupLbl" style="margin:8px 4px 2px">Other categories</div><div class="moreCats">${extra.map(c => `<button class="cat" data-more="cat:${esc(c)}">${CAT_ICON[c] || '🏷️'} ${esc(c)}</button>`).join('')}</div>` : '');
  $('#moreDialog').showModal();
}
$('#moreDialog').addEventListener('click', e => {
  const b = e.target.closest('[data-more]'); if (!b) return; const k = b.dataset.more; $('#moreDialog').close();
  if (k.startsWith('view:')) { if (k === 'view:cards') selectedCat = 'All'; setView(k.slice(5)); } else if (k === 'team' || k === 'school' || k === 'work' || k === 'bills' || k === 'fuel') setView(k); else if (k === 'owner') openOwner(); else if (k === 'settings') $('#settingsBtn').click(); else if (k === 'pick') openCatPicker(); else if (k.startsWith('cat:')) openCategory(k.slice(4));
});
/* Category picker (up to 5, in the order picked; can add a new category name) */
let pickOrder = [];
function openCatPicker() {
  const sel = barCats();
  const list = [...sel, ...allCats().filter(c => !sel.includes(c))];
  $('#pickList').innerHTML = list.map(c => { const n = catCounts(c); return `<label class="toggle"><input type="checkbox" value="${esc(c)}" ${sel.includes(c) ? 'checked' : ''}><span>${CAT_ICON[c] || '🏷️'} ${esc(c)} <small class="sub">· ${n.open} open</small></span></label>`; }).join('');
  pickOrder = sel.slice(); $('#newCat').value = ''; updatePickCount(); renderPickOrder(); $('#pickDialog').showModal();
}
function updatePickCount() {
  const boxes = $$('#pickList input'), n = boxes.filter(b => b.checked).length;
  $('#pickCount').textContent = `${n} of ${MAXCATS} selected`; boxes.forEach(b => { b.disabled = !b.checked && n >= MAXCATS; });
}
$('#pickList').addEventListener('change', e => { const v = e.target.value; pickOrder = pickOrder.filter(x => x !== v); if (e.target.checked) pickOrder.push(v); updatePickCount(); renderPickOrder(); });
function renderPickOrder() {
  const live = pickOrder.filter(c => $$('#pickList input:checked').some(b => b.value === c));
  $('#pickOrder').innerHTML = live.length ? `<div class="groupLbl">Order in your bar (left → right)</div>` + live.map((c, i) => `<div class="orderRow"><span class="num">${i + 1}</span><span class="on">${CAT_ICON[c] || '🏷️'} ${esc(c)}</span><button type="button" class="mini" data-move="${i}|-1" ${i ? '' : 'disabled'} aria-label="Move ${esc(c)} left">▲</button><button type="button" class="mini" data-move="${i}|1" ${i < live.length - 1 ? '' : 'disabled'} aria-label="Move ${esc(c)} right">▼</button></div>`).join('') : '';
}
$('#pickOrder').addEventListener('click', e => {
  const b = e.target.closest('[data-move]'); if (!b) return; const [i, d] = b.dataset.move.split('|').map(Number);
  const live = pickOrder.filter(c => $$('#pickList input:checked').some(x => x.value === c)), j = i + d; if (j < 0 || j >= live.length) return;
  [live[i], live[j]] = [live[j], live[i]]; pickOrder = live.concat(pickOrder.filter(c => !live.includes(c))); renderPickOrder();
});
$('#newCatAdd').addEventListener('click', () => {
  const name = $('#newCat').value.trim().replace(/\s+/g, ' ').slice(0, 24); if (!name) return;
  const exist = $$('#pickList input').find(b => b.value.toLowerCase() === name.toLowerCase());
  if (exist) { if (!exist.disabled && !exist.checked) { exist.checked = true; pickOrder.push(exist.value); } }
  else $('#pickList').insertAdjacentHTML('beforeend', `<label class="toggle"><input type="checkbox" value="${esc(name)}" ${$$('#pickList input:checked').length < MAXCATS ? 'checked' : ''}><span>🏷️ ${esc(name)} <small class="sub">· new</small></span></label>`);
  if ($$('#pickList input:checked').some(b => b.value === name)) pickOrder.push(name);
  $('#newCat').value = ''; updatePickCount(); renderPickOrder();
});
$('#pickSave').addEventListener('click', () => {
  const checked = $$('#pickList input:checked').map(b => b.value);
  settings.barCats = pickOrder.filter(c => checked.includes(c)).slice(0, MAXCATS); saveSettings(); $('#pickDialog').close(); render();
});
function whatsDue() {
  const open = schoolTasks().filter(x => !isDone(x) && x.hasDue).sort(byUrgency).slice(0, 4), n = settings.studentName;
  speak(open.length ? `${n ? 'Hey ' + n + ', ' : ''}here's what's due. ` + open.map(x => { const o = relevantOcc(x); return `${x.title}, ${o < new Date() ? 'which is late' : (ymd(o) === ymd(new Date()) ? 'today' : fmtDate(o)) + ' at ' + fmtTime(x.time)}`; }).join('. ') : `${n ? n + ', y' : 'Y'}ou're all caught up. Nice work!`);
}

/* ---------- Clear / delete / demo ---------- */
async function removeTasks(ids) {
  const synced = tasks.filter(t => ids.includes(t.id) && t.user_id).map(t => t.id);
  tasks.filter(t => ids.includes(t.id)).forEach(t => t.media.forEach(m => { MediaDB.del(m.id).catch(() => {}); if (m.path && sb && currentUser && sb.storage) sb.storage.from('kayaos-media').remove([m.path]).catch(() => {}); }));
  tasks = tasks.filter(t => !ids.includes(t.id)); wDropCards(ids); saveTasks(); render();
  if (sb && currentUser && synced.length) { const { error } = await sb.from('tasks').delete().in('id', synced); if (error) toast('Cloud delete failed: ' + error.message); }
}
function openClear() {
  const done = tasks.filter(t => t.done && (t.repeat === 'none' || !t.hasDue)).length, demo = tasks.filter(t => t.demo).length;
  $('#cDone').textContent = `(${done})`; $('#cDemo').textContent = `(${demo})`; $('#cAll').textContent = `(${tasks.length})`;
  $('[data-clear="done"]').disabled = !done; $('[data-clear="demo"]').disabled = !demo; $('[data-clear="all"]').disabled = !tasks.length;
  $('#clearDialog').showModal();
}
$('#clearDialog').addEventListener('click', e => {
  const b = e.target.closest('[data-clear]'); if (!b) return; const k = b.dataset.clear; let ids = [];
  if (k === 'done') ids = tasks.filter(t => t.done && (t.repeat === 'none' || !t.hasDue)).map(t => t.id);
  if (k === 'demo') ids = tasks.filter(t => t.demo).map(t => t.id);
  if (k === 'all') { if (!confirm(`Delete all ${tasks.length} cards? This can't be undone.`)) return; ids = tasks.map(t => t.id); }
  removeTasks(ids); $('#clearDialog').close(); toast(`${ids.length} card${ids.length === 1 ? '' : 's'} cleared`);
});
function loadDemo() {
  const n = new Date(), at = (days, hm) => { const d = addDays(n, days); return { date: ymd(d), time: hm }; };
  const inMin = m => { const d = new Date(Date.now() + m * 60000); return { date: ymd(d), time: pad(d.getHours()) + ':' + pad(d.getMinutes()) }; };
  const startIn = m => { const x = inMin(m); return { startDate: x.date, startTime: x.time }; };
  const demo = [
    { title: 'Math worksheet 4.2', category: 'School', ...inMin(90), ...startIn(-30), reminder: 60, nag: 10, alert: 'both', notes: 'Problems 1–20, show work' },
    { title: 'Science lab report', category: 'School', ...at(-1, '20:00'), reminder: 60, nag: 10, alert: 'both' },
    { title: 'Pay insurance', category: 'Bills', ...at(0, '17:00'), repeat: 'monthly', amount: 142.5 },
    { title: 'Pickup supplies', category: 'Errands', ...inMin(45), place: 'Downtown Miami' },
    { title: 'Client follow-up', category: 'Work', ...at(1, '10:15'), repeat: 'daily' },
    { title: 'Family dinner', category: 'Family', ...at(2, '18:00'), startDate: ymd(addDays(n, 2)), startTime: '17:00', repeat: 'weekly', place: 'Home' },
    { title: 'Read 20 minutes', category: 'Personal', hasDue: false }
  ].map(d => normalize({ ...d, hasDue: d.hasDue ?? true, demo: true, createdAt: Date.now() - 3 * 36e5 }));
  tasks = tasks.filter(t => !t.demo).concat(demo); saveTasks();
  render();
  toast('Demo cards added — clear them anytime from ⋯');
}

/* ---------- Location: map, tracking, sharing ---------- */
let leafletMap = null, leafletLayer = null;
function getPosition() {
  return new Promise(res => {
    if (!navigator.geolocation) { toast('Location not available on this device'); return res(null); }
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }), () => { toast('Location permission needed'); res(null); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}
function addCheckin(p) { locs.unshift({ ...p, address: '' }); saveLocs(); checkNear(p); if (view === 'place') renderMap(); }
/* "Remind me when I'm near this place" — checked on every location update while Kayaos is open */
function distM(a, b) { const R = 6371000, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng), h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function checkNear(p) {
  for (const t of tasks) {
    if (!t.nearMe || isDone(t) || !alertsForMe(t)) continue;
    const c = coordFromTask(t); if (!c || distM(p, c) > 350) continue;
    const key = `${t.id}|near|${Math.floor(Date.now() / (3 * 36e5))}`; if (notified.has(key)) continue;
    const left = t.checklist.filter(i => !i.d).map(i => i.t), name = t.forName || settings.name;
    fireAlert(t, null, 'near', key, `${name ? 'Hey ' + name + ', ' : ''}you're near ${t.place || 'the spot for ' + t.title}. ${t.title}${left.length ? ' — you still need ' + listSay(left.slice(0, 8)) + (left.length > 8 ? ', and more' : '') : ''}.`);
  }
}
let lastCheckinAt = 0;
function onTrackedPosition(pos) {
  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now() };
  if (Date.now() - lastCheckinAt > 15 * 60000) { lastCheckinAt = Date.now(); addCheckin(p); } else checkNear(p);
}
async function checkOnce() { const p = await getPosition(); if (p) { addCheckin(p); toast('Location updated'); } }
function toggleTracking(force) {
  const turnOn = typeof force === 'boolean' ? force : !geoTimer;
  if (!turnOn) { try { navigator.geolocation.clearWatch(geoTimer.id); } catch (e) {} geoTimer = null; settings.tracking = false; saveSettings(); toast('Tracking off'); }
  else if (!geoTimer) {
    if (!navigator.geolocation) { toast('Location not available on this device'); return; }
    lastCheckinAt = 0;
    geoTimer = { id: navigator.geolocation.watchPosition(onTrackedPosition, () => toast('Location permission needed'), { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 }) };
    settings.tracking = true; saveSettings(); if (typeof force !== 'boolean') toast('Tracking on while Kayaos is open (check-in saved every 15 min)');
  }
  updateToolStates();
}
async function shareLocation() {
  const p = await getPosition(); if (!p) return; addCheckin(p);
  const url = `https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`, text = `${settings.name ? settings.name + "'s" : 'My'} current location`;
  if (navigator.share) { try { await navigator.share({ title: 'My location', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Location link copied — paste it anywhere'); } catch (e) { prompt('Copy this location link:', url); }
}
async function reverseAddress(l) {
  if (l.address) return l.address;
  try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${l.lat}&lon=${l.lng}`); const j = await r.json(); l.address = j.display_name || ''; saveLocs(); return l.address; } catch (e) { return ''; }
}
async function geocodeAddress(q) {
  try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`); const j = await r.json(); if (j?.[0]) return { lat: +j[0].lat, lng: +j[0].lon, address: j[0].display_name || q }; } catch (e) {}
  return null;
}
function coordFromTask(t) {
  const c = t.gps_coordinates; if (!c) return null;
  if (typeof c === 'object' && c.lat !== undefined) return { lat: +c.lat, lng: +c.lng };
  if (typeof c === 'object' && c.y !== undefined) return { lat: +c.y, lng: +c.x };
  if (typeof c === 'string') { const m = c.match(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/); if (m) return { lng: +m[1], lat: +m[2] }; }
  return null;
}
async function renderMap(focus) {
  const box = $('#mapbox');
  if (!window.L) { box.innerHTML = '<div class="empty">Map is loading — check your internet connection.</div>'; return; }
  if (!leafletMap) { box.innerHTML = ''; leafletMap = L.map(box, { zoomControl: true }).setView([25.7617, -80.1918], 12); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(leafletMap); }
  setTimeout(() => leafletMap.invalidateSize(), 60);
  leafletLayer?.remove(); leafletLayer = L.layerGroup().addTo(leafletMap);
  const last = locs[0], pins = tasks.map(t => ({ t, c: coordFromTask(t) })).filter(x => x.c);
  for (const { t, c } of pins) L.marker([c.lat, c.lng]).addTo(leafletLayer).bindPopup(`<b>${esc(t.title)}</b><br>${esc(t.place || '')}`);
  if (last) L.circleMarker([last.lat, last.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#ff8a34', fillOpacity: 1 }).addTo(leafletLayer).bindPopup('<b>You were here</b>');
  const target = focus || (last ? { lat: last.lat, lng: last.lng } : pins[0]?.c);
  if (target) leafletMap.setView([target.lat, target.lng], 14);
  const nav = $('#navigateLink'); if (target) nav.href = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`; else nav.removeAttribute('href');
  $('#locList').innerHTML = locs.length ? locs.map((l, i) => `<div class="locItem">${new Date(l.ts).toLocaleString()}<br><span data-addr="${i}">${esc(l.address || `${(+l.lat).toFixed(5)}, ${(+l.lng).toFixed(5)}`)}</span></div>`).join('') : '<div class="empty">No check-ins yet. Tap “Check in now”.</div>';
  $('#locStatus').textContent = `${geoTimer ? 'Tracking on — every 15 min while open.' : 'Tracking off.'}${last ? ' Last check-in ' + new Date(last.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : ''}`;
  if (last && !last.address) { const a = await reverseAddress(last); const el = $('[data-addr="0"]'); if (a && el) el.textContent = a; }
}
async function showTaskOnMap(t) {
  let c = coordFromTask(t);
  if (!c && t.place) { toast('Finding address…'); const g = await geocodeAddress(t.place); if (g) { c = { lat: g.lat, lng: g.lng }; t.gps_coordinates = c; saveTasks(); pushTask(t); toast(`Found: ${g.address}`); } else { toast('Address not found'); return; } }
  setView('place'); renderMap(c);
  if (t.place) $('#navigateLink').href = directionsURL(t);
}

/* ---------- Supabase accounts + sync ---------- */
const SUPABASE_URL = window.KAYAOS_SUPABASE_URL || '', SUPABASE_ANON_KEY = window.KAYAOS_SUPABASE_ANON_KEY || '';
const PROCESS_VOICE_FUNCTION_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/process-voice-task` : '';
let sb = null, currentUser = null;
function rowFromTask(t) {
  const c = coordFromTask(t);
  return {
    id: t.id, title: t.title, description: t.notes || null, category: t.category,
    target_date: t.hasDue ? t.date : null, target_time: t.hasDue ? t.time : null, repeat_type: t.repeat, reminder_minutes: t.reminder,
    alert_style: t.alert, nag_minutes: t.nag, assignee_name: t.forName || null,
    is_location_dependent: !!t.place, raw_address_or_venue: t.place || null, search_term_for_maps_api: t.place || null, gps_coordinates: c ? `(${c.lng},${c.lat})` : null,
    is_high_priority: ['hot', 'urgent', 'missed'].includes(urgency(t)), time_window_hours: 12, is_completed: t.done, completed_for: t.doneFor, start_date: t.startDate || null, start_time: t.startDate ? t.startTime : null, checklist: t.checklist, near_me: t.nearMe, media: t.media, proof_required: t.proof, amount: t.amount || null, link: t.link || null, link_app: t.payApp || null, confirmation: t.conf || null, checkin_reminder: !!t.checkin, flight_no: t.flightNo || null, terminal: t.terminal || null, payments: t.payments, installments: t.installments || 0, review: t.review || null, done_at: t.doneAt ? new Date(t.doneAt).toISOString() : null,
    team_id: t.teamId, assigned_to: t.teamId ? t.assignedTo : null, completed_by: t.completedBy
  };
}
function localTaskFromRow(r) {
  return normalize({
    id: r.id, title: r.title, category: r.category || 'Personal', hasDue: !!r.target_date, date: r.target_date || '', time: (r.target_time || '09:00').slice(0, 5),
    repeat: r.repeat_type || 'none', reminder: r.reminder_minutes ?? 15, alert: r.alert_style || settings.alert, nag: r.nag_minutes || 0, forName: r.assignee_name || '',
    place: r.raw_address_or_venue || '', gps_coordinates: r.gps_coordinates || null, notes: r.description || '', done: !!r.is_completed, doneFor: r.completed_for || null,
    startDate: r.start_date || '', startTime: (r.start_time || '').slice(0, 5), checklist: r.checklist || [], nearMe: !!r.near_me, media: r.media || [], proof: !!r.proof_required, amount: +r.amount || 0, link: r.link || '', payApp: r.link_app || null, conf: r.confirmation || '', checkin: !!r.checkin_reminder, flightNo: r.flight_no || '', terminal: r.terminal || '', payments: r.payments || [], installments: +r.installments || 0, review: r.review || null, doneAt: r.done_at ? Date.parse(r.done_at) : null,
    teamId: r.team_id || null, assignedTo: r.assigned_to || null, completedBy: r.completed_by || null,
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(), user_id: r.user_id
  });
}
async function pushTask(t) {
  if (!sb || !currentUser || t.demo) return;
  /* Existing cloud cards use UPDATE (an upsert would fail the "create" rule for a teammate's card) */
  const row = rowFromTask(t), { error } = t.user_id ? await sb.from('tasks').update(row).eq('id', t.id) : await sb.from('tasks').upsert({ ...row, user_id: currentUser.id });
  if (error) toast('Cloud sync failed: ' + error.message); else if (!t.user_id) { t.user_id = currentUser.id; saveTasks(); }
}
async function syncTasks() {
  if (!sb || !currentUser) return;
  for (const t of tasks.filter(t => !t.user_id && !t.demo)) await pushTask(t); /* upload local-only cards first so nothing is lost */
  const { data, error } = await sb.from('tasks').select('*').order('target_date', { ascending: true });
  if (error) { toast(error.message); return; }
  tasks = (data || []).map(localTaskFromRow).concat(tasks.filter(t => t.demo)); saveTasks();
  await loadTeams(); subscribeRealtime(); render(); toast('Cards synced'); handlePendingJoin();
}
function refreshAuthUI() {
  const cloud = !!sb; $('#cloudHint').hidden = cloud; $('#authForm').hidden = !cloud;
  $('#acctForm').hidden = !cloud;
  /* Saved login: fill the last email used here, in case the browser only fills the password */
  const ae = $('#authEmail'); if (!currentUser && ae && !ae.value) { try { ae.value = localStorage.getItem('kayaos.lastEmail') || ''; } catch {} }
  $('#authStatus').textContent = !cloud ? 'Local mode — cards are saved on this device.' : currentUser ? `Signed in as ${currentUser.email}` : 'Not signed in. Local mode still works.';
  $('#signInBtn').hidden = $('#signUpBtn').hidden = $('#authEmail').hidden = $('#authPassword').hidden = !!currentUser;
  $('#signOutBtn').hidden = $('#syncBtn').hidden = !currentUser;
  /* Signed in: change the email or the password from here */
  $('#emailRow').hidden = $('#newPwRow').hidden = !currentUser;
  /* Account entry in the header, on every screen: opens Settings where sign-in and sign-up live */
  const acc = $('#accountBtn'); if (acc) { acc.hidden = !!currentUser; acc.onclick = () => $('#settingsBtn').click(); }
}
async function signInOrUp(mode) {
  if (!sb) { toast('Cloud accounts are off. Add your Supabase URL and key in config.user.js'); return; }
  const email = $('#authEmail').value.trim(), password = $('#authPassword').value;
  if (!email || !password) { toast('Email and password required'); return; }
  const res = mode === 'up' ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  if (res.error) { toast(res.error.message); return; }
  rememberLogin(email, password);
  if (mode === 'up' && !res.data.session) { toast('Check your email to confirm the account'); return; }
}
/* Save the email with the password, so the browser's saved login fills both fields next time */
function rememberLogin(email, password) {
  try { localStorage.setItem('kayaos.lastEmail', email); } catch {}
  try { if (window.PasswordCredential && navigator.credentials?.store) navigator.credentials.store(new PasswordCredential({ id: email, password, name: email })).catch(() => {}); } catch {}
}
/* Password: show or hide it, reset it by email, and set a new one from the reset link */
$('#pwToggle').onclick = () => { const i = $('#authPassword'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; $('#pwToggle').textContent = show ? 'Hide' : 'Show'; };
$('#forgotBtn').onclick = async () => {
  if (!sb) { toast('Cloud accounts are off. Add your Supabase URL and key in config.user.js'); return; }
  const email = $('#authEmail').value.trim(); if (!email) { toast('Type your email first'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  toast(error ? error.message : 'Check your email for a reset link');
};
$('#saveEmailBtn').onclick = async () => {
  if (!sb || !currentUser) return;
  const email = $('#newEmail').value.trim(); if (!email) { toast('Type the new email address'); return; }
  const { error } = await sb.auth.updateUser({ email });
  if (error) { toast(error.message); return; }
  $('#newEmail').value = ''; toast('Check your new inbox to confirm the change');
};
$('#savePwBtn').onclick = async () => {
  if (!sb) return;
  const pw = $('#newPassword').value; if (pw.length < 6) { toast('Use at least 6 characters'); return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) { toast(error.message); return; }
  $('#newPassword').value = ''; $('#newPwRow').hidden = true; toast('Password updated');
};
async function initAuth() {
  /* A reset link opens the app with type=recovery in the address; read it before the client clears it */
  const recovering = /type=recovery/.test(location.hash);
  if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (sb) {
    const { data: { session } } = await sb.auth.getSession(); currentUser = session?.user || null;
    if (recovering) { $('#newPwRow').hidden = false; $('#settingsBtn').click(); }
    sb.auth.onAuthStateChange((evt, s) => {
      if (evt === 'PASSWORD_RECOVERY') { $('#newPwRow').hidden = false; $('#settingsBtn').click(); }
      const was = currentUser?.id; currentUser = s?.user || null; refreshAuthUI(); checkOwner();
      if (currentUser && currentUser.id !== was) { syncTasks(); if (typeof fuelSync === 'function') fuelSync(); if (typeof workSync === 'function') workSync(); }
      if (!currentUser && was) { /* signed out: drop teammates' cards, keep your own */
        if (rtChannel) { sb.removeChannel(rtChannel); rtChannel = null; }
        tasks = tasks.filter(t => !t.teamId || t.user_id === was); teams = []; members = {}; teamSel = null; teamFilter = 'all'; saveTasks(); render();
      }
    });
    if (currentUser) { syncTasks(); if (typeof fuelSync === 'function') fuelSync(); if (typeof workSync === 'function') workSync(); }
    checkOwner();
  }
  refreshAuthUI(); if (!currentUser) handlePendingJoin();
}
$('#signInBtn').onclick = () => signInOrUp('in'); $('#signUpBtn').onclick = () => signInOrUp('up');
$('#signOutBtn').onclick = async () => { await sb.auth.signOut(); toast('Signed out — cards and fuel stay on this device'); };
$('#syncBtn').onclick = () => { syncTasks(); if (typeof workSync === 'function') workSync(); };

/* ---------- Teams: shared cards, assignments, live updates ---------- */
let teams = [], members = {}, teamSel = null, teamFilter = 'all', rtChannel = null, teamsError = '';
const myId = () => currentUser?.id || null;
const myDisplayName = () => settings.name || (currentUser?.email || '').split('@')[0] || 'Me';
const teamName = id => teams.find(t => t.id === id)?.name || 'Team';
const memberName = (tid, uid) => uid && uid === myId() ? 'You' : (members[tid] || []).find(m => m.user_id === uid)?.display_name || 'Teammate';
const isTeamOwner = tid => teams.find(t => t.id === tid)?.role === 'owner';
const openFor = (tid, uid) => tasks.filter(t => t.teamId === tid && t.assignedTo === uid && !isDone(t)).length;
function canDelete(t) { return !t.teamId || !t.user_id || t.user_id === myId() || isTeamOwner(t.teamId); }
/* Team cards only alert the person they're assigned to (unassigned team cards alert everyone) */
function alertsForMe(t) { return !t.teamId || !currentUser || !t.assignedTo || t.assignedTo === myId(); }

async function loadTeams() {
  if (!sb || !currentUser) { teams = []; members = {}; return; }
  const { data, error } = await sb.from('team_members').select('team_id, user_id, display_name, role, teams(id, name, owner_id, invite_code)');
  if (error) { teamsError = /does not exist|schema cache/i.test(error.message) ? 'schema' : error.message; render(); return; }
  teamsError = ''; members = {}; teams = [];
  for (const r of data || []) {
    (members[r.team_id] ||= []).push({ user_id: r.user_id, display_name: r.display_name, role: r.role });
    if (r.user_id === myId() && r.teams) teams.push({ ...r.teams, role: r.role });
  }
  teams.sort((a, b) => a.name.localeCompare(b.name));
  Object.values(members).forEach(l => l.sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.display_name.localeCompare(b.display_name)));
  if (!teams.some(t => t.id === teamSel)) teamSel = teams[0]?.id || null;
  render();
}
function teamWaiting() { return currentUser ? tasks.filter(t => t.teamId && t.assignedTo === myId() && t.user_id !== myId() && !isDone(t)).length : 0; }
function renderTeam() {
  let gate = '';
  if (!sb) gate = `<h2>Team sharing</h2><p class="sub">Teams use cloud accounts. Add your Supabase URL and key in <b>config.js</b> (see README), then sign in.</p>`;
  else if (!currentUser) gate = `<h2>Team sharing</h2><p class="sub">Sign in with the button at the top of the app to create a team or join one with an invite code.</p>`;
  else if (teamsError === 'schema') gate = `<h2>One more step</h2><p class="sub">The team tables aren't in your database yet. Run the updated <b>supabase/schema.sql</b> in the Supabase SQL editor, then reopen this tab.</p>`;
  else if (teamsError) gate = `<h2>Team sharing</h2><p class="sub">Couldn't load teams: ${esc(teamsError)}</p>`;
  else if (!teams.length) gate = `<h2>Team sharing</h2><p class="sub">Share cards with family or your crew, assign them to someone, and see the moment they're done.</p><div class="row"><button class="primary" data-act="teamNew">Create a team</button><button class="ghost" data-act="teamJoin">Join with a code</button></div>`;
  $('#teamGate').hidden = !gate; $('#teamMain').hidden = !!gate; if (gate) { $('#teamGate').innerHTML = gate; return; }
  const team = teams.find(t => t.id === teamSel), mem = members[team.id] || [], owner = team.role === 'owner';
  $('#teamTabs').innerHTML = teams.map(t => `<button class="cat ${t.id === teamSel ? 'active' : ''}" data-act="teamPick" data-id="${t.id}">👥 ${esc(t.name)}</button>`).join('') + '<button class="cat" data-act="teamNew">＋ New team</button><button class="cat" data-act="teamJoin">Join</button>';
  $('#teamPanel').innerHTML = `
    <div class="sectionHead" style="margin-top:0"><h2>${esc(team.name)}</h2><span class="sub">${owner ? 'Owner' : 'Member'} · ${mem.length} ${mem.length === 1 ? 'person' : 'people'}</span></div>
    <div class="invite"><div><div class="sub">Invite code</div><div class="code">${esc(team.invite_code)}</div></div><div class="row"><button class="ghost" data-act="teamShare">↗ Invite</button>${owner ? '<button class="ghost" data-act="teamRotate" title="Old code stops working">New code</button>' : ''}</div></div>
    <div class="memberList">${mem.map(m => `<div class="member"><span class="avatar">${esc((m.display_name || '?')[0].toUpperCase())}</span><span class="mname"><b>${esc(m.display_name)}${m.user_id === myId() ? ' (you)' : ''}</b><span class="sub"> · ${m.role} · ${openFor(team.id, m.user_id)} open</span></span>${owner && m.user_id !== myId() ? `<button class="mini" data-act="teamKick" data-id="${m.user_id}" aria-label="Remove ${esc(m.display_name)}">×</button>` : ''}</div>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="primary" data-act="teamAdd">＋ Team card</button>${owner ? '<button class="ghost dangerText" data-act="teamDelete">Delete team</button>' : '<button class="ghost" data-act="teamLeave">Leave team</button>'}</div>`;
  const F = [['all', 'All'], ['mine', 'Assigned to me'], ['byme', 'Assigned by me'], ['review', '👀 To review'], ['open', 'Open'], ['late', 'Overdue']];
  $('#teamFilters').innerHTML = F.map(([k, l]) => `<button class="cat ${teamFilter === k ? 'active' : ''}" data-act="teamFilter" data-f="${k}">${l}</button>`).join('');
  const list = tasks.filter(t => t.teamId === team.id && (teamFilter === 'all' || (teamFilter === 'mine' && t.assignedTo === myId()) || (teamFilter === 'byme' && t.user_id === myId() && t.assignedTo && t.assignedTo !== myId()) || (teamFilter === 'review' && needsReview(t) && canReview(t)) || (teamFilter === 'open' && !isDone(t)) || (teamFilter === 'late' && urgency(t) === 'missed'))).sort(byUrgency);
  $('#teamCount').textContent = `${list.length} shown`;
  $('#teamGrid').innerHTML = list.length ? list.map(t => cardHTML(t)).join('') : '<div class="empty">No team cards here yet. Tap “＋ Team card”.</div>';
  setTimeout(() => hydrateThumbs(), 0);
}

/* Create / join */
let teamMode = 'create';
function openTeamDialog(mode, code = '') {
  if (!currentUser) { setView('team'); toast('Sign in first'); return; }
  teamMode = mode; const f = $('#teamForm'); f.reset();
  $('#teamDialogTitle').textContent = mode === 'create' ? 'Create a team' : 'Join a team';
  $('#teamNameLbl').hidden = mode !== 'create'; $('#teamCodeLbl').hidden = mode !== 'join';
  f.tname.required = mode === 'create'; f.tcode.required = mode === 'join'; f.tcode.value = code; f.dname.value = myDisplayName();
  $('#teamSubmit').textContent = mode === 'create' ? 'Create team' : 'Join team'; $('#teamDialog').showModal();
}
$('#teamForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, dname = f.dname.value.trim() || myDisplayName();
  const { data, error } = teamMode === 'create'
    ? await sb.rpc('create_team', { p_name: f.tname.value.trim(), p_display_name: dname })
    : await sb.rpc('join_team', { p_code: f.tcode.value.trim(), p_display_name: dname });
  if (error) { toast(/does not exist|schema cache/i.test(error.message) ? 'Run the updated schema.sql in Supabase first' : error.message); return; }
  const t = Array.isArray(data) ? data[0] : data; if (!settings.name) { settings.name = dname; saveSettings(); }
  $('#teamDialog').close(); teamSel = t?.id || teamSel; await syncTasks(); setView('team');
  toast(teamMode === 'create' ? `“${t?.name}” created — tap Invite to add people` : `You joined “${t?.name}”`);
});
async function shareInvite() {
  const t = teams.find(x => x.id === teamSel); if (!t) return;
  const url = `${location.origin}${location.pathname}?join=${t.invite_code}`, text = `Join my “${t.name}” team on Kayaos so we can share tasks. Code: ${t.invite_code}`;
  if (navigator.share) { try { await navigator.share({ title: 'Join my Kayaos team', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Invite link copied'); } catch (e) { prompt('Copy this invite:', `${text} ${url}`); }
}
async function rotateInvite() {
  if (!confirm('Make a new invite code? The old code will stop working.')) return;
  const { error } = await sb.rpc('rotate_invite', { p_team: teamSel }); if (error) { toast(error.message); return; } await loadTeams(); toast('New invite code ready');
}
async function kickMember(uid) {
  const name = memberName(teamSel, uid); if (!confirm(`Remove ${name} from the team? Their cards stay with the team.`)) return;
  const { error } = await sb.from('team_members').delete().eq('team_id', teamSel).eq('user_id', uid); if (error) { toast(error.message); return; }
  await loadTeams(); toast(`${name} removed`);
}
async function leaveTeam() {
  const t = teams.find(x => x.id === teamSel); if (!t || !confirm(`Leave “${t.name}”? You'll stop seeing its cards.`)) return;
  const { error } = await sb.from('team_members').delete().eq('team_id', t.id).eq('user_id', myId()); if (error) { toast(error.message); return; }
  tasks = tasks.filter(x => x.teamId !== t.id || x.user_id === myId()); saveTasks(); await syncTasks(); toast(`Left “${t.name}”`);
}
async function deleteTeam() {
  const t = teams.find(x => x.id === teamSel); if (!t || !confirm(`Delete “${t.name}” for everyone? Its cards go back to whoever created them.`)) return;
  const { error } = await sb.from('teams').delete().eq('id', t.id); if (error) { toast(error.message); return; }
  await syncTasks(); toast(`“${t.name}” deleted`);
}

/* Share-with / assign-to fields in the Add card form */
function fillTeamFields(teamId, assignee) {
  const show = !!(currentUser && teams.length); $('#teamFields').hidden = !show; if (!show) return;
  $('#teamSelect').innerHTML = '<option value="">Just me (private)</option>' + teams.map(t => `<option value="${t.id}">👥 ${esc(t.name)}</option>`).join('');
  $('#teamSelect').value = teamId && teams.some(t => t.id === teamId) ? teamId : ''; fillAssignees(assignee);
}
function fillAssignees(assignee) {
  const tid = $('#teamSelect').value, sel = $('#assigneeSelect'), mem = members[tid] || []; sel.disabled = !tid;
  sel.innerHTML = tid ? '<option value="">Anyone on the team</option>' + mem.map(m => `<option value="${m.user_id}">${esc(m.display_name)}${m.user_id === myId() ? ' (me)' : ''}</option>`).join('') : '<option value="">Assign to…</option>';
  sel.value = assignee && mem.some(m => m.user_id === assignee) ? assignee : '';
}
$('#teamSelect').addEventListener('change', () => fillAssignees());
$('#assigneeSelect').addEventListener('change', e => {
  const f = $('#taskForm'), m = (members[$('#teamSelect').value] || []).find(x => x.user_id === e.target.value);
  if (m && (!f.forName.value || f.forName.value === f.forName.dataset.auto)) { f.forName.value = m.display_name; f.forName.dataset.auto = m.display_name; }
});

/* Live updates from teammates */
function subscribeRealtime() {
  if (!sb || !currentUser || !sb.channel) return;
  if (rtChannel) sb.removeChannel(rtChannel);
  rtChannel = sb.channel('kayaos-tasks-' + myId()).on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onRemoteChange).subscribe();
}
function teamPing(msg) { toast(msg); chime(); showNote('Kayaos team', msg, 'team'); }
function onRemoteChange(p) {
  if (p.eventType === 'DELETE') { const id = p.old?.id; if (id && tasks.some(t => t.id === id)) { tasks = tasks.filter(t => t.id !== id); saveTasks(); render(); } return; }
  const n = localTaskFromRow(p.new), i = tasks.findIndex(t => t.id === n.id), old = i >= 0 ? tasks[i] : null;
  if (i >= 0) tasks[i] = n; else tasks.push(n); saveTasks();
  if (n.teamId && !members[n.teamId]) loadTeams(); else render();
  if (!n.teamId) return;
  if (old && !isDone(old) && isDone(n) && n.completedBy && n.completedBy !== myId()) teamPing(`✓ ${memberName(n.teamId, n.completedBy)} finished “${n.title}”`);
  else if (old && n.review && n.review.by !== myId() && (!old.review || old.review.at !== n.review.at) && (n.assignedTo === myId() || n.completedBy === myId() || old.completedBy === myId())) teamPing(n.review.state === 'redo' ? `🔁 ${memberName(n.teamId, n.review.by)} asked you to redo “${n.title}”${n.review.note ? ': ' + n.review.note : ''}` : `👍 ${memberName(n.teamId, n.review.by)} approved your proof for “${n.title}”`);
  else if (!old && n.user_id !== myId() && n.assignedTo === myId()) teamPing(`New from ${memberName(n.teamId, n.user_id)}: “${n.title}”`);
  else if (old && n.assignedTo === myId() && old.assignedTo !== myId() && n.user_id !== myId()) teamPing(`${memberName(n.teamId, n.user_id)} assigned you “${n.title}”`);
}

/* ?join=CODE invite links */
(() => { try { const c = new URLSearchParams(location.search).get('join'); if (c) { localStorage.setItem('kayaos.pendingJoin', c.toUpperCase()); history.replaceState(null, '', location.pathname); } } catch (e) {} })();
function handlePendingJoin() {
  let code = null; try { code = localStorage.getItem('kayaos.pendingJoin'); } catch (e) {} if (!code) return;
  setView('team');
  if (!currentUser) { toast(sb ? 'Sign in (or create an account) to join the team' : 'This app has no cloud accounts set up yet'); return; }
  try { localStorage.removeItem('kayaos.pendingJoin'); } catch (e) {}
  openTeamDialog('join', code);
}

/* ---------- Settings ---------- */
function fillVoices() {
  const g = settings.voiceGender === 'male' ? 'male' : 'female', sym = g === 'male' ? '♂' : '♀', notes = [];
  $$('[data-gender]').forEach(b => { const on = b.dataset.gender === g; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
  $('#setAccent').innerHTML = Object.entries(ACCENTS).map(([k, [, l]]) => `<option value="${k}">${l}</option>`).join('');
  $('#setAccent').value = ACCENTS[settings.voiceAccent] ? settings.voiceAccent : 'auto';
  $('#setEngine').value = settings.voiceEngine === 'device' ? 'device' : 'auto';
  const accName = (ACCENTS[settings.voiceAccent] || ACCENTS.auto)[1];
  if (useCloudVoice()) {
    $('#setVoice').innerHTML = CLOUD_VOICES[g].map(([v, l]) => `<option value="cloud:${v}">${sym} ${l}</option>`).join('');
    $('#setVoice').value = 'cloud:' + cloudVoiceName();
    notes.push('Natural voices are AI-generated (OpenAI). Each new sentence is fetched once, then saved on this phone.');
  } else {
    if (settings.voiceEngine !== 'device') notes.push(sb ? 'Sign in (Account, below) to use the natural AI voices — using the phone’s voice for now.' : 'Natural AI voices need cloud accounts (config.js) — using the phone’s voice for now.');
    if (!('speechSynthesis' in window)) { $('#setVoice').innerHTML = ''; notes.push('This browser cannot speak. Chimes and pop-ups still work.'); }
    else {
      const acc = accentLang().toLowerCase(), vs = englishVoices().sort((a, b) => (langOf(b) === acc) - (langOf(a) === acc));
      const mine = vs.filter(v => voiceGender(v) === g), other = vs.filter(v => !voiceGender(v));
      const opt = v => `<option value="${esc(v.voiceURI)}">${esc(v.name.replace(/^Microsoft |^Google /, ''))} (${esc(v.lang)})</option>`;
      $('#setVoice').innerHTML = `<option value="">Best ${g} voice (automatic)</option>` + (mine.length ? `<optgroup label="${sym} ${g === 'male' ? 'Male' : 'Female'} voices">${mine.map(opt).join('')}</optgroup>` : '') + (other.length ? `<optgroup label="Other voices">${other.map(opt).join('')}</optgroup>` : '');
      $('#setVoice').value = vs.some(v => v.voiceURI === settings.voiceURI) ? settings.voiceURI : '';
      const vf = voiceFor();
      if (['jm', 'latam'].includes(settings.voiceAccent)) notes.push(`The ${accName.replace(/ \(.*/, '')} accent is only available with the natural AI voice.`);
      else if (!vf.accentOk) notes.push(`This phone has no ${accName} voice installed.`);
      if (window.KayaosNative && window.KayaosNative.speak) notes.push(`The Kayaos Android app uses your phone’s ${g} voices directly.`);
      else if (!vf.matched) notes.push(g === 'male' ? 'This browser only offers a female voice, so “male” is just a lower pitch here. For a real male voice use the Natural AI voice (sign in) or the Kayaos Android app.' : `No ${g} phone voice${vf.accentOk && accentLang() ? ' with this accent' : ''} is installed, so the closest one is used.`);
      if (!vf.accentOk || !vf.matched) notes.push('Add voices in your phone settings (iPhone: Accessibility › Spoken Content › Voices · Android: Settings › Text-to-speech › Install voice data).');
    }
  }
  $('#voiceNote').hidden = !notes.length; $('#voiceNote').textContent = notes.join(' ');
}
$$('[data-gender]').forEach(b => b.onclick = () => { settings.voiceGender = b.dataset.gender; settings.voiceURI = ''; settings.cloudVoice = ''; saveSettings(); fillVoices(); sampleVoice(); });
$('#setAccent').onchange = e => { settings.voiceAccent = e.target.value; settings.voiceURI = ''; saveSettings(); fillVoices(); sampleVoice(); };
$('#setEngine').onchange = e => { settings.voiceEngine = e.target.value; saveSettings(); fillVoices(); sampleVoice(); };
function sampleVoice() { speak(`Hey${settings.name ? ' ' + settings.name : ''}, this is how your Kayaos reminders will sound.`); }
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fillVoices;
$('#settingsBtn').onclick = () => { $('#setName').value = settings.name; $('#setQuietStart').value = settings.quietStart || ''; $('#setQuietEnd').value = settings.quietEnd || ''; $('#setAlert').value = settings.alert; fillVoices(); updateToolStates(); refreshAuthUI(); $('#settingsDialog').showModal(); };
$('#setName').oninput = e => { settings.name = e.target.value.trim(); saveSettings(); };
$('#setQuietStart').onchange = e => { settings.quietStart = e.target.value; saveSettings(); };
$('#setQuietEnd').onchange = e => { settings.quietEnd = e.target.value; saveSettings(); };
$('#setAlert').onchange = e => { settings.alert = e.target.value; saveSettings(); };
$('#setVoice').onchange = e => { const v = e.target.value; if (v.startsWith('cloud:')) settings.cloudVoice = v.slice(6); else settings.voiceURI = v; saveSettings(); sampleVoice(); };
$('#testChime').onclick = () => chime();
$('#testVoice').onclick = sampleVoice;
$('#settingsNotify').onclick = askNotify;
$('#studentName').oninput = e => { settings.studentName = e.target.value.trim(); saveSettings(); };

/* ---------- Global click handling ---------- */
document.addEventListener('click', e => {
  const close = e.target.closest('[data-close]'); if (close) { close.closest('dialog').close(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, t = id && tasks.find(x => x.id === id);
  switch (b.dataset.act) {
    case 'cat': selectedCat = b.dataset.cat; renderCards(); break;
    case 'done': if (t) toggleDone(t); break;
    case 'chk': if (t) toggleCheckItem(t, +b.dataset.i); break;
    case 'addProof': if (t) openMediaChooser(id, t.proof && !hasProof(t) && !isDone(t) ? 'proof' : 'guide', false); break;
    case 'viewMedia': openMediaViewer(id, b.dataset.m); break;
    case 'doneOn': if (t) toggleDone(t, new Date(b.dataset.date + 'T00:00')); break;
    case 'edit': if ($('#cardDialog').open) $('#cardDialog').close(); openEdit(id); break;
    case 'del': if (t && confirm(`Delete “${t.title}”?`)) removeTasks([id]); break;
    case 'say': if (t) { const o = relevantOcc(t); speak(o ? alertText(t, o, 'lead') : `${t.title}. No due date.`); } break;
    case 'openLink': if (t) openCardLink(t, false); break;
    case 'openWeb': if (t) openCardLink(t, true); break;
    case 'flightStatus': if (t && t.flightNo) openOutside(flightStatusURL(t)); break;
    case 'approve': if (t) approveProof(t); break;
    case 'redo': if (t) redoProof(t); break;
    case 'directions': if (t) openOutside(directionsURL(t)); break;
    case 'copyConf': if (t) copyText(t.conf).then(ok => toast(ok ? `Confirmation # ${t.conf} copied` : `Confirmation # ${t.conf}`)); break;
    case 'map': if (t) { if ($('#cardDialog').open) $('#cardDialog').close(); showTaskOnMap(t); } break;
    case 'clearMenu': openClear(); break;
    case 'weekPrev': weekOffset--; renderWeek(); break;
    case 'weekNext': weekOffset++; renderWeek(); break;
    case 'weekNow': weekOffset = 0; renderWeek(); break;
    case 'openDay': selectedDay = new Date(b.dataset.date + 'T00:00'); setView('day'); break;
    case 'dayPrev': selectedDay = addDays(selectedDay, -1); renderDay(); break;
    case 'dayNext': selectedDay = addDays(selectedDay, 1); renderDay(); break;
    case 'dayToday': selectedDay = startOfDay(new Date()); renderDay(); break;
    case 'addAssignment': openAdd({ category: 'School' }); break;
    case 'whatsDue': whatsDue(); break;
    case 'testStudent': { unlockAudio(); const n = settings.studentName; chime(); setTimeout(() => speak(`Hey${n ? ' ' + n : ''}, this is your homework reminder. Your assignment is due soon.`), 1100); break; }
    case 'toggleTrack': toggleTracking(); break;
    case 'openSettings': $('#settingsBtn').click(); break;
    case 'teamNew': openTeamDialog('create'); break;
    case 'teamJoin': openTeamDialog('join'); break;
    case 'teamPick': teamSel = id; teamFilter = 'all'; renderTeam(); break;
    case 'teamFilter': teamFilter = b.dataset.f; renderTeam(); break;
    case 'teamAdd': openAdd({ teamId: teamSel }); break;
    case 'teamShare': shareInvite(); break;
    case 'teamRotate': rotateInvite(); break;
    case 'teamKick': kickMember(id); break;
    case 'teamLeave': leaveTeam(); break;
    case 'teamDelete': deleteTeam(); break;
    case 'checkOnce': checkOnce(); break;
    case 'shareLoc': shareLocation(); break;
  }
});
$('#fab').onclick = () => openAdd(view === 'school' ? { category: 'School' } : {});
$('#searchInput').oninput = renderCards;

/* ---------- Theme, install, boot ---------- */
if (localStorage.getItem(K.theme) === 'dark') document.documentElement.dataset.theme = 'dark';
$('#themeBtn').onclick = () => { const dark = document.documentElement.dataset.theme === 'dark'; document.documentElement.dataset.theme = dark ? '' : 'dark'; localStorage.setItem(K.theme, dark ? 'light' : 'dark'); };
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
/* Install: one-tap where the browser allows it (Android/desktop Chrome, Edge); step-by-step otherwise (iPhone/iPad) */
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function updateInstallBtn() { $('#installBtn').hidden = isInstalled() || !!window.KayaosNative; $('#installBtn').classList.toggle('ready', !!deferredPrompt); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; updateInstallBtn(); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; updateInstallBtn(); toast('Kayaos installed — open it from your home screen'); });
$('#installBtn').onclick = async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; updateInstallBtn(); return; }
  const ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  $('#installSteps').innerHTML = ios
    ? '<li>Open Kayaos in <b>Safari</b>.</li><li>Tap the <b>Share</b> button <span class="kbd">⬆︎</span> at the bottom.</li><li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open Kayaos from the new icon.</li>'
    : '<li>Tap the browser menu <span class="kbd">⋮</span> (top right).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Confirm. Open Kayaos from the new icon.</li>';
  $('#installDialog').showModal();
};
updateInstallBtn();
/* Service worker: check for a new version on every launch; when a new one takes over, reload once */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller; let updatePending = false;
  navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  /* A new version never refreshes the screen while you are using the app: it waits until you leave the app */
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) updatePending = true; });
  window.kayaosApplyUpdate = () => { if (updatePending) { updatePending = false; location.reload(); } };
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (window.kayaosApplyUpdate) window.kayaosApplyUpdate(); return; }
  tickAlerts(); softRender();
});

if (settings.tracking) toggleTracking(true);
setInterval(tickAlerts, 15000);
setInterval(softRender, 30000);
render(); tickAlerts(); initAuth();

/* ---------- Android app bridge: home-screen widget + alarms that ring when the app is closed ---------- */
/* The Android app exposes window.KayaosNative. We hand it the upcoming cards (already expanded for repeats)
   and a ready-made alarm schedule, so the native side never has to re-implement Kayaos rules. */
var nativeTimer = null; /* var: may be used before this line runs (saves during startup) */
function pushNative() {
  if (!window.KayaosNative) return;
  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(() => { try { window.KayaosNative.update(JSON.stringify(nativeFeed())); } catch (e) {} }, 300);
}
function nativeFeed() {
  const now = new Date(), nowMs = now.getTime(), horizon = addDays(startOfDay(now), 15).getTime(), alarmEnd = nowMs + 8 * 864e5;
  const items = [], alarms = [];
  for (const t of tasks) {
    if (!t.hasDue) { if (!t.done) items.push({ id: t.id, title: t.title, cat: t.category, due: 0, start: 0, created: t.createdAt, who: t.forName || '', left: t.checklist.filter(i => !i.d).length, amount: t.amount || 0 }); continue; }
    const occs = [];
    if (t.repeat === 'none') occs.push(parseDT(t));
    else { let d = relevantOcc(t, now); while (d && d.getTime() < horizon && occs.length < 40) { if (t.installments && occIndex(t, d) >= t.installments) break; occs.push(d); d = step(d, t.repeat); } }
    for (const o of occs) {
      const om = o.getTime();
      if (isDoneOn(t, o) || om >= horizon || nowMs - om > 30 * 864e5) continue;
      const st = startOf(t, o);
      items.push({ id: t.id, title: t.title, cat: t.category, due: om, start: st ? st.getTime() : 0, created: t.createdAt, who: t.forName || '', left: t.checklist.filter(i => !i.d).length, amount: t.amount || 0 });
      if (t.checkin && om - 864e5 > nowMs - 6 * 36e5) items.push({ id: t.id, title: '✈️ Check-in · ' + t.title, cat: t.category, due: om - 864e5, start: 0, created: t.createdAt, who: '', left: 0, amount: 0 });
      if (!alertsForMe(t)) continue;
      const add = (at, kind) => {
        if (at <= nowMs || at > alarmEnd) return;
        const text = alertText(t, o, kind, new Date(at));
        alarms.push({ at, id: t.id, title: (t.category === 'School' ? '📚 ' : '') + t.title, text, say: sayable(text), sound: t.alert });
      };
      const lead = +t.reminder || 0, alertAt = om - lead * 60000, realStart = st && st.getTime() - t.createdAt > 60000;
      if (realStart) add(st.getTime(), 'start');
      if (!(realStart && Math.abs(alertAt - st.getTime()) < 180000)) add(alertAt, 'lead');
      if (lead > 0) add(om, 'due');
      if (t.checkin) add(om - 864e5, 'checkin');
      if (t.nag > 0) for (let k = 1; k <= 60; k++) { const at = alertAt + k * t.nag * 60000; if (at - om >= 12 * 36e5) break; if (!inQuietHours(new Date(at))) add(at, 'nag'); }
    }
  }
  items.sort((a, b) => (a.due || 9e15) - (b.due || 9e15));
  alarms.sort((a, b) => a.at - b.at);
  return { v: 1, generated: nowMs, name: settings.name, voice: settings.voiceGender, accent: accentLang(), items: items.slice(0, 150), alarms: alarms.slice(0, 120) };
}
/* Links from the widget / notifications: ?add=1, ?card=<id>, or kayaosDeepLink('add' | 'card:<id>') */
window.kayaosDeepLink = function (link) {
  link = String(link || '');
  if (link === 'add') { openAdd(); return; }
  if (link.startsWith('card:')) {
    const id = link.slice(5), t = tasks.find(x => x.id === id); if (!t) { toast('That card was removed'); return; }
    document.querySelectorAll('dialog[open]').forEach(d => { if (d.id !== 'cardDialog') d.close(); });
    openCardModal(id, document.querySelector(`.task[data-id="${id}"]`) || document.querySelector(`.item[data-open="${id}"]`));
  }
};
(() => {
  try {
    const q = new URLSearchParams(location.search), link = q.get('add') ? 'add' : q.get('card') ? 'card:' + q.get('card') : '';
    if (link) { history.replaceState(null, '', location.pathname); setTimeout(() => window.kayaosDeepLink(link), 400); }
  } catch (e) {}
})();
pushNative(); setInterval(pushNative, 15 * 60000);
setTimeout(purgeOldMedia, 5000); setInterval(purgeOldMedia, 6 * 36e5);
setTimeout(() => $('#splash')?.remove(), 2200);
if ($('#buildLine')) $('#buildLine').textContent = 'Version ' + window.KAYAOS_BUILD;
window.__kayaosReady = window.KAYAOS_BUILD; /* tells index.html the app started fine */
