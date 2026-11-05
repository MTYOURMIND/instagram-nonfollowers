/**
 * Instagram Non-Followers Manager
 *
 * Lists the accounts you follow that don't follow you back, lets you filter,
 * sort and select them, and unfollow the selected ones with safe delays.
 * When unfollowing finishes, it re-checks your following list with Instagram
 * and tells you when everything is verified and it is safe to close the panel.
 *
 * USAGE
 *   1. Log in at https://www.instagram.com in your browser.
 *   2. Open DevTools (F12) -> Console.
 *   3. Paste this whole script and press Enter.
 *
 * NOTES
 *   - Runs entirely in your browser using your own logged-in session.
 *     Nothing is sent anywhere except to instagram.com.
 *   - Uses Instagram's unofficial web endpoints, which may change or break
 *     at any time, and automating actions may violate Instagram's Terms of Use.
 *     Use at your own risk, keep batches small (a few dozen per day).
 *   - Exact "followed on" dates are not exposed by Instagram's web API.
 *     Optionally import `following.json` from Instagram's "Download your
 *     information" export (JSON format) to see real dates and sort by them.
 */
(async () => {
  // Clean up a previous run (restores patched fetch/XHR and removes the panel)
  window.__igNfCleanup?.();
  document.getElementById('ig-nf-panel')?.remove();

  if (location.hostname !== 'www.instagram.com') {
    alert('Please run this on https://www.instagram.com first.');
    return;
  }

  const getCookie = (n) =>
    document.cookie.split('; ').find((r) => r.startsWith(n + '='))?.split('=')[1];
  const uid = getCookie('ds_user_id');
  const csrf = getCookie('csrftoken');
  if (!uid || !csrf) {
    alert('You do not appear to be logged in.');
    return;
  }

  const H = {
    'x-ig-app-id': '936619743392459',
    'x-csrftoken': csrf,
    'x-requested-with': 'XMLHttpRequest',
    'x-asbd-id': '129477',
    'x-ig-www-claim': sessionStorage.getItem('www-claim-v2') || '0',
  };
  const rollout = document.documentElement.innerHTML.match(/"rollout_hash":"([^"]+)"/)?.[1];
  if (rollout) H['x-instagram-ajax'] = rollout;

  // fb_dtsg / jazoest: read from the page, otherwise capture from Instagram's own requests
  const tok = { dtsg: null, jazoest: null };
  const html = document.documentElement.innerHTML;
  tok.dtsg =
    html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ||
    html.match(/"dtsg":\{"token":"([^"]+)"/)?.[1] ||
    null;
  tok.jazoest = html.match(/[?&"]jazoest["=:]+"?(\d+)/)?.[1] || null;
  const grab = (body) => {
    try {
      const p = new URLSearchParams(
        typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : ''
      );
      if (p.get('fb_dtsg')) tok.dtsg = p.get('fb_dtsg');
      if (p.get('jazoest')) tok.jazoest = p.get('jazoest');
    } catch {}
  };
  const oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (b) { grab(b); return oSend.apply(this, arguments); };
  const oFetch = window.fetch;
  window.fetch = function (u, o) { if (o && o.body) grab(o.body); return oFetch.apply(this, arguments); };

  // ---------- Run state ----------
  let stop = false; // set by the Stop button
  let closed = false; // set when the panel is closed
  let busy = false; // true while loading, unfollowing or verifying

  // Ask the browser to confirm if the tab is closed/reloaded mid-operation
  const guard = (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  window.__igNfCleanup = () => {
    closed = true;
    XMLHttpRequest.prototype.send = oSend;
    window.fetch = oFetch;
    window.removeEventListener('beforeunload', guard);
  };

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  // Like sleep, but wakes up early if Stop is pressed or the panel is closed
  const wait = async (ms) => {
    for (let t = 0; t < ms && !stop && !closed; t += 250) await sleep(Math.min(250, ms - t));
  };
  const fmtTime = (s) => {
    s = Math.max(0, Math.round(s));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const fmtDate = (ts) =>
    new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const el = (tag, css = '', props = {}, ...kids) => {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    Object.assign(e, props);
    kids.forEach((k) => e.append(k));
    return e;
  };
  const idOf = (u) => String(u.pk || u.pk_id);

  // ---------- UI ----------
  const btnCss =
    'background:#262626;color:#fff;border:1px solid #444;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:13px;';
  const inputCss =
    'background:#1e1e1e;color:#fff;border:1px solid #444;border-radius:6px;padding:6px;font-size:13px;';

  const panel = el(
    'div',
    'position:fixed;top:20px;right:20px;width:460px;height:85vh;z-index:999999;background:#121212;color:#f5f5f5;' +
      'border:1px solid #444;border-radius:12px;display:flex;flex-direction:column;font:14px system-ui,sans-serif;box-shadow:0 8px 30px #000a;',
    { id: 'ig-nf-panel' }
  );
  const title = el('div', 'font-weight:600;', { textContent: 'Non-followers' });
  const closeBtn = el('button', btnCss, {
    textContent: '✕',
    onclick: () => {
      if (busy && !confirm('An operation is still running. Close the panel anyway?')) return;
      window.__igNfCleanup?.();
      panel.remove();
    },
  });
  const head = el(
    'div',
    'display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #333;',
    {},
    title,
    closeBtn
  );
  const status = el('div', 'padding:8px 12px 4px;font-size:12px;color:#aaa;', { textContent: 'Starting…' });
  const barWrap = el('div', 'margin:2px 12px 4px;height:8px;background:#2a2a2a;border-radius:4px;overflow:hidden;');
  const barFill = el('div', 'height:100%;width:0%;background:#0095f6;transition:width .3s;');
  barWrap.append(barFill);
  const progressText = el('div', 'padding:0 12px 8px;font-size:12px;color:#aaa;');
  const banner = el('div', 'display:none;');

  const setStatus = (t) => (status.textContent = t);
  const setProgress = (frac, text) => {
    barFill.style.width = frac == null ? '0%' : `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
    progressText.textContent = text || '';
  };
  const BANNER_COLORS = {
    busy: ['#3a2a10', '#ffcc80'],
    ok: ['#12301a', '#8be9a1'],
    warn: ['#3a1a1a', '#ff9b9b'],
    info: ['#10253a', '#8ec5ff'],
  };
  const setBanner = (kind, text) => {
    if (!kind) { banner.style.display = 'none'; banner.textContent = ''; return; }
    const [bg, fg] = BANNER_COLORS[kind];
    banner.style.cssText =
      `display:block;margin:0 12px 8px;padding:8px 10px;border-radius:6px;font-size:12px;line-height:1.4;background:${bg};color:${fg};`;
    banner.textContent = text;
  };

  // Controls
  const search = el('input', inputCss + 'flex:1;min-width:0;', { placeholder: 'Search…' });
  const sortSel = el('select', inputCss);
  [
    ['az', 'A → Z'],
    ['za', 'Z → A'],
    ['ig', "Instagram's order"],
  ].forEach(([v, t]) => sortSel.append(el('option', '', { value: v, textContent: t })));
  const bar1 = el('div', 'display:flex;gap:6px;padding:4px 12px;', {}, search, sortSel);

  const visSel = el('select', inputCss);
  [
    ['all', 'All accounts'],
    ['public', 'Public only'],
    ['private', 'Private only'],
  ].forEach(([v, t]) => visSel.append(el('option', '', { value: v, textContent: t })));
  const hideVerified = el('input', 'cursor:pointer;', { type: 'checkbox' });
  const hideVerifiedLbl = el(
    'label',
    'display:flex;align-items:center;gap:4px;font-size:12px;color:#ccc;cursor:pointer;',
    {},
    hideVerified,
    'Hide verified'
  );
  const importBtn = el('button', btnCss, { textContent: 'Import following.json (dates)' });
  const fileInput = el('input', 'display:none;', { type: 'file', accept: '.json,application/json' });
  importBtn.onclick = () => fileInput.click();
  const bar2 = el('div', 'display:flex;gap:8px;align-items:center;padding:4px 12px;flex-wrap:wrap;', {}, visSel, hideVerifiedLbl, importBtn, fileInput);

  const allBtn = el('button', btnCss, { textContent: 'Select visible' });
  const noneBtn = el('button', btnCss, { textContent: 'Clear selection' });
  const refreshBtn = el('button', btnCss, { textContent: '↻ Refresh' });
  const bar3 = el('div', 'display:flex;gap:6px;padding:4px 12px;', {}, allBtn, noneBtn, refreshBtn);

  const unBtn = el('button', btnCss + 'background:#ed4956;border-color:#ed4956;font-weight:600;', {
    textContent: 'Unfollow selected',
  });
  const stopBtn = el('button', btnCss, { textContent: 'Stop', onclick: () => { stop = true; } });
  const bar4 = el('div', 'display:flex;gap:6px;padding:4px 12px 8px;', {}, unBtn, stopBtn);

  const list = el('div', 'flex:1;overflow-y:auto;border-top:1px solid #333;');
  panel.append(head, status, barWrap, progressText, banner, bar1, bar2, bar3, bar4, list);
  document.body.append(panel);

  const setBusy = (on) => {
    busy = on;
    [unBtn, refreshBtn].forEach((b) => { b.disabled = on; b.style.opacity = on ? '.5' : '1'; });
  };

  // ---------- Data fetching ----------
  const getCounts = async () => {
    try {
      const r = await fetch(`/api/v1/users/${uid}/info/`, { headers: H, credentials: 'include' });
      if (!r.ok) return null;
      const j = await r.json();
      const u = j.user || {};
      if (typeof u.follower_count !== 'number' || typeof u.following_count !== 'number') return null;
      return { followers: u.follower_count, following: u.following_count };
    } catch {
      return null;
    }
  };

  // onPage(pageSize, totalSoFar) is called after each page
  const fetchAll = async (kind, label, onPage) => {
    const out = [];
    let maxId = '';
    while (true) {
      if (stop || closed) throw new Error('Stopped');
      const r = await fetch(
        `/api/v1/friendships/${uid}/${kind}/?count=100${maxId ? `&max_id=${maxId}` : ''}`,
        { headers: H, credentials: 'include' }
      );
      if (!r.ok) {
        throw new Error(
          `Could not load ${label} (HTTP ${r.status})` +
            (r.status === 429 ? ' — rate limited, wait a while and try again' : '')
        );
      }
      const j = await r.json();
      const users = j.users || [];
      out.push(...users);
      onPage?.(users.length, out.length);
      if (!j.next_max_id) break;
      maxId = j.next_max_id;
      await wait(rnd(800, 1800));
    }
    return out;
  };

  // ---------- List state ----------
  let followers = [];
  let following = [];
  let unfollowedTotal = 0;
  let dateMap = null; // lowercase username -> unix timestamp (from imported export)
  const items = new Map(); // id -> item
  const selected = new Set();
  let visibleOrder = [];
  let lastIdx = null;

  const updateSummary = () => {
    setStatus(
      `Followers: ${followers.length} | Following: ${following.length - unfollowedTotal} | ` +
        `Not following back: ${items.size} | Showing: ${visibleOrder.length} | Selected: ${selected.size}`
    );
    unBtn.textContent = `Unfollow selected (${selected.size})`;
  };

  const setSel = (id, on) => {
    const it = items.get(id);
    if (!it) return;
    it.cb.checked = on;
    on ? selected.add(id) : selected.delete(id);
  };

  const updateMeta = (it) => {
    const u = it.user;
    it.meta.textContent =
      (u.full_name || '') + (u.is_verified ? ' ✔' : '') + (u.is_private ? ' 🔒' : '') +
      (it.followedAt ? `  •  followed ${fmtDate(it.followedAt)}` : '');
  };

  // Rebuilds the rows from [{u, order}], keeping any selections that still apply
  const buildList = (nonFollowers) => {
    const prevSel = new Set(selected);
    items.clear();
    selected.clear();
    list.textContent = '';
    nonFollowers.forEach(({ u, order }) => {
      const id = idOf(u);
      const cb = el('input', 'width:16px;height:16px;cursor:pointer;', { type: 'checkbox' });
      const img = el('img', 'width:40px;height:40px;border-radius:50%;object-fit:cover;', {
        src: u.profile_pic_url,
        loading: 'lazy',
      });
      const link = el('a', 'color:#fff;font-weight:600;text-decoration:none;', {
        href: `https://www.instagram.com/${u.username}/`,
        target: '_blank',
        rel: 'noopener',
        textContent: u.username,
      });
      const meta = el('div', 'color:#aaa;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
      const info = el('div', 'flex:1;min-width:0;overflow:hidden;', {}, link, meta);
      const row = el('div', 'display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #222;', {}, cb, img, info);
      const it = { id, row, cb, meta, user: u, order, followedAt: dateMap?.get(u.username.toLowerCase()) ?? null };
      items.set(id, it);
      updateMeta(it);
      if (prevSel.has(id)) { selected.add(id); cb.checked = true; }
      cb.onclick = (ev) => {
        const idx = visibleOrder.indexOf(id);
        if (ev.shiftKey && lastIdx !== null && idx !== -1) {
          const [a, b] = [Math.min(idx, lastIdx), Math.max(idx, lastIdx)];
          visibleOrder.slice(a, b + 1).forEach((i) => setSel(i, cb.checked));
        } else setSel(id, cb.checked);
        lastIdx = idx;
        updateSummary();
      };
      list.append(row);
    });
  };

  const computeNonFollowers = () => {
    const fset = new Set(followers.map(idOf));
    return following.map((u, i) => ({ u, order: i })).filter(({ u }) => !fset.has(idOf(u)));
  };

  const byDate = (dir) => (a, b) => {
    if (a.followedAt == null && b.followedAt == null) return 0;
    if (a.followedAt == null) return 1;
    if (b.followedAt == null) return -1;
    return dir * (a.followedAt - b.followedAt);
  };
  const sorters = {
    az: (a, b) => a.user.username.localeCompare(b.user.username, 'en', { sensitivity: 'base' }),
    za: (a, b) => b.user.username.localeCompare(a.user.username, 'en', { sensitivity: 'base' }),
    ig: (a, b) => a.order - b.order,
    oldest: byDate(1),
    newest: byDate(-1),
  };

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const vis = visSel.value;
    const hideV = hideVerified.checked;
    const arr = [...items.values()]
      .filter((it) => {
        const u = it.user;
        if (vis === 'public' && u.is_private) return false;
        if (vis === 'private' && !u.is_private) return false;
        if (hideV && u.is_verified) return false;
        if (q && !u.username.toLowerCase().includes(q) && !(u.full_name || '').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort(sorters[sortSel.value] || sorters.az);
    items.forEach((it) => (it.row.style.display = 'none'));
    arr.forEach((it) => {
      it.row.style.display = 'flex';
      list.append(it.row); // re-appending moves the node, giving us the sorted order
    });
    visibleOrder = arr.map((it) => it.id);
    lastIdx = null;
    updateSummary();
  };

  search.oninput = render;
  sortSel.onchange = render;
  visSel.onchange = render;
  hideVerified.onchange = render;
  allBtn.onclick = () => { visibleOrder.forEach((i) => setSel(i, true)); updateSummary(); };
  noneBtn.onclick = () => { [...selected].forEach((i) => setSel(i, false)); updateSummary(); };

  // ---------- Load / Refresh ----------
  const loadData = async () => {
    setBusy(true);
    stop = false;
    setBanner(null);
    const counts = await getCounts();
    const totalExpected = counts ? counts.followers + counts.following : 0;
    const t0 = Date.now();
    let fetched = 0;

    if (counts) {
      const pages = Math.ceil(counts.followers / 100) + Math.ceil(counts.following / 100);
      setProgress(0, `Followers: ${counts.followers} | Following: ${counts.following} | Estimated time: ~${fmtTime(pages * 2.2)}`);
    } else {
      setProgress(0, 'Loading…');
    }

    const onPage = (label) => (n) => {
      fetched += n;
      setStatus(`${label}: ${fetched} accounts loaded so far…`);
      if (!totalExpected) { setProgress(null, `${fetched} loaded (total unknown)`); return; }
      const frac = Math.min(fetched / totalExpected, 0.99);
      const elapsed = (Date.now() - t0) / 1000;
      const eta = fetched > 0 ? (elapsed / fetched) * (totalExpected - fetched) : null;
      setProgress(frac, `${Math.round(frac * 100)}%${eta != null ? ` — about ${fmtTime(eta)} left` : ''}`);
    };

    try {
      const f = await fetchAll('followers', 'Followers', onPage('Followers'));
      const g = await fetchAll('following', 'Following', onPage('Following'));
      if (closed) return;
      followers = f;
      following = g;
      unfollowedTotal = 0;
      buildList(computeNonFollowers());
      render();
      setProgress(1, `Loaded in ${fmtTime((Date.now() - t0) / 1000)}`);
    } catch (e) {
      if (closed) return;
      setStatus('Error: ' + e.message);
      setProgress(null, '');
    } finally {
      if (!closed) setBusy(false);
    }
  };
  refreshBtn.onclick = loadData;

  // ---------- Optional: import follow dates from Instagram's data export ----------
  let dateSortAdded = false;
  const parseExport = (data) => {
    const arr = Array.isArray(data) ? data : data.relationships_following || [];
    const map = new Map();
    for (const item of arr) {
      for (const s of item.string_list_data || []) {
        const name = String(s.value || item.title || '').toLowerCase();
        if (name && s.timestamp) map.set(name, s.timestamp);
      }
    }
    return map;
  };
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const map = parseExport(JSON.parse(await f.text()));
      let matched = 0;
      items.forEach((it) => {
        const ts = map.get(it.user.username.toLowerCase());
        if (ts) { it.followedAt = ts; matched++; updateMeta(it); }
      });
      if (!matched) {
        alert('No matching accounts found. Make sure this is the "following.json" file from the JSON export.');
        return;
      }
      dateMap = map; // remembered so dates survive Refresh
      if (!dateSortAdded) {
        sortSel.append(
          el('option', '', { value: 'oldest', textContent: 'Followed: oldest first' }),
          el('option', '', { value: 'newest', textContent: 'Followed: newest first' })
        );
        dateSortAdded = true;
      }
      importBtn.textContent = `Dates loaded (${matched})`;
      render();
    } catch (e) {
      alert('Could not read that file: ' + e.message);
    } finally {
      fileInput.value = '';
    }
  };

  // ---------- Custom confirmation dialog ----------
  const DELAYS = {
    normal: { label: 'Normal (5–10 s between unfollows)', range: [5, 10] },
    safe: { label: 'Safe (10–20 s between unfollows)', range: [10, 20] },
  };
  // Resolves to { delay: [minSec, maxSec] } if confirmed, or null if cancelled
  const showConfirm = (ids) =>
    new Promise((resolve) => {
      const sel = ids.map((id) => items.get(id)).filter(Boolean);
      const nPriv = sel.filter((it) => it.user.is_private).length;
      const nVer = sel.filter((it) => it.user.is_verified).length;

      const overlay = el(
        'div',
        'position:absolute;inset:0;background:#000c;z-index:10;display:flex;align-items:center;justify-content:center;border-radius:12px;padding:12px;'
      );
      const box = el(
        'div',
        'background:#1c1c1c;border:1px solid #444;border-radius:12px;width:100%;max-height:92%;display:flex;flex-direction:column;overflow:hidden;'
      );

      const heading = el('div', 'padding:12px 14px 4px;font-weight:600;font-size:15px;', {
        textContent: `Unfollow ${sel.length} account${sel.length === 1 ? '' : 's'}?`,
      });
      const stats = el('div', 'padding:0 14px 8px;font-size:12px;color:#aaa;', {
        textContent: `${sel.length - nPriv} public • ${nPriv} private • ${nVer} verified`,
      });

      const preview = el('div', 'overflow-y:auto;max-height:200px;border-top:1px solid #333;border-bottom:1px solid #333;');
      sel.forEach((it) => {
        const u = it.user;
        preview.append(
          el(
            'div',
            'display:flex;align-items:center;gap:8px;padding:5px 14px;font-size:13px;',
            {},
            el('img', 'width:24px;height:24px;border-radius:50%;object-fit:cover;', { src: u.profile_pic_url }),
            el('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', {
              textContent: u.username,
            }),
            el('span', 'color:#aaa;font-size:12px;', {
              textContent: (u.is_verified ? '✔ ' : '') + (u.is_private ? '🔒' : ''),
            })
          )
        );
      });

      const delaySel = el('select', inputCss + 'width:100%;');
      Object.entries(DELAYS).forEach(([k, d]) =>
        delaySel.append(el('option', '', { value: k, textContent: d.label }))
      );
      const etaText = el('div', 'font-size:12px;color:#aaa;margin-top:6px;');
      const updateEta = () => {
        const [a, b] = DELAYS[delaySel.value].range;
        etaText.textContent = `Estimated time: ~${fmtTime(sel.length * ((a + b) / 2))} (plus a short verification check at the end)`;
      };
      delaySel.onchange = updateEta;
      updateEta();

      const warnings = [];
      if (sel.length > 50) warnings.push('Unfollowing many accounts in one go can trigger an Instagram action block. Consider doing it in smaller batches.');
      if (nVer > 0) warnings.push(`${nVer} verified account${nVer === 1 ? ' is' : 's are'} included in your selection.`);
      const warnBox = warnings.length
        ? el(
            'div',
            'margin-top:8px;padding:8px;border-radius:6px;background:#3a2a10;color:#ffcc80;font-size:12px;',
            { textContent: '⚠ ' + warnings.join(' ⚠ ') }
          )
        : null;

      const settings = el('div', 'padding:10px 14px;', {}, delaySel, etaText);
      if (warnBox) settings.append(warnBox);

      const close = (val) => { overlay.remove(); resolve(val); };
      const cancelBtn = el('button', btnCss, { textContent: 'Cancel', onclick: () => close(null) });
      const okBtn = el('button', btnCss + 'background:#ed4956;border-color:#ed4956;font-weight:600;', {
        textContent: `Unfollow ${sel.length}`,
        onclick: () => close({ delay: DELAYS[delaySel.value].range }),
      });
      const actions = el('div', 'display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid #333;', {}, cancelBtn, okBtn);

      box.append(heading, stats, preview, settings, actions);
      overlay.append(box);
      panel.append(overlay);
    });

  // ---------- Verification (runs after unfollowing) ----------
  // Re-downloads your following list and confirms the unfollowed accounts are really gone.
  const verify = async (doneIds, total, endReason) => {
    const completed = doneIds.length === total;
    setBanner('busy', '⏳ Verifying with Instagram… keep this panel open until the check finishes.');
    setProgress(0, 'Verifying: re-checking your following list…');
    stop = false;
    const expected = Math.max(1, following.length - unfollowedTotal);
    try {
      const fresh = await fetchAll('following', 'Following', (n, tot) => {
        const frac = Math.min(tot / expected, 0.99);
        setStatus(`Verifying: ${tot} accounts re-checked…`);
        setProgress(frac, `Verifying… ${Math.round(frac * 100)}%`);
      });
      if (closed) return;
      following = fresh;
      unfollowedTotal = 0;
      const now = new Set(fresh.map(idOf));
      const still = doneIds.filter((id) => now.has(id));
      buildList(computeNonFollowers()); // any account that is still followed shows up again
      render();
      const time = new Date().toLocaleTimeString();
      if (still.length) {
        const names = still.map((id) => items.get(id)?.user.username).filter(Boolean);
        setProgress(1, 'Verification finished with problems');
        setBanner(
          'warn',
          `⚠ Verification found ${still.length} account${still.length === 1 ? '' : 's'} still in your following list` +
            ` (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}). Instagram may be lagging or ignored the request. ` +
            'They are back in the list; wait a minute, then unfollow them again or press Refresh to re-check.'
        );
      } else if (completed) {
        setProgress(1, 'Verified ✓');
        setBanner(
          'ok',
          `✅ DONE & VERIFIED (${time}): all ${doneIds.length} account${doneIds.length === 1 ? ' is' : 's are'} no longer in your following list. It is safe to close this panel now.`
        );
      } else {
        setProgress(1, 'Stopped early');
        setBanner(
          'info',
          `⏹ Stopped early${endReason ? ` — ${endReason}` : ''}. ${doneIds.length} of ${total} were unfollowed and verified (${time}). ` +
            `The other ${total - doneIds.length} are still selected: press "Unfollow selected" to continue.`
        );
      }
    } catch (e) {
      if (closed) return;
      setProgress(null, '');
      setBanner(
        'warn',
        `⚠ Could not verify (${e.message}). ${doneIds.length} unfollow request${doneIds.length === 1 ? ' was' : 's were'} accepted, but this is NOT confirmed yet. Press Refresh to check before closing.`
      );
    }
  };

  // ---------- Unfollow ----------
  unBtn.onclick = async () => {
    if (busy) return;
    const ids = [...selected];
    if (!ids.length) return;
    const choice = await showConfirm(ids);
    if (!choice) return;
    const [dMin, dMax] = choice.delay;
    const AVG_DELAY = (dMin + dMax) / 2; // seconds

    setBusy(true);
    stop = false;
    setBanner('busy', '⏳ Unfollowing in progress — do NOT close this panel or tab. Wait for the green "Done & verified" message.');

    let done = 0;
    let endReason = '';
    const doneIds = [];
    const t1 = Date.now();
    setProgress(0, `0/${ids.length} — about ${fmtTime(ids.length * AVG_DELAY)} left`);

    for (const id of ids) {
      if (stop || closed) { endReason = 'stopped by you'; break; }
      if (!tok.dtsg || !tok.jazoest) {
        endReason = 'token not found — manually follow/unfollow any account on Instagram itself (outside this panel) once, then try again';
        break;
      }
      let ok = false, last = '';
      try {
        const body = new URLSearchParams({
          container_module: 'profile',
          nav_chain: 'PolarisProfilePostsTabRoot:profilePage:1:unexpected',
          user_id: id,
          jazoest: tok.jazoest,
          fb_dtsg: tok.dtsg,
        }).toString();
        const r = await fetch(`/api/v1/friendships/destroy/${id}/`, {
          method: 'POST',
          credentials: 'include',
          headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        const t = await r.text();
        let j = {};
        try { j = JSON.parse(t); } catch {}
        last = `HTTP ${r.status}: ${t.slice(0, 200)}`;
        console.log('Unfollow attempt:', last);
        ok = r.ok && j.status === 'ok';
      } catch (e) {
        endReason = 'network error: ' + e.message;
        break;
      }
      if (ok) {
        done++;
        unfollowedTotal++;
        doneIds.push(id);
        items.get(id)?.row.remove();
        items.delete(id);
        selected.delete(id);
        visibleOrder = visibleOrder.filter((i) => i !== id);
        updateSummary();
        const remaining = ids.length - done;
        const elapsed = (Date.now() - t1) / 1000;
        const eta = done > 0 ? (elapsed / done) * remaining : remaining * AVG_DELAY;
        setProgress(done / ids.length, `${done}/${ids.length} unfollowed${remaining ? ` — about ${fmtTime(eta)} left` : ''}`);
      } else {
        endReason = 'Instagram rejected the request: ' + last;
        break;
      }
      if (id !== ids[ids.length - 1]) await wait(rnd(dMin * 1000, dMax * 1000)); // random wait to avoid rate limits
    }

    if (closed) return;
    if (!done) {
      setBusy(false);
      setProgress(null, '');
      setBanner('warn', `No accounts were unfollowed${endReason ? ` — ${endReason}` : ''}.`);
      return;
    }
    await verify(doneIds, ids.length, endReason);
    if (!closed) setBusy(false);
  };

  await loadData();
})();
