// Leads OLX Counter v2 - berjalan di halaman olx.co.id/nf/chat
// 1. Membaca peer_id + ad_id dari setiap kartu chat di Kotak Masuk (data React kartu).
// 2. Mengambil riwayat pesan tiap percakapan dari xchat.olx.co.id/user/messages.
// 3. Menghitung percakapan baru per tanggal (waktu pesan pertama), hanya saat Mobil Seken sebagai penjual.
(() => {
  'use strict';
  const TZ = 'Asia/Jakarta';
  const XCHAT = 'https://xchat.olx.co.id/user/messages';
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const ymd = d => d.toLocaleDateString('sv-SE', { timeZone: TZ });
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00+07:00'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- Simpan header yang dipakai OLX sendiri saat memanggil xchat ----------
  const origFetch = window.fetch;
  let xchatHeaders = {};
  const isXchat = u => /xchat\.olx\.co\.id\/user\/messages/.test(String(u));
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isXchat(url) && init && init.headers) {
        const h = {};
        new Headers(init.headers).forEach((v, k) => { h[k] = v; });
        xchatHeaders = h;
      }
    } catch (e) { /* abaikan */ }
    return origFetch.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, url) { this.__mslUrl = url; this.__mslH = {}; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__mslH) this.__mslH[String(k).toLowerCase()] = v;
    if (isXchat(this.__mslUrl)) xchatHeaders = Object.assign({}, this.__mslH);
    return origSetHeader.apply(this, arguments);
  };

  // ---------- Membaca kartu chat ----------
  function readCards() {
    const out = [];
    for (const el of document.querySelectorAll('[data-aut-id="listItemConversation"]')) {
      const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (!fk) continue;
      let f = el[fk], p = null;
      for (let i = 0; f && i < 8; i++, f = f.return) {
        const mp = f.memoizedProps;
        if (mp && mp.itemId != null && mp.itemUserId != null) { p = mp; break; }
      }
      if (!p) continue;
      const txt = sel => ((el.querySelector(`[data-aut-id="${sel}"]`) || {}).textContent || '').trim();
      out.push({
        name: txt('conversationUsername'), title: txt('conversationItemTitle'),
        peer: String(p.itemUserId), ad: String(p.itemId),
        last: Number(p.lastMsgTimestamp) || 0, me: String(p.userId || ''),
      });
    }
    return out;
  }
  const signature = () => readCards().map(c => c.peer + '/' + c.ad).join(',');

  function pageButton(n) {
    const c = [...document.querySelectorAll('button, a, li')]
      .filter(e => (e.textContent || '').trim() === String(n) && e.offsetParent !== null);
    return c.length ? c[c.length - 1] : null;
  }
  function nextArrow(cur) {
    let el = pageButton(cur);
    if (!el) return null;
    while (el.parentElement && el.parentElement.children.length < 3) el = el.parentElement;
    const row = el.parentElement;
    const last = row && row.lastElementChild;
    if (!last || /\d/.test(last.textContent || '')) return null;
    if (last.disabled || last.getAttribute('aria-disabled') === 'true') return null;
    return last.querySelector('button, a') || last;
  }
  function prevArrow(cur) {
    let el = pageButton(cur);
    if (!el) return null;
    while (el.parentElement && el.parentElement.children.length < 3) el = el.parentElement;
    const first = el.parentElement && el.parentElement.firstElementChild;
    if (!first || /\d/.test(first.textContent || '')) return null;
    return first.querySelector('button, a') || first;
  }
  async function gotoPage(n, cur) {
    const before = signature();
    const btn = pageButton(n) || (n === cur + 1 ? nextArrow(cur) : null);
    if (!btn) return false;
    btn.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const s = signature();
      if (s && s !== before) { await sleep(500); return true; }
    }
    return false;
  }

  // ---------- Mengambil pesan ----------
  async function fetchMessages(items) {
    const res = await origFetch.call(window, XCHAT, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'content-type': 'application/json', accept: 'application/json' }, xchatHeaders),
      body: JSON.stringify(items),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return (j && j.data) || [];
  }

  function addMsgs(conv, list) {
    let added = 0;
    for (const m of list || []) {
      if (!m || !m.timestamp) continue;
      const id = m.msg_id || String(m.timestamp);
      if (conv.msgs.has(id)) continue;
      conv.msgs.set(id, { ts: Number(m.timestamp), buyer: String(m.buyer_id), seller: String(m.seller_id) });
      added++;
    }
    return added;
  }

  // ---------- Perhitungan (fungsi murni, mudah diuji) ----------
  function compute(convs, me, start, today) {
    const counts = {};
    for (let d = start; d <= today; d = addDays(d, 1)) counts[d] = 0;
    let asSeller = 0, asBuyer = 0;
    for (const c of convs) {
      const msgs = [...c.msgs.values()];
      if (!msgs.length) continue;
      const first = ymd(new Date(Math.min(...msgs.map(m => m.ts))));
      c.first = first;
      if (msgs[0].seller !== me) { asBuyer++; c.role = 'pembeli'; continue; }
      asSeller++;
      c.role = 'penjual';
      if (first >= start && first <= today) counts[first]++;
    }
    return { counts, asSeller, asBuyer };
  }
  window.__mslCompute = compute; // untuk pengujian

  // ---------- Alur utama ----------
  async function run(start, ui) {
    const today = ymd(new Date());
    const startMs = Date.parse(start + 'T00:00:00+07:00');

    // 1. Kumpulkan kartu dari semua halaman yang relevan
    const cards = new Map();
    let cur = 1;
    if (pageButton(1)) await gotoPage(1, 0);
    for (;;) {
      const list = readCards();
      if (!list.length) throw new Error('Data kartu chat tidak terbaca. Muat ulang halaman lalu coba lagi.');
      for (const c of list) if (!cards.has(c.peer + '/' + c.ad)) cards.set(c.peer + '/' + c.ad, c);
      ui.status(`Membaca Kotak Masuk halaman ${cur}… (${cards.size} percakapan)`);
      if (Math.min(...list.map(c => c.last)) < startMs) break;
      if (cur >= 60 || !(await gotoPage(cur + 1, cur))) break;
      cur++;
    }
    for (let k = 0; cur > 1 && k < 60 && !(pageButton(1) && (await gotoPage(1, cur))); k++) {
      const prev = prevArrow(cur);
      if (!prev) break;
      const before = signature(); prev.click();
      for (let i = 0; i < 40 && signature() === before; i++) await sleep(250);
    }

    const all = [...cards.values()];
    const me = all.map(c => c.me).find(Boolean);
    // Percakapan dengan aktivitas terakhir sebelum tanggal mulai pasti dimulai sebelum rentang
    const cand = all.filter(c => c.last >= startMs).map(c => Object.assign(c, { msgs: new Map(), err: null, partial: false }));

    // 2. Ambil pesan, 5 percakapan per request
    for (let i = 0; i < cand.length; i += 5) {
      const batch = cand.slice(i, i + 5);
      ui.status(`Mengambil pesan ${Math.min(i + 5, cand.length)} dari ${cand.length} percakapan…`);
      try {
        const data = await fetchMessages(batch.map(c => ({ peer_id: c.peer, ad_id: c.ad, time: 0 })));
        for (const c of batch) {
          const d = data.find(x => String(x.peer_id) === c.peer && String(x.ad_id) === c.ad);
          if (!d || !d.messages || !d.messages.length) c.err = 'pesan tidak tersedia';
          else addMsgs(c, d.messages);
        }
      } catch (e) {
        for (const c of batch) c.err = e.message;
      }
      await sleep(250);
    }

    // 3. Percakapan panjang: minta pesan yang lebih lama sampai tidak ada pesan baru
    for (const c of cand) {
      if (c.err || !c.msgs.size) continue;
      for (let k = 0; ; k++) {
        const oldest = Math.min(...[...c.msgs.values()].map(m => m.ts));
        if (oldest < startMs) break;
        if (k >= 15) { c.partial = true; break; }
        try {
          const data = await fetchMessages([{ peer_id: c.peer, ad_id: c.ad, time: oldest }]);
          const d = data.find(x => String(x.peer_id) === c.peer && String(x.ad_id) === c.ad);
          if (!d || !addMsgs(c, d.messages)) break;
        } catch (e) { break; }
        await sleep(200);
      }
    }

    const r = compute(cand, me, start, today);
    return Object.assign(r, {
      me, pages: cur, totalCards: all.length, cand: cand.length,
      errors: cand.filter(c => c.err), partial: cand.filter(c => c.partial), start, today, list: cand,
    });
  }

  // ---------- Panel ----------
  function buildPanel() {
    const fab = document.createElement('button');
    fab.textContent = 'Leads OLX';
    fab.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#002f34;color:#fff;border:0;' +
      'border-radius:20px;padding:10px 16px;font:bold 13px Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:2147483647;width:350px;max-height:78vh;overflow:auto;' +
      'background:#fff;color:#002f34;border:1px solid #ccd5d6;border-radius:10px;padding:14px;font:13px/1.45 Arial,sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.25);display:none';
    const today = ymd(new Date());
    panel.innerHTML = `
      <div style="font-weight:bold;font-size:15px;margin-bottom:8px">Hitung Leads OLX</div>
      <label>Mulai dari tanggal<br><input type="date" id="msl-start" value="${today.slice(0, 8)}01" max="${today}"
        style="margin:4px 0 8px;padding:4px;font:13px Arial;width:100%;box-sizing:border-box"></label>
      <div style="color:#5a6b6d;font-size:12px;margin-bottom:8px">Sampai hari ini (${today}). Jangan klik halaman OLX selama proses berjalan.</div>
      <button id="msl-run" style="width:100%;padding:8px;background:#002f34;color:#fff;border:0;border-radius:6px;font:bold 13px Arial;cursor:pointer">Mulai hitung</button>
      <div id="msl-status" style="margin-top:10px;color:#5a6b6d"></div>
      <div id="msl-result"></div>`;
    document.body.appendChild(fab);
    document.body.appendChild(panel);
    const statusEl = panel.querySelector('#msl-status');
    const resultEl = panel.querySelector('#msl-result');
    const runBtn = panel.querySelector('#msl-run');
    const ui = { status: (t, err) => { statusEl.textContent = t; statusEl.style.color = err ? '#b00020' : '#5a6b6d'; } };
    fab.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };

    runBtn.onclick = async () => {
      const start = panel.querySelector('#msl-start').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start > ymd(new Date())) return ui.status('Tanggal mulai tidak valid.', true);
      runBtn.disabled = true; resultEl.innerHTML = '';
      try {
        const r = await run(start, ui);
        ui.status(`Selesai: ${r.pages} halaman Kotak Masuk ditelusuri.`);
        render(r, resultEl);
      } catch (e) {
        ui.status(e.message, true);
      } finally {
        runBtn.disabled = false;
      }
    };
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    const old = btn.textContent; btn.textContent = 'Tersalin ✓'; setTimeout(() => { btn.textContent = old; }, 1500);
  }

  function box(bg, html) {
    const d = document.createElement('div');
    d.style.cssText = `margin:10px 0;padding:8px;background:${bg};border-radius:6px;font-size:12px`;
    d.innerHTML = html;
    return d;
  }
  const chatLink = c => `<a href="/nf/chat/user/${c.peer}/${c.ad}" target="_blank">${c.peer}/${c.ad}</a>`;

  function render(r, el) {
    el.innerHTML = '';
    el.appendChild(box('#f2f4f5',
      `${r.cand} percakapan aktif sejak ${r.start} · ${r.asSeller} sebagai penjual (dihitung) · ` +
      `${r.asBuyer} sebagai pembeli (diabaikan) · ID akun ${r.me}`));

    if (r.errors.length) {
      el.appendChild(box('#fdecea', `<b>${r.errors.length} percakapan gagal diambil</b> (${r.errors[0].err}). ` +
        `Angka di bawah mungkin kurang. Coba muat ulang halaman lalu hitung lagi.<br>` + r.errors.slice(0, 10).map(chatLink).join('<br>')));
    }
    if (r.errors.length && r.errors.length === r.cand) return;

    const byMonth = {};
    for (const [d, n] of Object.entries(r.counts)) (byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || []).push([d, n]);
    for (const [ym, rows] of Object.entries(byMonth)) {
      const [y, m] = ym.split('-');
      const sec = document.createElement('div');
      sec.style.cssText = 'border-top:1px solid #e1e6e7;padding-top:8px;margin-top:8px';
      const total = rows.reduce((s, x) => s + x[1], 0);
      sec.innerHTML = `<div style="display:flex;justify-content:space-between"><b>${BULAN[+m - 1]} ${y}</b>` +
        `<span style="font-size:12px">tgl ${+rows[0][0].slice(8)}–${+rows[rows.length - 1][0].slice(8)} · total ${total}</span></div>`;
      const btn = document.createElement('button');
      btn.textContent = `Salin ${rows.length} angka`;
      btn.style.cssText = 'margin:6px 0;padding:5px 10px;font:12px Arial;cursor:pointer';
      btn.onclick = () => copy(rows.map(x => x[1]).join('\n'), btn);
      sec.appendChild(btn);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:2px 8px;font-size:12px;font-family:Menlo,monospace';
      grid.innerHTML = rows.map(([d, n]) => `<span>${d.slice(8)}: <b>${n}</b></span>`).join('');
      sec.appendChild(grid);
      el.appendChild(sec);
    }

    const esc = t => String(t || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const rows = r.list.slice().sort((a, b) => String(a.first || '').localeCompare(String(b.first || '')));
    const det = document.createElement('details');
    det.style.cssText = 'margin-top:10px;font-size:12px';
    det.innerHTML = `<summary style="cursor:pointer;font-weight:bold">Rincian ${rows.length} percakapan</summary>` +
      `<div style="color:#5a6b6d;margin:4px 0">Mulai = pesan pertama · Terakhir = aktivitas terakhir. ` +
      `Hanya baris "penjual" dengan tanggal mulai di rentang yang dihitung.</div>` +
      `<table style="border-collapse:collapse;width:100%">` +
      `<tr style="text-align:left"><th>Mulai</th><th>Terakhir</th><th>Nama · Iklan</th><th>Peran</th></tr>` +
      rows.map(c => {
        const counted = c.role === 'penjual' && c.first >= r.start && c.first <= r.today;
        return `<tr style="border-top:1px solid #e1e6e7;${counted ? '' : 'color:#8a9a9c'}">` +
          `<td>${c.first ? c.first.slice(5) : '-'}</td><td>${ymd(new Date(c.last)).slice(5)}</td>` +
          `<td>${esc(c.name)} · ${esc(c.title).slice(0, 28)}</td><td>${c.err ? 'gagal' : (c.role || '-')}</td></tr>`;
      }).join('') + `</table>`;
    el.appendChild(det);

    if (r.partial.length) {
      el.appendChild(box('#fff4e5', `<b>Perlu dicek manual (${r.partial.length})</b><br>Riwayat percakapan ini sangat panjang ` +
        `dan mungkin belum termuat sampai pesan pertama:<br>` + r.partial.map(chatLink).join('<br>')));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
