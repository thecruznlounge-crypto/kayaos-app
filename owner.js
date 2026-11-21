/* Kayaos owner dashboard: totals and a user list for accounts listed in public.app_owners (see supabase/schema.sql).
   Shown in More only for owner accounts. The database enforces access; this file only hides the menu item. */
'use strict';
let isOwner = false;

/* Asks the database whether the signed-in account is an owner. Quietly "no" in local-only mode. */
async function checkOwner() {
  isOwner = false;
  if (!sb || !currentUser) return;
  try { const { data, error } = await sb.rpc('is_app_owner'); isOwner = !error && data === true; }
  catch (e) { isOwner = false; }
}

const fmtBytes = n => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`;
const ownerTile = (label, value, sub = '') => `<div class="wkTile"><span>${label}</span><strong>${value}</strong>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;

async function openOwner() {
  if (!isOwner) { toast('Owner access only'); return; }
  $('#ownerDialog').showModal();
  await loadOwner();
}
async function loadOwner() {
  const body = $('#ownerBody');
  if (!sb) { body.innerHTML = '<p class="sub">Cloud accounts are off. Add your Supabase URL and key in config.js.</p>'; return; }
  body.innerHTML = '<p class="sub">Loading…</p>';
  const [d, u] = await Promise.all([sb.rpc('owner_dashboard'), sb.rpc('owner_users')]);
  if (d.error || u.error) { body.innerHTML = `<p class="sub">Couldn't load the dashboard: ${esc((d.error || u.error).message)}</p>`; return; }
  const s = d.data || {}, users = u.data || [];
  body.innerHTML = `
    <div class="wkTiles">
      ${ownerTile('Users', s.users ?? 0, `${s.signups_7d ?? 0} new this week`)}
      ${ownerTile('Active · 30 days', s.active_users_30d ?? 0, `${s.signups_30d ?? 0} sign-ups`)}
      ${ownerTile('Cards', s.cards ?? 0, `${s.cards_open ?? 0} open · ${s.cards_done ?? 0} done`)}
      ${ownerTile('Cards · 30 days', s.cards_30d ?? 0, `${s.cards_with_media ?? 0} with photos/video`)}
      ${ownerTile('Teams', s.teams ?? 0, `${s.team_members ?? 0} members`)}
      ${ownerTile('Photos & video', s.media_files ?? 0, `${fmtBytes(s.media_bytes || 0)} stored`)}
    </div>
    <div class="sectionHead"><h2>Users</h2><span class="sub">Newest first · up to 200</span></div>
    <div class="card wkList">${users.map(r => `<div class="wkRow">
        <div><strong>${esc(r.user_email || '(no email)')}</strong>
          <span class="sub">Joined ${fmtShort(String(r.signed_up).slice(0, 10))} · last in ${r.last_seen ? fmtShort(String(r.last_seen).slice(0, 10)) : 'never'}</span></div>
        <div class="wkAmt"><b>${r.cards} cards</b><span class="sub">${r.open_cards} open · ${r.teams} teams</span></div>
      </div>`).join('') || '<div class="empty">No users yet.</div>'}</div>
    <p class="sub" style="margin-top:10px">Updated ${new Date(s.generated_at || Date.now()).toLocaleString()}</p>`;
}
$('#ownerRefresh').addEventListener('click', loadOwner);
